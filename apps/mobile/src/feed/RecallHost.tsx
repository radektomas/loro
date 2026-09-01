import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Keyboard, Platform } from 'react-native';
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import type { Video } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { tierFor } from '@loro/core/levels';
import { dueCount } from '@loro/core/progress';
import type { AnswerMatch } from '@loro/core/srs';
import { usePlayerApi, usePlayerClock, usePlayerStatus } from '../player/PlayerHost';
import { maybeAskForPermission, noteCorrectRecall } from '../platform/notifications';
import { CELEBRATE_MS } from './Celebration';
import {
  LEVELS_ENABLED,
  buildLevelPlan,
  buildScriptedLevelBlank,
} from './levelBlanks';
import { maybeAskToSaveProgress } from './saveProgressAsk';
import {
  buildRecallPlan,
  mergeBlankPlans,
  gradeAnswer,
  flog,
  llog,
  ms,
  recallHaptic,
  EMPTY_PLAN,
  HIDE_PLAYER_WHILE_TYPING,
  HOLD_ACTION_DEBOUNCE_MS,
  MAX_RESEATS_PER_BLANK,
  isRecallActive,
  subscribeRecallActive,
  RESEAT_EPSILON_S,
  RESUME_MS_CORRECT,
  RESUME_MS_WRONG,
  SEEK_BACK_PAD_S,
  type BlankEntry,
} from './recall';

/**
 * CHECKPOINT F — the recall session: plan, hold, grade, resume.
 *
 * WHY THIS IS NOT INSIDE Karaoke. The web keeps the blank machinery inside
 * SubtitleTrack because there it is all one rAF loop reading one video
 * element. Here the hold is a different concern from the highlight: the
 * highlight is per-slide and must stay exactly as checkpoint D measured it,
 * while the hold is per-SESSION (one active video, one held blank, one answer,
 * one keyboard) and needs the player API. Splitting them means Karaoke's 60fps
 * path is untouched by recall, and the answer bar can live outside the list.
 *
 * THE HOLD, AND WHY THE RE-SEAT CLAMP IS THE PRIMARY MECHANISM.
 *
 * The web pauses within one rAF frame of currentTime crossing the blanked
 * word's end — same thread, synchronous, so its clamp (SubtitleTrack.tsx:
 * 176-182) is a rare-case repair for choppy playback.
 *
 * Here the path is: UI-thread frame callback -> runOnJS -> api.pause() ->
 * injectJavaScript -> player.pauseVideo(). Every one of those is a hop, so
 * playback ALWAYS overshoots the word. The clamp is therefore not a repair —
 * it is how the hold lands on the right frame at all. It is wired in from the
 * first line rather than added after a bug report, and the [loro:F] logs below
 * report exactly how far the overshoot ran so it can be tuned with numbers.
 */

/** What a slide's Karaoke needs to draw the blank. Changes rarely — on a new
    plan or a graded answer — so consuming it does not re-render on keystroke. */
export type RecallView = {
  /**
   * The video this plan belongs to. FlashList recycles cells, so a slide
   * checks this before drawing a blank — a recycled cell must never render
   * another video's blank into its own line.
   */
  videoKey: string;
  /** cueIndex -> the blank planned there. */
  byCue: ReadonlyMap<number, BlankEntry>;
  /** cueIndex -> outcome, once answered. Drives the reveal styling —
      three-way: 'almost' is a spelling near-miss that grades as correct but
      reveals yellow instead of celebrating. */
  results: ReadonlyMap<number, AnswerMatch>;
};

/** What the answer bar needs. */
export type RecallSession = {
  /** The blank currently held, or null when nothing is waiting on an answer. */
  entry: BlankEntry | null;
  /** Current software-keyboard height, so the bar can sit on top of it. */
  keyboardHeight: number;
  setAnswer: (text: string) => void;
  submit: () => void;
  skip: () => void;
  /** Seek back to the held blank's cue start and play — the hold re-engages
      at the word's end by itself. Null when nothing is held. */
  replay: (() => void) | null;
};

/** What the answer layer needs from the host. Deliberately narrow. */
type RecallGrading = {
  entry: BlankEntry | null;
  keyboardHeight: number;
  /**
   * `graded` is the entry the match was computed AGAINST — the one the answer
   * layer's submit closure saw. grade() verifies it is still the held entry
   * and otherwise drops the submit: the hold can move between the render that
   * bound a handler and the event that fires it (a chain-engaged next blank),
   * and applying one blank's match to another is how a correctly-typed word
   * gets marked wrong.
   */
  grade: (match: AnswerMatch, graded: BlankEntry) => void;
  replay: () => void;
};

const ViewContext = createContext<RecallView | null>(null);
const AnswerContext = createContext<string>('');
const GradingContext = createContext<RecallGrading>({
  entry: null,
  keyboardHeight: 0,
  grade: () => {},
  replay: () => {},
});
const SessionContext = createContext<RecallSession>({
  entry: null,
  keyboardHeight: 0,
  setAnswer: () => {},
  submit: () => {},
  skip: () => {},
  replay: null,
});

/** The plan for the active video, or null. Consumed by every mounted slide. */
export const useRecallView = () => useContext(ViewContext);
/**
 * IS A BLANK HOLDING THE VIDEO RIGHT NOW? Boolean only, on purpose: the one
 * consumer (the walkthrough's floating coach card) needs to get out of the way
 * while the user answers, and handing it the whole grading context would
 * re-render it on every keystroke for a yes/no it already had.
 */
export const useHeldBlank = () => useContext(GradingContext).entry !== null;
/**
 * TELL THE HOST THE USER SEEKED, from where to where, BEFORE the seek command
 * is sent. The seek bar calls this so blanks jumped over are skipped rather
 * than sprung at the landing point — see skippedMask. The ordering matters:
 * the mask must be set before the player can land, or one frame of the hold
 * worklet could engage a blank the seek was about to skip.
 */
const NoteSeekContext = createContext<(from: number, to: number) => void>(() => {});
export const useNoteSeek = () => useContext(NoteSeekContext);
/**
 * The live typed text. SEPARATE FROM useRecallView ON PURPOSE: this changes on
 * every keystroke, and if it rode along with the plan then every mounted
 * Karaoke would re-render per character — breaking that component's stated
 * promise that it never re-renders while a cue is on screen. Only the one
 * blank slot subscribes here.
 */
