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
import { LEVELS_ENABLED, buildLevelPlan } from './levelBlanks';
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
  grade: (match: AnswerMatch) => void;
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
  language,
  focusWord,
  onObscurePlayer,
  children,
}: {
  /** The ACTIVE slide's video, or null. */
  video: (Video & { youtubeId: string }) | null;
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
   * "active" is just "the player is actually holding it". Planning against a
   * video the player has not loaded would arm a hold against another video's
   * clock.
   *
   * `video` is also null whenever the feed is not the visible tab (FeedScreen
   * passes it through the tab-active gate), so this one check disarms the hold
   * off-tab as well as between slides: no frame callback, no pause/seek fired
   * at a hidden player, no hold engaged on a screen nobody is looking at.
   */
  const owns = Boolean(video) && status.loadedVideoId === video?.youtubeId;
  // Either feature arms the hold; both can be on at once and the merged plan
  // carries both kinds.
  const armed = (recallActive || LEVELS_ENABLED) && owns && video !== null;

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

  entriesRef.current = plan.entries;

  /**
   * Plan when the slide takes the screen — the analogue of Feed.tsx:567-586.
   * Graded words get a future dueAt, so a replan never repeats them.
   *
   * Selection, throttling and due-ness are entirely core's: this passes the
   * whole saved list to computeBlankPlan and takes what it returns. The read is
   * synchronous (MMKV), which is the property platform.ts insists on.
   */
  useEffect(() => {
    if (!armed || !video) {
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
    const recallEntries = recallActive
      ? buildRecallPlan(video, saved, Date.now(), focusWord)
      : [];
    if (recallEntries.length > 0) {
      flog(
        `plan video=${video.id} green=${recallEntries.length} ` +
          recallEntries
            .map((e) => `[cue${e.cueIndex} "${e.surface}" @${e.pauseAt.toFixed(2)}s]`)
            .join(' ')
      );
    }

    const levelEntries = LEVELS_ENABLED
      ? buildLevelPlan(
          video,
          storage.getLevelState().level,
          saved,
          language,
          new Set(recallEntries.map((e) => e.cueIndex))
        )
      : [];

    setPlan(mergeBlankPlans(levelEntries, recallEntries));
    // recallActive is listed even though `armed` already folds it in: with
    // LEVELS_ENABLED on, `armed` is true either way, so arming recall
    // mid-session would not otherwise replan the slide already on screen and
    // the user would see nothing until the next swipe. focusWord for the same
    // class of reason: the jump can land on the slide already on screen, and
    // that plan has to be rebuilt around the word that was asked for.
  }, [armed, recallActive, video, language, focusWord]);

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
    lastActionAt.value = 0;
    measuredSv.value = 0;
    replayingSv.value = 0;
    reseatsRef.current = 0;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    Keyboard.dismiss();
  }, [plan, heldSv, resolvedMask, lastActionAt, measuredSv, replayingSv]);

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
      if ((resolvedMask.value >> i) & 1) continue;
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
    (match: AnswerMatch) => {
      const index = heldSv.value;
      const entry = entriesRef.current[index];
      if (!entry) return;

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
      if (sessionComplete || wasCorrect) {
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
          if (armedRef.current) api.play();
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

  const view = useMemo<RecallView | null>(() => {
    if (!armed || !video || plan.entries.length === 0) return null;
    const byCue = new Map<number, BlankEntry>();
    for (const entry of plan.entries) byCue.set(entry.cueIndex, entry);
    return { videoKey: video.id, byCue, results };
  }, [armed, video, plan, results]);

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
      <GradingContext.Provider value={grading}>
        <AnswerLayer>{children}</AnswerLayer>
      </GradingContext.Provider>
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
  const [answer, setAnswer] = useState('');

  // A new blank (or none) starts empty. The web clears for the same reason
  // (SubtitleTrack.tsx:266): the next blank's input mounts before anything
  // else clears the field, so without this the previous answer sits in it.
  useEffect(() => {
    setAnswer('');
  }, [entry]);

  const session = useMemo<RecallSession>(
    () => ({
      entry,
      keyboardHeight,
      setAnswer,
      submit: () => {
        if (!entry || !answer.trim()) return;
        grade(gradeAnswer(answer, entry.word));
      },
      /** Skip and reveal. Grades WRONG — the web has no neutral outcome
          (SubtitleTrack.tsx:384). */
      skip: () => {
        if (!entry) return;
        grade('wrong');
      },
      replay: entry ? replay : null,
    }),
    [entry, keyboardHeight, answer, grade, replay]
  );

  return (
    <SessionContext.Provider value={session}>
      <AnswerContext.Provider value={answer}>{children}</AnswerContext.Provider>
    </SessionContext.Provider>
  );
}