export const useRecallAnswer = () => useContext(AnswerContext);
export const useRecallSession = () => useContext(SessionContext);

/**
 * The replay action, and whether a blank is currently held.
 *
 * READS GradingContext, NOT THE SESSION, and that is the same separation
 * useRecallAnswer exists for: the session value is rebuilt on every keystroke
 * (it closes over the typed answer), and the band's replay button is mounted
 * in the active slide. Subscribing it to the session would re-render a slide
 * component per character typed — exactly the cost the context split above is
 * designed to avoid. GradingContext changes only when the held blank does.
 */
export function useRecallReplay(): { replay: () => void; held: boolean } {
  const { entry, replay } = useContext(GradingContext);
  return useMemo(() => ({ replay, held: entry !== null }), [replay, entry]);
}

export function RecallHost({
  video,
  active,
  language,
  focusWord,
  recallBlanks = true,
  levelBlanks = true,
  maxLevelBlanks,
  minLevelBlankAtS,
  focusCueIndex,
  scriptedLevelBlankCue,
  scriptedLevelBlankText,
  revealBlanksUntilHeld = false,
  onBlankResolved,
  quiet = false,
  onObscurePlayer,
  children,
}: {
  /** The ACTIVE slide's video, or null. Not gated on the tab — see `planned`. */
  video: (Video & { youtubeId: string }) | null;
  /** Is the feed the visible tab? Gates the hold, never the plan. */
  active: boolean;
  /** Gloss language for level blanks — their prompt IS the gloss, so core
      needs it to resolve one (levels.ts glossText). Recall blanks carry a
      translation already saved with the word and do not need it. */
  language: string;
  /**
   * The word this feed was pointed at from the Words tab, when the active
   * slide is the one it was pointed at. Handed straight to core as the plan's
   * `first`: that word is blanked at its earliest cue, exempt from the caps,
   * and nothing before it is blanked at all. Without it, "review THIS word"
   * lands the user in a video that asks four other words first — or, if the
   * caps were already spent, never asks theirs at all.
   */
  focusWord: string | null;
  /** Pin focusWord's blank to this cue instead of core's earliest-occurrence
      choice — see buildRecallPlan. Walkthrough only. */
  focusCueIndex?: number;
  /**
   * MAY GREEN RECALL BLANKS BE PLANNED? True everywhere except the onboarding
   * taste reel's uncoached clips — levelBlanks' twin, for the same reason.
   *
   * The reel's clips are scripted beats, but the SRS is device state: a
   * device that has seen the app before carries due words into onboarding,
   * and core would happily freeze clip one mid-tap-beat on one of them, or
   * drop one right after the last clip's scripted blue blank. On a genuinely
   * fresh install this changes nothing (there are no saved words yet); on a
   * returning device it keeps the guided run guided. The fill clip keeps it
   * true — its whole beat IS a recall blank.
   */
  recallBlanks?: boolean;
  /**
   * MAY BLUE LEVEL BLANKS BE PLANNED? True everywhere except the onboarding
   * taste reel.
   *
   * The walkthrough scripts one green blank on one word and stops the clip on
   * it. A blue blank is indistinguishable from that beat to a first-time user
   * and can be planned anywhere, including before the coached moment — so on a
   * fresh device, where band 1 is 91% articles and prepositions, the guided run
   * would routinely be interrupted by an unexplained gap asking for "la". This
   * turns them off for the duration of the reel; RECALL_ENABLED and
   * LEVELS_ENABLED are untouched and the real feed is unaffected.
   */
  levelBlanks?: boolean;
  /**
   * At most this many blue blanks on a video. Undefined means core's own cap
   * (maxLevelBlanks in levels.ts), which is what the real feed wants.
   *
   * The onboarding reel sets 1 on its last clip. The point there is to show
   * that the blue ladder EXISTS, once, in a screen the user has been led
   * through beat by beat — four of them would turn the last thing before the
   * paywall into a test, which is the opposite of the feeling that sells it.
   *
   * The earliest cues win, not the highest bands: a blank the user never
   * reaches teaches nothing, and core orders its plan by band preference
   * rather than by time.
   */
  maxLevelBlanks?: number;
  /**
   * NO BLUE BLANK BEFORE THIS SECOND. Undefined means core's own rule, which
   * is what the real feed wants.
   *
   * Core's floor is MIN_CUE_INDEX — the first two cues, an INDEX rather than a
   * clock. On a fast opening those two lines can be over in four seconds, and
   * the blank lands while the viewer is still working out what they are
   * watching. That is fine in the feed, where the video before it earned the
   * same interruption, and wrong on the last clip of the onboarding reel, which
   * has to be watched before it asks for anything.
   *
   * Applied to `pauseAt` (the moment the video actually STOPS) rather than to
   * the cue's start, because that is the instant the user experiences as the
   * interruption. A clip with nothing left after the filter gets no blue blank
   * at all — degrading to a clip you simply watch, never to an early gap.
   * (The taste reel used this floor until 2026-08-31; its blank is now meant
   * to arrive EARLY — an attempted blank beats an admired one before the
   * wall — so it passes no floor at all. The prop stays for the next
   * scripted surface that wants the opposite trade.)
   */
  minLevelBlankAtS?: number;
  /**
   * THE SCRIPTED BLUE BLANK: exactly this word at exactly this cue, instead
   * of whatever the planner would choose. Two primitives rather than one
   * object ON PURPOSE — the walkthrough config is rebuilt every render, and
   * an object prop here would put a fresh identity in the plan effect's deps
   * and replan on every frame. Recall still wins the cue on a collision,
   * matching the house rule. Walkthrough only; the feed passes neither.
   */
  scriptedLevelBlankCue?: number;
  scriptedLevelBlankText?: string;
  /** Fired after a blank is graded, either kind, right or wrong — the
      walkthrough uses it to run its next beat off the answer. */
  onBlankResolved?: (kind: 'recall' | 'level', cueIndex: number) => void;
  /**
   * THE GIVEAWAY MODE — currently unused, kept for the next scripted beat
   * that wants it.
   *
   * Normally a planned blank is a gap from the moment its line renders — the
   * word must never be shown, or there is nothing to recall. This inverts
   * that on purpose: the word plays as itself, spoken and highlighted like
   * any other, and turns into the gap only when the hold freezes the video
   * on it — a guaranteed win for teaching the mechanic, at the price that
   * nobody ever SEES a gap approaching. The taste reel used it for one
   * morning (2026-09-01) to hide a blank that froze 0.96s into its clip;
   * once its scripted blanks moved mid-line with real lead-ins, the visible
   * gap became the demonstration and the reel went back to the feed's own
   * rendering. The seam stays, minLevelBlankAtS-style, for the next surface
   * that wants the opposite trade.
   *
   * False everywhere real: a feed blank shown-then-hidden is an answer key.
   */
  revealBlanksUntilHeld?: boolean;
  /**
   * NOTHING MAY INTERRUPT. True for the onboarding taste reel and nowhere else.
   *
   * The celebration after a correct answer is a scheduling moment: it is where
   * the feed asks for notification permission, and where it offers to save the
   * user's progress to an account. Both are right in the real feed and both are
   * wrong in the guided run — the walkthrough asks the user to fill one blank
   * and then covers its own demonstration with a modal about accounts, seconds
   * before the paywall asks them for money. Two asks stacked on one screen is
   * how you lose both.
   *
   * The guard is HERE, at the raise, rather than at the two cards, and that is
   * the point of it: maybeAskToSaveProgress latches promptedThisSession and
   * spends a recordSavePromptShown record on the way past, and
   * maybeAskForPermission latches its own session flag. Suppressing further
   * down would silence the modal and still burn the budget, so the real ask
   * later in the feed would never come.
   */
  quiet?: boolean;
  /**
   * Raised while the answer bar would otherwise sit over the player area — see
   * HIDE_PLAYER_WHILE_TYPING for the geometry that forces this. The feed
   * answers it by fading the player out, which is the same mechanism (and the
   * same poster underneath) it already uses during a swipe.
   */
  onObscurePlayer: (obscured: boolean) => void;
  children: ReactNode;
}) {
  const api = usePlayerApi();
  const status = usePlayerStatus();
  const { anchorTime, anchorAt, isPlaying, rate } = usePlayerClock();

  /**
   * Recall's EFFECTIVE state, not the compile-time constant: the /vocab Review
   * call to action arms recall at runtime, and this feed has to notice. See
   * isRecallActive — the web gates recall not at all, so this exists only to
   * keep the dark-ship flag from disabling the one entry point a user has.
   */
  const recallActive = useSyncExternalStore(
    subscribeRecallActive,
    isRecallActive,
    isRecallActive
  );

  /**
   * The analogue of the web's `active` (Feed.tsx:567-586), which there is
   * `isActive && ownsMedia`: this host only ever sees the active video, so
   * "owns" is just "the player is actually holding it". Planning against a
   * video the player has not loaded would arm a hold against another video's
   * clock.
   *
   * ⚠️ TWO GATES, NOT ONE, AND THE SPLIT IS A PERFORMANCE FIX. Leaving the
   * feed tab used to null the video, which cleared the plan, which nulled the
   * view context, which re-rendered every mounted karaoke track — twice per
   * round trip, plus a full replan on the way back. None of that work was
   * needed: the player still holds the same video and the plan is still true;
   * the user just went to look at their words.
   *
   *   planned   there is a plan worth drawing. Survives a tab switch.
   *   armed     the hold may act — pause, seek, grade. Tab-gated, so nothing
   *             fires at a player nobody is looking at.
   *
   * Either feature plans; both can be on at once and the merged plan carries
   * both kinds.
   */
  const owns = Boolean(video) && status.loadedVideoId === video?.youtubeId;
  /** LEVELS_ENABLED is the build's switch; `levelBlanks` is this host's. */
  const levelsOn = LEVELS_ENABLED && levelBlanks;
  /** Same split for green: the runtime arm is the build's, `recallBlanks`
      is this host's. */
  const recallOn = recallActive && recallBlanks;
  const planned = (recallOn || levelsOn) && owns && video !== null;
  const armed = planned && active;

  const [plan, setPlan] = useState(EMPTY_PLAN);
  const [results, setResults] = useState<Map<number, AnswerMatch>>(new Map());
  const [heldIndex, setHeldIndex] = useState(-1);

  /**
   * The keyboard's height, tracked HERE rather than in the bar because two
   * things need it: the bar's own position, and the decision to yield the
   * player. `will` events on iOS so both move WITH the keyboard animation
   * instead of snapping after it; Android only emits `did`.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      flog(`keyboard up h=${Math.round(event.endCoordinates.height)}pt`);
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Shared values the frame callback owns. Resolved is a bitmask so the
  // worklet can skip answered blanks without touching a JS structure.
  const heldSv = useSharedValue(-1);
  const resolvedMask = useSharedValue(0);
  /**
   * Blanks the user SEEKED PAST, as a twin of resolvedMask — same bit layout,
   * same consumer. A recall blank asks "what did she just say?", and a word
   * jumped over by the seek bar was never said to this user: engaging the hold
   * at the landing point asks them to recall audio they did not hear, which is
   * the one way a review can be unfair rather than merely hard.
   *
   * Skipping is not answering: the word stays due in the SRS untouched and
   * comes back in another video (or in this one, on a seek back — a backward
   * seek re-arms every skipped blank behind the landing point, because the
   * word WILL now be heard on the way). Mirrored into skippedBits below for
   * the render side.
   */
  const skippedMask = useSharedValue(0);
  /** The React half of skippedMask: the karaoke un-blanks a skipped word (a
      gap that will never ask is just a hole in the line). */
  const [skippedBits, setSkippedBits] = useState(0);
  const lastActionAt = useSharedValue(0);
  /** 1 once this hold's landing position has been reported. Per-blank. */
  const measuredSv = useSharedValue(0);
  /**
   * 1 while a segment replay is in flight — the clock has been deliberately
   * moved BEFORE the hold point and playback restarted.
   *
   * The clamp exists to drag a displaced paused clock back onto the word, and
   * during a replay that displacement is intentional, so without this flag the
   * clamp fires the moment the debounce lapses and yanks playback back to the
   * word before the line has been heard. That is not hypothetical: play() takes
   * 316-825ms to reach PLAYING over the bridge (rn-port-map §5e) and the
   * debounce is 350ms, so the clamp usually won the race.
   */
  const replayingSv = useSharedValue(0);

  // Read by the JS callbacks the worklet schedules.
  const entriesRef = useRef<BlankEntry[]>([]);
  const engagedAtRef = useRef(0);
  const reseatsRef = useRef(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedRef = useRef(armed);
  armedRef.current = armed;
  /** A ref for the same reason `quiet` gets one below: grade() must not be
      rebuilt on a walkthrough re-render, or the worklet re-registers. */
  const onBlankResolvedRef = useRef(onBlankResolved);
  onBlankResolvedRef.current = onBlankResolved;
  /** Read inside grade(), which must not take `quiet` as a dependency: it is
      rebuilt on identity and a rebuild mid-hold re-registers the worklet that
      is holding the video. Same pattern as armedRef, for the same reason. */
  const quietRef = useRef(quiet);
  quietRef.current = quiet;

  entriesRef.current = plan.entries;

  /**
   * A CHANGE MADE SOMEWHERE ELSE, brought in at the only safe moment.
   *
   * The plan deliberately does not track the saved words: replanning on every
   * grade would wipe the results of the session in progress. But words DO
   * change while this tab is hidden — the Words tab grades a flashcard, or a
   * word is removed — and a plan that came back stale would ask for a word the
   * user has just answered somewhere else.
   *
   * So a change made while hidden only sets a flag, and the flag is spent when
   * the tab comes back. Nothing changed while away is the common case, and it
   * costs nothing.
   */
  const [staleVersion, setStaleVersion] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const staleRef = useRef(false);
  useEffect(
    () =>
      storage.onWordsChanged(() => {
        if (!activeRef.current) staleRef.current = true;
      }),
    []
  );
  useEffect(() => {
    if (!active || !staleRef.current) return;
    staleRef.current = false;
    flog('words changed while the feed was hidden — replanning');
    setStaleVersion((version) => version + 1);
  }, [active]);

  /**
   * THE KEYBOARD IS NOT PART OF THIS TAB, so it cannot be left behind on the
   * way out. Everything else about a held blank survives the trip — the pause
   * point, the typed text, the bar — and the user comes back to exactly the
   * blank they left. Only the keyboard would have hung over the Words list.
   */
  useEffect(() => {
    if (!active) Keyboard.dismiss();
  }, [active]);

  /**
   * Plan when the slide takes the screen — the analogue of Feed.tsx:567-586.
   * Graded words get a future dueAt, so a replan never repeats them.
   *
   * Selection, throttling and due-ness are entirely core's: this passes the
   * whole saved list to computeBlankPlan and takes what it returns. The read is
   * synchronous (MMKV), which is the property platform.ts insists on.
   */
  useEffect(() => {
    if (!planned || !video) {
      setPlan(EMPTY_PLAN);
      return;
    }
    // ONE READ OF THE SAVED LIST, feeding both planners — the web does the
    // same (Feed.tsx:570) and it matters: computeLevelBlankPlan uses it to
    // skip words already in the SRS, so the two planners must be looking at
    // the same list or a word could be planned as both kinds.
    const saved = storage.getSavedWords();

    // RECALL FIRST, and its cues become the level planner's exclusion set —
    // the ordering is load-bearing, not incidental (Feed.tsx:563-565: "recall
    // of the user's own saved words always wins a collision").
    const recallEntries = recallOn
      ? buildRecallPlan(video, saved, Date.now(), focusWord, focusCueIndex)
      : [];
    if (recallEntries.length > 0) {
      flog(
        `plan video=${video.id} green=${recallEntries.length} ` +
          recallEntries
            .map((e) => `[cue${e.cueIndex} "${e.surface}" @${e.pauseAt.toFixed(2)}s]`)
            .join(' ')
      );
    }

    /** Named for what it is, and NOT `planned` — that identifier is already the
        effect's own guard above, and shadowing it here would put the guard in
        the temporal dead zone and throw on every plan. */
    const scripted =
      levelsOn &&
      scriptedLevelBlankCue !== undefined &&
      scriptedLevelBlankText !== undefined &&
      // Recall wins a cue collision, same as the planner's exclusion set.
      !recallEntries.some((e) => e.cueIndex === scriptedLevelBlankCue)
        ? buildScriptedLevelBlank(
            video,
            scriptedLevelBlankCue,
            scriptedLevelBlankText,
            language
          )
        : null;
    const levelCandidates = scripted
      ? [scripted]
      : levelsOn && scriptedLevelBlankCue === undefined
        ? buildLevelPlan(
            video,
            storage.getLevelState().level,
            saved,
            language,
            new Set(recallEntries.map((e) => e.cueIndex))
          )
        : [];
    // The floor comes FIRST, so the cap below picks the earliest blank that is
    // actually allowed rather than dropping to none when the earliest is too
    // early.
    const lateEnough =
      minLevelBlankAtS === undefined
        ? levelCandidates
        : levelCandidates.filter((e) => e.pauseAt >= minLevelBlankAtS);
    const levelEntries =
      maxLevelBlanks === undefined
        ? lateEnough
        : [...lateEnough]
            .sort((a, b) => a.cueIndex - b.cueIndex)
            .slice(0, Math.max(0, maxLevelBlanks));

    setPlan(mergeBlankPlans(levelEntries, recallEntries));
    // recallOn is listed even though `planned` already folds it in: with
    // LEVELS_ENABLED on, `planned` is true either way, so arming recall
    // mid-session (or the taste reel flipping recallBlanks per slide) would
    // not otherwise replan the slide already on screen and the user would see
    // nothing until the next swipe. focusWord for the same class of reason:
    // the jump can land on the slide already on screen, and that plan has to
    // be rebuilt around the word that was asked for.
    //
    // The saved words are deliberately NOT a dependency — replanning on every
    // grade would wipe the results of the session in progress. staleVersion is
    // how a change made on ANOTHER tab gets in; see below.
    // levelsOn joins the list for the same reason recallOn is on it: the
    // taste reel turns the blue planner off for a host that is already mounted.
  }, [
    planned,
    recallOn,
    levelsOn,
    maxLevelBlanks,
    minLevelBlankAtS,
    scriptedLevelBlankCue,
    scriptedLevelBlankText,
    video,
    language,
    focusWord,
    focusCueIndex,
    staleVersion,
  ]);

  /**
   * A new plan resets every scrap of local recall state — the web does the
   * same on a plan change (SubtitleTrack.tsx:216-220).
   *
   * R6: the keyboard goes down here too. Without it, swiping away mid-answer
   * leaves the keyboard up over a slide that has no blank.
   */
  useEffect(() => {
    setResults(new Map());
    setHeldIndex(-1);
    heldSv.value = -1;
    resolvedMask.value = 0;
    skippedMask.value = 0;
    setSkippedBits(0);
    lastActionAt.value = 0;
    measuredSv.value = 0;
    replayingSv.value = 0;
    reseatsRef.current = 0;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    Keyboard.dismiss();
  }, [plan, heldSv, resolvedMask, skippedMask, lastActionAt, measuredSv, replayingSv]);

  /**
   * Holds the gap between a correct answer and the notification explainer, so
   * the sheet lands after the celebration rather than on top of it.
   *
   * THE DELAY LIVES HERE RATHER THAN IN THE NOTIFICATIONS MODULE because
   * "after the celebration" is a fact about this screen's animation. A platform
   * seam importing CELEBRATE_MS would point the dependency the wrong way.
   */
  const askTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      if (askTimer.current) clearTimeout(askTimer.current);
    },
    []
  );

  /**
   * The hold engaged: playback has reached the blanked word's end.
   *
   * PAUSE ONLY — no pre-emptive seek. The clamp below is what puts the clock
   * on the right frame, and letting the pause land unassisted is also what
   * makes the overshoot MEASURABLE: whatever position the player reports in
   * its pause anchor is the true cost of the bridge.
   */
  const onHoldEngage = useCallback(
    (index: number, observedT: number) => {
      const entry = entriesRef.current[index];
      if (!entry) return;
      engagedAtRef.current = Date.now();
      reseatsRef.current = 0;
      api.pause();
      setHeldIndex(index);
      flog(
        `hold cue=${entry.cueIndex} "${entry.surface}" pauseAt=${entry.pauseAt.toFixed(3)}s ` +
          `detect=+${ms(observedT - entry.pauseAt)} (UI-thread, sub-frame)`
      );
    },
    [api]
  );

  /**
   * THE MEASUREMENT — the number checkpoint F exists to produce.
   *
   * Fires once per hold, the moment the pause actually lands, whether or not a
   * clamp is needed. `bridge` is how far past the blanked word the player ran
   * while pause() crossed UI thread -> JS -> injectJavaScript -> YouTube;
   * `latency` is the wall time that took. Read these before tuning anything.
   */
  const onHoldLanded = useCallback((index: number, clockAt: number) => {
    const entry = entriesRef.current[index];
    if (!entry) return;
    const overshoot = clockAt - entry.pauseAt;
    flog(
      `OVERSHOOT cue=${entry.cueIndex} "${entry.surface}" ` +
        `bridge=${overshoot >= 0 ? '+' : ''}${ms(overshoot)} ` +
        `latency=${Date.now() - engagedAtRef.current}ms ` +
        `(landed ${clockAt.toFixed(3)}s, wanted ${entry.pauseAt.toFixed(3)}s` +
        `${Math.abs(overshoot) > RESEAT_EPSILON_S ? ', clamping' : ', within tolerance — no clamp'})`
    );
  }, []);

  /**
   * THE RE-SEAT CLAMP, ported from SubtitleTrack.tsx:176-182.
   *
   * The clock is paused but sitting somewhere other than the hold point —
   * which here is the normal case, not the exception, because the pause landed
   * however many milliseconds of bridge latency past the word. Pull it back so
   * the blank's cue (and therefore the in-line blank) is what's on screen.
   */
  const onHoldDisplaced = useCallback(
    (index: number, clockAt: number) => {
      const entry = entriesRef.current[index];
      if (!entry) return;

      if (reseatsRef.current >= MAX_RESEATS_PER_BLANK) {
        if (reseatsRef.current === MAX_RESEATS_PER_BLANK) {
          reseatsRef.current += 1;
          flog(
            `re-seat GAVE UP after ${MAX_RESEATS_PER_BLANK} attempts on cue=${entry.cueIndex} ` +
              `— clock stuck at ${clockAt.toFixed(3)}s. Answer bar still works; the ` +
              `in-line blank may not be on screen.`
          );
        }
        return;
      }
      reseatsRef.current += 1;
      api.seek(entry.pauseAt);
      flog(
        `re-seat #${reseatsRef.current} cue=${entry.cueIndex} ` +
          `${clockAt.toFixed(3)}s -> ${entry.pauseAt.toFixed(3)}s`
      );
    },
    [api]
  );

  /**
   * Held, but the clock is running past the hold point again. Two causes, and
   * the web merges them for the same reason (SubtitleTrack.tsx:167-175): the
   * pause round trip is simply still in flight, or something genuinely resumed
   * playback over an unanswered blank. Re-assert either way.
   */
  const onHoldSlipped = useCallback(
    (index: number, observedT: number) => {
      const entry = entriesRef.current[index];
      if (!entry) return;
      api.pause();
      flog(
        `re-assert cue=${entry.cueIndex} — clock ran to ${observedT.toFixed(3)}s ` +
          `(${Date.now() - engagedAtRef.current}ms after engage)`
      );
    },
    [api]
  );

  /**
   * The hold's frame callback. Mirrors the web's scan (SubtitleTrack.tsx:
   * 147-197): walk the plan, skip resolved blanks, act on the first one whose
   * pause point the clock has reached.
   */
  const pauseAts = plan.pauseAts;
  const frame = useFrameCallback(() => {
    'worklet';
    const count = pauseAts.length;
    if (count === 0) return;

    // The same extrapolation Karaoke runs, and duplicated for the same reason:
    // it must not leave the UI thread.
    const t = isPlaying.value
      ? anchorTime.value + ((Date.now() - anchorAt.value) / 1000) * rate.value
      : anchorTime.value;

    for (let i = 0; i < count; i++) {
      if (((resolvedMask.value | skippedMask.value) >> i) & 1) continue;
      const pauseAt = pauseAts[i];

      if (heldSv.value === i) {
        const nowMs = Date.now();
        // A replay is running: let it play THROUGH to the word, then re-assert
        // the hold there. The clamp below must not touch the clock meanwhile.
        if (replayingSv.value === 1) {
          if (isPlaying.value && t >= pauseAt) {
            replayingSv.value = 0;
            lastActionAt.value = nowMs;
            runOnJS(onHoldSlipped)(i, t);
          }
          return;
        }
        if (!isPlaying.value) {
          // The pause has landed, and where it landed IS the measurement.
          // Reported once per blank, and deliberately NOT behind the debounce
          // below: this reads state rather than crossing the bridge, and
          // delaying it would fold the debounce into the latency number.
          if (measuredSv.value === 0) {
            measuredSv.value = 1;
            runOnJS(onHoldLanded)(i, anchorTime.value);
          }
          // The clamp. Debounced because it DOES cross the bridge.
          if (
            Math.abs(anchorTime.value - pauseAt) > RESEAT_EPSILON_S &&
            nowMs - lastActionAt.value >= HOLD_ACTION_DEBOUNCE_MS
          ) {
            lastActionAt.value = nowMs;
            runOnJS(onHoldDisplaced)(i, anchorTime.value);
          }
        } else if (
          t >= pauseAt &&
          nowMs - lastActionAt.value >= HOLD_ACTION_DEBOUNCE_MS
        ) {
          lastActionAt.value = nowMs;
          runOnJS(onHoldSlipped)(i, t);
        }
        return;
      }

      // Blanks are in cue order, so if this one is still ahead of the clock
      // every later one is too.
      if (t < pauseAt) return;

      heldSv.value = i;
      measuredSv.value = 0;
      lastActionAt.value = Date.now();
      runOnJS(onHoldEngage)(i, t);
      return;
    }
  }, false);

  useEffect(() => {
    frame.setActive(armed && pauseAts.length > 0);
  }, [frame, armed, pauseAts]);

  /**
   * Grade, then resume. storage.gradeWord carries the whole schedule — box
   * promotion/demotion, dueAt, the lapsed state, the streak day, the
   * save-prompt session counter and the sync enqueue (storage.ts:1058-1095).
   * Nothing about the schedule is reimplemented here.
   */
  const grade = useCallback(
    (match: AnswerMatch, graded: BlankEntry) => {
      const index = heldSv.value;
      const entry = entriesRef.current[index];
      if (!entry) return;
      /**
       * THE MATCH MUST BELONG TO THE HELD ENTRY. The submit handler that
       * computed it was bound on an earlier render, and the hold can move in
       * between — grading blank A's match onto blank B marks a correctly
       * typed word wrong. A submit for an entry that is no longer held is
       * dropped, not re-aimed: the user answered a question that has left the
       * screen, and silently re-asking is the bar's job, not the grader's.
       */
      if (entry !== graded) {
        flog(
          `grade DROPPED — submit was for cue=${graded.cueIndex} "${graded.surface}" ` +
            `but the hold is now cue=${entry.cueIndex} "${entry.surface}"`
        );
        return;
      }

      // 'almost' — a spelling near-miss — GRADES as correct everywhere below
      // (SRS box, level meter, streak day). The three-way value is the UI's:
      // the reveal goes yellow and the celebration is reserved for exact.
      const wasCorrect = match !== 'wrong';

      setResults((prev) => {
        const next = new Map(prev);
        next.set(entry.cueIndex, match);
        return next;
      });
      resolvedMask.value |= 1 << index;
      heldSv.value = -1;
      replayingSv.value = 0;
      setHeldIndex(-1);
      Keyboard.dismiss();

      // The celebration fires for BOTH kinds on the web — SubtitleTrack's
      // gradeBlank celebrates on wasCorrect without looking at `kind`. The
      // haptic rides the SRS outcome (a near-miss is still a success).
      if (wasCorrect) recallHaptic();

      // The walkthrough's hook: the answer, right or wrong, is what its next
      // beat keys on. Via ref so grade() keeps its stable identity.
      onBlankResolvedRef.current?.(entry.kind, entry.cueIndex);

      if (entry.kind === 'recall') {
        const { word } = storage.gradeWord(
          entry.word.text,
          entry.word.videoId,
          wasCorrect
        );
        flog(
          `grade "${entry.word.text}" ${match.toUpperCase()} -> ` +
            (word
              ? `box=${word.box} state=${word.state} due=${new Date(word.dueAt).toISOString()}`
              : 'NOT FOUND (word missing from storage)')
        );

        /**
         * A correct recall also moves the LEVEL meter — half a level blank's
         * credit, never a demotion (core's applyRecallLevelCredit carries the
         * reasoning). Recalling your own saved word in a video is the same
         * evidence a blue blank asks for, so a diligent reviewer should not
         * stay pinned at their starting level.
         */
        if (wasCorrect) {
          const before = storage.getLevelState();
          const level = storage.applyRecallLevelCredit();
          llog(
            `recall credit "${entry.word.text}" -> meter ${before.level}/${before.meter} ` +
              `→ ${level.level}/${level.meter} tier=${tierFor(level.level).name}` +
              (level.leveledUp ? ' LEVELLED UP' : '')
          );
        }
      } else {
        /**
         * A LEVEL BLANK TAKES **TWO** CORE CALLS, NOT ONE, and both matter.
         * The web does exactly this pair (Feed.tsx:647-657):
         *
         *   saveLevelWord    routes the word into the SRS by result — a miss
         *                    enters at box 0, a hit is filed as already-known
         *                    at box 4 (storage.ts:1129-1141). It also logs the
         *                    streak day on a correct fill and enqueues the
         *                    sync write, so dropping it would silently cost
         *                    both. Note it delegates to gradeWord when the
         *                    word is ALREADY saved — unreachable from the feed
         *                    in practice, because computeLevelBlankPlan
         *                    excludes saved words at plan time, but kept
         *                    because that routing is core's to decide.
         *   applyLevelAnswer moves the tier meter (levels.ts:74-104).
         *
         * The meter is read BEFORE the calls so the log can show the move.
         */
        const before = storage.getLevelState();
        storage.saveLevelWord(
          {
            text: entry.word.text,
            translation: entry.word.translation,
            videoId: entry.word.videoId,
            cueIndex: entry.word.cueIndex,
          },
          wasCorrect
        );
        const result = storage.applyLevelAnswer(wasCorrect);
        llog(
          `grade "${entry.word.text}" (band ${entry.word.level}) ` +
            `${wasCorrect ? 'CORRECT' : 'WRONG'} -> ` +
            `meter ${before.level}/${before.meter} → ${result.level}/${result.meter} ` +
            `tier=${tierFor(result.level).name}` +
            (result.leveledUp ? ' LEVELLED UP' : '') +
            (result.leveledDown ? ' LEVELLED DOWN' : '')
        );
      }

      /**
       * THE DAY IS NOW COMPLETE, AND THIS IS THE ONLY PLACE THAT KNOWS IT.
       *
       * Hooked here rather than around storage.gradeWord deliberately: BOTH
       * branches above log a streak day (gradeWord for a recall, saveLevelWord
       * for a level fill), and LEVELS_ENABLED is true, so a user can complete
       * their day from the ordinary feed without ever opening a review. Wrapping
       * only the recall path would miss them entirely.
       *
       * ⚠️ IT MUST STAY BELOW THE GRADING, NOT ABOVE IT. reconcile() reads
       * getCorrectRecallDays to decide whether today still needs the at-risk
       * nudge, so running it before the day is written would re-arm the very
       * notification this call exists to cancel. It happens to survive above the
       * branches today because reconcile defers its body to a microtask, but
       * that is an accident of scheduling and not something to depend on.
       *
       * The explainer waits for the celebration to finish, and raises nothing
       * unless this is a moment worth asking in (see maybeAskForPermission).
       *
       * SESSION COMPLETION IS DETECTED HERE TOO, and only on a recall grade:
       * this word was due (it was planned), gradeWord just rescheduled it into
       * the future, so a due queue at 0 right now means THIS answer emptied it
       * — the same >0->0 transition storage.gradeWord's own sessions counter
       * keys on. Level blanks save NEW words with future dueAts and can never
       * empty the queue. The moment fires whether or not the last answer was
       * correct — a wrong answer still finishes the session.
       *
       * PRIORITY AT THE SHARED CELEBRATION MOMENT: the save-progress card
       * wins over the notification explainer. It is the rarer ask (anonymous
       * only, 7-day snooze, gone forever once the vocab prompts resolve) and
       * it protects data; the explainer's promptedThisSession is not consumed
       * when it yields, so its next chance survives.
       */
      if (wasCorrect) noteCorrectRecall();
      const sessionComplete =
        entry.kind === 'recall' &&
        dueCount(storage.getSavedWords(), Date.now()) === 0;
      if (!quietRef.current && (sessionComplete || wasCorrect)) {
        if (askTimer.current) clearTimeout(askTimer.current);
        askTimer.current = setTimeout(() => {
          askTimer.current = null;
          void (async () => {
            const raised = sessionComplete && (await maybeAskToSaveProgress());
            if (!raised && wasCorrect) await maybeAskForPermission();
          })();
        }, CELEBRATE_MS);
      }

      // The web's rhythm, with one addition: an exact answer resumes quickly,
      // while a miss AND a near-miss leave time to read the revealed spelling.
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(
        () => {
          /**
           * heldSv, NOT just armed: when the clamp left the paused clock at or
           * past the NEXT blank's pause point — a first-word blank on the next
           * cue sits within the clamp's residual — that blank engages the
           * instant this grade frees the hold, i.e. BEFORE this timer fires.
           * Playing here would play straight through the freshly held blank
           * and hand it to the slip/re-assert fight. The new hold owns
           * playback now; its own grade schedules its own resume.
           */
          if (armedRef.current && heldSv.value === -1) api.play();
        },
        match === 'correct' ? RESUME_MS_CORRECT : RESUME_MS_WRONG
      );
    },
    [api, heldSv, resolvedMask, replayingSv]
  );

  /**
   * F3 — replay the held blank's line: seek back to the cue's start (padded,
   * because embed seeks land within ±0.5s) and play. Nothing else to manage:
   * the hold's own frame callback re-engages when the clock crosses pauseAt
   * again, exactly as the web documents ("Replay deliberately gets to play
   * back UP TO the word", SubtitleTrack.tsx:170). Typed text survives because
   * grading never ran.
   *
   * lastActionAt is stamped so the hold's slip branch cannot fire a re-assert
   * pause during the seek's bridge round trip — the anchor still reads the old
   * paused position (>= pauseAt) until the seek anchor lands, and without the
   * stamp that stale read would pause the replay dead. The reseat budget is
   * reset because this is a fresh approach to the hold point.
   */
  const replayHeldBlank = useCallback(() => {
    const index = heldSv.value;
    const entry = entriesRef.current[index];
    const cue = entry ? video?.cues[entry.cueIndex] : undefined;
    if (!entry || !cue) return;
    /**
     * THE KEYBOARD GOES DOWN FIRST, AND THAT IS THE WHOLE POINT OF REPLAY.
     *
     * While a blank is held with the keyboard up, the player is deliberately
     * faded out — the answer bar sits over the player area and Loro may never
     * draw there (HIDE_PLAYER_WHILE_TYPING). So replaying without dropping the
     * keyboard seeks a player nobody can see: the line plays back invisibly and
     * the user is left watching a blank frame, which is exactly how this
     * shipped and exactly what it looked like.
     *
     * Dismissing takes keyboardHeight to 0, which clears `obscuresPlayer` and
     * brings the video back for the replay. The answer bar does NOT go away —
     * it re-seats itself in the band (RecallBar renders on `entry`, not on the
     * keyboard) — so the typed text survives and tapping the input raises the
     * keyboard again once the hold re-engages at the word.
     */
    Keyboard.dismiss();
    reseatsRef.current = 0;
    measuredSv.value = 1; // the landing was already measured for this hold
    replayingSv.value = 1;
    lastActionAt.value = Date.now();
    const target = Math.max(0, cue.start - SEEK_BACK_PAD_S);
    api.seek(target);
    api.play();
    flog(
      `replay cue=${entry.cueIndex} "${entry.surface}" -> ${target.toFixed(2)}s ` +
        `(cue.start=${cue.start.toFixed(2)}s, hold re-engages at ${entry.pauseAt.toFixed(2)}s)`
    );
  }, [api, video, heldSv, lastActionAt, measuredSv, replayingSv]);

  /**
   * The seek bar's report. Forward: every unresolved blank whose hold point
   * lies inside the jumped-over span is skipped — its audio was skipped, so
   * the ask goes with it. Backward: every skipped blank ahead of the landing
   * point is re-armed, because playback will now reach it the honest way.
   * resolvedMask is never touched in either direction: an answered blank is
   * answered, however the clock later moves.
   */
  const noteSeek = useCallback(
    (from: number, to: number) => {
      const entries = entriesRef.current;
      if (entries.length === 0) return;
      if (to > from) {
        let bits = 0;
        for (let i = 0; i < entries.length; i++) {
          const p = entries[i].pauseAt;
          if (p > from && p <= to && !((resolvedMask.value >> i) & 1)) bits |= 1 << i;
        }
        if (bits === 0) return;
        skippedMask.value |= bits;
        setSkippedBits((prev) => prev | bits);
        flog(
          `seek ${from.toFixed(2)}s -> ${to.toFixed(2)}s skips ` +
            `${entries.filter((_, i) => (bits >> i) & 1).map((e) => `"${e.surface}"`).join(', ')}`
        );
      } else {
        let bits = 0;
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].pauseAt > to && (skippedMask.value >> i) & 1) bits |= 1 << i;
        }
        if (bits === 0) return;
        skippedMask.value &= ~bits;
        setSkippedBits((prev) => prev & ~bits);
        flog(`seek back to ${to.toFixed(2)}s re-arms ${entries.filter((_, i) => (bits >> i) & 1).length} blank(s)`);
      }
    },
    [resolvedMask, skippedMask]
  );

  const view = useMemo<RecallView | null>(() => {
    if (!planned || !video || plan.entries.length === 0) return null;
    const byCue = new Map<number, BlankEntry>();
    plan.entries.forEach((entry, i) => {
      // A skipped blank's word renders as itself — see skippedMask.
      if ((skippedBits >> i) & 1) return;
      // Giveaway mode: the word also renders as itself until its hold
      // engages (or it is answered, so the reveal styling still shows).
      if (
        revealBlanksUntilHeld &&
        i !== heldIndex &&
        !results.has(entry.cueIndex)
      ) {
        return;
      }
      byCue.set(entry.cueIndex, entry);
    });
    return { videoKey: video.id, byCue, results };
  }, [planned, video, plan, results, skippedBits, revealBlanksUntilHeld, heldIndex]);

  const entry = heldIndex >= 0 ? (plan.entries[heldIndex] ?? null) : null;

  /**
   * The bar is only ever over the player area when it has been lifted by the
   * keyboard — with the keyboard down it sits in the band, which is Loro's own
   * region and always fine.
   */
  const obscuresPlayer = HIDE_PLAYER_WHILE_TYPING && entry !== null && keyboardHeight > 0;
  useEffect(() => {
    onObscurePlayer(obscuresPlayer);
    if (obscuresPlayer) flog('player yielded — answer bar is over the player area');
  }, [obscuresPlayer, onObscurePlayer]);

  // The feed must never be left with a hidden player because recall unmounted
  // mid-answer.
  useEffect(() => () => onObscurePlayer(false), [onObscurePlayer]);

  const grading = useMemo<RecallGrading>(
    () => ({ entry, keyboardHeight, grade, replay: replayHeldBlank }),
    [entry, keyboardHeight, grade, replayHeldBlank]
  );

  return (
    <ViewContext.Provider value={view}>
      <NoteSeekContext.Provider value={noteSeek}>
        <GradingContext.Provider value={grading}>
          <AnswerLayer>{children}</AnswerLayer>
        </GradingContext.Provider>
      </NoteSeekContext.Provider>
    </ViewContext.Provider>
  );
}

/**
 * The typed answer, held BELOW the host on purpose.
 *
 * useFrameCallback re-registers its worklet whenever the callback's identity
 * changes (useFrameCallback.ts:49-62), and an inline worklet gets a new
 * identity on every render of the component that owns it. With `answer` in
 * RecallHost, every keystroke would unregister and re-register the hold's
 * frame callback mid-hold — tearing down the thing that is actively holding
 * the video while the user types into it.
 *
 * Down here a keystroke re-renders this component and its two consumers (the
 * answer bar and the one blank slot) and nothing else: the host does not
 * re-render, so the frame callback stays registered, and RecallView keeps its
 * identity so no Karaoke re-renders either.
 */
function AnswerLayer({ children }: { children: ReactNode }) {
  const { entry, keyboardHeight, grade, replay } = useContext(GradingContext);
  const [answer, setAnswerState] = useState('');

  /**
   * THE FRESHEST TEXT, OUTSIDE THE RENDER CYCLE. A submit handler is a
   * closure from the render that bound it, and under a congested JS thread —
   * the clamp re-seating a boundary-hugging hold point is exactly that — the
   * return key's event can be dispatched in the same backed-up queue turn as
   * the final keystrokes, before any of their re-renders. Grading the closed-
   * over state then grades a PREFIX of what was typed, and sentence-initial
   * words are short enough (<4 letters) that matchAnswer allows no edit —
   * so a correctly-typed word came back wrong. The ref is written inside the
   * change handler itself, so it is complete no matter how the renders queue.
   */
  const answerRef = useRef('');
  const setAnswer = useCallback((text: string) => {
    answerRef.current = text;
    setAnswerState(text);
  }, []);

  // A new blank (or none) starts empty. The web clears for the same reason
  // (SubtitleTrack.tsx:266): the next blank's input mounts before anything
  // else clears the field, so without this the previous answer sits in it.
  useEffect(() => {
    answerRef.current = '';
    setAnswerState('');
  }, [entry]);

  const session = useMemo<RecallSession>(
    () => ({
      entry,
      keyboardHeight,
      setAnswer,
      submit: () => {
        const typed = answerRef.current;
        if (!entry || !typed.trim()) return;
        const match = gradeAnswer(typed, entry.word);
        // Temporary [loro:F] instrumentation for the first-word wrong-grade
        // report: the graded STRING is the fact the reveal never shows.
        flog(`submit "${typed}" vs "${entry.word.text}" -> ${match.toUpperCase()}`);
        grade(match, entry);
      },
      /** Skip and reveal. Grades WRONG — the web has no neutral outcome
          (SubtitleTrack.tsx:384). */
      skip: () => {
        if (!entry) return;
        grade('wrong', entry);
      },
      replay: entry ? replay : null,
    }),
    // `answer` is deliberately absent now: submit reads answerRef, so the
    // session no longer changes identity per keystroke. The bar's input value
    // and its canSubmit read AnswerContext, which still does.
    [entry, keyboardHeight, grade, replay, setAnswer]
  );

  return (
    <SessionContext.Provider value={session}>
      <AnswerContext.Provider value={answer}>{children}</AnswerContext.Provider>
    </SessionContext.Provider>
  );
}
