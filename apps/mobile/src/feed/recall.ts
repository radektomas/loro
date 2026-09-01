import { Vibration } from 'react-native';
import type { Cue, SavedWord, Video } from '@loro/core/types';
import type { LevelBlankWord } from '@loro/core/levels';
import {
  computeBlankPlan,
  matchAnswer,
  normalizeAnswer,
  type AnswerMatch,
} from '@loro/core/srs';

/**
 * CHECKPOINT F — in-cue fill-in-the-blank recall. Flags, constants and the
 * plan builder.
 *
 * THIS FILE IS WHERE THE FLAGS LIVE. Not platform/config.ts: that file is
 * documented as "platform constants for the RN drivers" and holds values that
 * differ per ENVIRONMENT (Supabase origin, API origin). RECALL_ENABLED is a
 * feature flag, not an environment value, so it sits with the feature it gates.
 *
 * Nothing here reimplements SRS. computeBlankPlan, normalizeAnswer, grade and
 * storage.gradeWord all come from @loro/core untouched — this module only
 * turns core's cueIndex->SavedWord plan into the extra shape the RN hold needs
 * (a pause timestamp per blank, and a worklet-friendly array of them).
 */

/**
 * THE MASTER SWITCH — now TRUE: recall ships. Due-word blanks appear in the
 * ordinary feed, exactly as on web (computeBlankPlan runs on every slide
 * activation there, unconditionally). The dark-ship era of this flag is over;
 * it stays a plain constant rather than an env var for the original reason —
 * "is recall on?" must be answerable by reading the file.
 */
export const RECALL_ENABLED = true;

/**
 * THE RUNTIME ENABLE — now redundant, kept as the explicit entry point.
 *
 * With RECALL_ENABLED true, isRecallActive() is always true and this session
 * flag decides nothing. It survives because /vocab's "Review" CTA and the
 * notification tap route still call enableRecallForSession() as their
 * declared way into a review session; deleting the arm means touching both
 * call sites for zero behaviour change. Per the original note here, the full
 * cleanup (delete flag + arm, always-on like the web) is fine to do whenever
 * those call sites are next edited.
 */
let recallSessionEnabled = false;
const recallListeners = new Set<() => void>();

/** Effective recall state — the compile-time default OR the session enable. */
export function isRecallActive(): boolean {
  return RECALL_ENABLED || recallSessionEnabled;
}

/** Arm recall for the rest of this process. Idempotent. */
export function enableRecallForSession(): void {
  if (recallSessionEnabled) return;
  recallSessionEnabled = true;
  flog('recall ARMED for this session (Review tapped)');
  for (const listener of recallListeners) listener();
}

/** Subscribe/snapshot pair for useSyncExternalStore. */
export function subscribeRecallActive(listener: () => void): () => void {
  recallListeners.add(listener);
  return () => recallListeners.delete(listener);
}

/**
 * R7 — DO NOT AUTO-FOCUS THE INPUT UNTIL THE OVERLAP IS MEASURED.
 *
 * The web focuses one rAF after pausing (SubtitleTrack.tsx:192-194). Here the
 * keyboard animates in over ~250ms while the re-seat clamp may still be
 * correcting the clock, so auto-focus would run two layout/timing systems on
 * top of each other before we know what either costs. With this false the
 * answer bar appears unfocused and the user taps it to raise the keyboard —
 * which also means the [loro:F] hold numbers are measured WITHOUT a keyboard
 * animation in the same window, i.e. clean.
 *
 * Flip to true once the numbers are in.
 */
export const AUTO_FOCUS_BLANK = false;

/**
 * Haptic on a correct answer.
 *
 * ⚠️ NOT expo-haptics, and that is a deliberate trade rather than an omission.
 * expo-haptics is not a dependency of this app and adding it means a new
 * native module, i.e. an EAS dev-client rebuild — which would make checkpoint F
 * un-testable by reload. react-native's Vibration is core and needs no rebuild.
 *
 * The cost, stated plainly: iOS IGNORES the duration argument, so this is a
 * standard system vibration rather than the web's 15ms tap. Android honours
 * the 15ms. If that reads too heavy on device, set this false — or install
 * expo-haptics, rebuild, and swap the one line in recallHaptic() for
 * Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light). Nothing else changes.
 */
export const HAPTIC_ON_CORRECT = true;

/**
 * Fade the player out while the keyboard is up. ⚠️ THE ONE JUDGEMENT CALL IN
 * CHECKPOINT F — read this before changing it.
 *
 * "Keep the band still and put the input above the keyboard" cannot be done
 * compliantly on its own, because of geometry rather than code. The band is
 * ~210pt; an iPhone keyboard is ~336pt. Anything sitting above the keyboard is
 * therefore ~126pt ABOVE the band's top edge — i.e. inside the player area.
 * There is no height at which the answer bar is both visible and clear of the
 * player, so "move the player" and "move the input" are not two options: any
 * visible input forces the player to yield.
 *
 * Of the two ways to make it yield, this is the cheaper one. Shrinking the box
 * keeps the video on screen but resizes a WKWebView holding a YouTube iframe,
 * and this file's neighbours are emphatic that the frame must not resize
 * mid-video (Karaoke.tsx's placeholder, SubtitleTrack's min-height note).
 * Hiding reuses the fade that already runs on every swipe (PlayerHost's
 * box.visible, poster underneath) and adds no new geometry at all.
 *
 * What the user actually sees, and why this keeps the moment intact: the video
 * pauses ON the word and STAYS VISIBLE — that is the web's moment, unchanged.
 * It only fades once the keyboard comes up to type, and returns as the answer
 * is graded. With AUTO_FOCUS_BLANK false, that is a deliberate tap.
 *
 * Set false only alongside a different answer to the geometry above; on its
 * own it reintroduces Loro UI over the player.
 */
export const HIDE_PLAYER_WHILE_TYPING = true;

/** Resume rhythm, from the web verbatim (Feed.tsx:629-635). */
export const RESUME_MS_CORRECT = 600;
export const RESUME_MS_WRONG = 1500;

/**
 * The web's clamp tolerance (SubtitleTrack.tsx:176). A paused clock further
 * than this from the hold point is displaced and gets re-seated.
 */
export const RESEAT_EPSILON_S = 0.05;

/** The web's "a hair into the cue" pad (SubtitleTrack.tsx:164). */
export const CUE_START_PAD_S = 0.02;

/**
 * A LAST-WORD BLANK MUST HOLD STRICTLY INSIDE ITS CUE, and this is how far
 * inside (2026-09-01, Radek on device: blank the final word of a line and
 * the subtitles jump to the NEXT line, then the correct answer celebrates
 * into a cue that never had the blank).
 *
 * The mechanics, because the fix looks like a magic number without them:
 * for a final word, word.end IS cue.end, so the web's formula holds exactly
 * on the boundary — and with contiguous cues that timestamp belongs to both
 * lines. cueIndexAt checks bounds inclusively on BOTH ends and gives the
 * HINT first claim (subtitles.ts), so the sequence is: the pause's bridge
 * latency lets the extrapolated clock run past the boundary, the display
 * flips to the next cue and the next cue becomes the hint, the re-seat
 * clamp then drags the clock back to exactly cue.end — which still
 * satisfies the next cue's `t >= start`, so the hint STICKS. The line with
 * the gap in it never comes back; the blank, the reveal and the
 * celebration all render inside the blank's own cue, so all three play to
 * an empty room.
 *
 * 0.12s, not a hair: the re-seat declares convergence within
 * RESEAT_EPSILON_S (0.05) of pauseAt, so the pad must leave the WHOLE
 * convergence window strictly inside the cue — 0.12 keeps a converged
 * clock at least 0.07s clear of the boundary. The cost is holding ~a tenth
 * of a second before the final word's tail; the pause reaches the player
 * hundreds of milliseconds late anyway (that is what the clamp exists
 * for), so the word is always fully heard.
 */
export const CUE_END_PAD_S = 0.12;

/**
 * Minimum gap between two bridge actions for the same hold.
 *
 * THE WEB DOES NOT NEED THIS AND WE DO. There, pause() is synchronous — the
 * next rAF already sees video.paused. Here pause() is a postMessage, so for
 * the whole round trip isPlaying is still true and the clock still
 * extrapolates past pauseAt. Without a debounce the frame callback would fire
 * a fresh pause+seek every frame of that window (~10-20 of them) and each one
 * would restart the round trip.
 */
export const HOLD_ACTION_DEBOUNCE_MS = 350;

/**
 * Give up re-seating after this many attempts on one blank.
 *
 * A seek that never converges would otherwise re-seat forever. The input lives
 * in the answer bar rather than in the line, so a displaced clock costs the
 * in-line blank rendering, not the ability to answer — degraded, not stuck.
 * Exceeding this logs once and stops.
 */
export const MAX_RESEATS_PER_BLANK = 6;

/** Everything both kinds of blank need to be held and answered. */
type BlankBase = {
  /** Cue this blank sits in. */
  cueIndex: number;
  /** Index of the blanked word WITHIN that cue. */
  wordIndex: number;
  /**
   * The clock position to hold at: the blanked word's END, clamped inside the
   * cue's display window. Copied from the web (SubtitleTrack.tsx:164) including
   * the reason — pipeline data can carry a word whose end sits exactly on
   * cue.start, and holding on that boundary displays the PREVIOUS cue.
   */
  pauseAt: number;
  /** The cue's own surface form — what a reveal shows. */
  surface: string;
};

/**
 * One blank, of either kind — the same union the web runs on
 * (SubtitleTrack.tsx:41-43), and for the same stated reason: both kinds share
 * the exact pause-at-word-end + typed-input interaction, and `kind` only picks
 * the accent, the label, and which grade call fires.
 *
 * 'recall' carries a SavedWord whose ORIGIN videoId is what storage.gradeWord
 * keys on — a word reviewed cross-video still grades the row it was saved from
 * (srs.ts:119-133). 'level' carries core's LevelBlankWord, which additionally
 * knows the frequency BAND it came from (`word.level`), and that band is what
 * the tier chip names — not the user's level. The two differ whenever the exact
 * band had no material in this video (levels.ts:296-299).
 */
export type BlankEntry =
  | (BlankBase & { kind: 'recall'; word: SavedWord })
  | (BlankBase & { kind: 'level'; word: LevelBlankWord });

export type RecallPlan = {
  entries: BlankEntry[];
  /**
   * Just the pause timestamps, in entry order. The hold's frame callback is a
   * worklet and captures its closure by value, so it takes this rather than
   * `entries` — the same plain-number discipline as subtitles.ts, and for the
   * same reason.
   */
  pauseAts: number[];
};

export const EMPTY_PLAN: RecallPlan = { entries: [], pauseAts: [] };

/**
 * Resolved state is carried as a bitmask in a shared value, so the worklet can
 * skip answered blanks without reading a JS structure. core caps a video at
 * MAX_BLANKS_PER_VIDEO = 5 (srs.ts:33), so 31 bits is not a real constraint —
 * this only exists so the mask can never silently lose a blank if that cap
 * ever moves.
 */
const MAX_TRACKABLE_BLANKS = 31;

/**
 * core's blank plan, resolved into positions.
 *
 * computeBlankPlan answers "which cue gets a blank, and with which saved
 * word". The hold additionally needs to know WHERE IN THE CUE that word is
 * spoken, so this locates it — by normalizeAnswer, exactly as the web does
 * (SubtitleTrack.tsx:234-240), because the cue's surface form and the saved
 * form differ by accent and case.
 *
 * All selection, throttling and due-ness stays in core. This function chooses
 * nothing.
 */
export function buildRecallPlan(
  video: Video,
  words: SavedWord[],
  now: number,
  /** The word a targeted review asked for — core places it first. */
  first?: string | null,
  /**
   * Pin the asked-for word's blank to THIS cue instead of the earliest one
   * locateAsked found. The onboarding walkthrough needs it: its coached word
   * is also spoken in the fill clip's opening line, before the clip even
   * opens, so "earliest audible cue" lands the blank somewhere nobody will
   * ever see. When the pin lands it becomes the WHOLE plan (see below).
   * Best-effort like everything scripted — if the word is not in this cue,
   * the plan keeps core's placement rather than losing the blank.
   */
  firstCueIndex?: number
): BlankEntry[] {
  const entries: BlankEntry[] = [];
  for (const [cueIndex, word] of computeBlankPlan(video, words, now, {
    first: first ?? undefined,
  })) {
    const at = locateBlank(video.cues[cueIndex], word.text);
    if (!at) continue;
    entries.push({ kind: 'recall', cueIndex, word, ...at });
  }

  /**
   * THE PIN, when a script names the cue — and the pin WINS THE WHOLE CLIP:
   * the plan collapses to exactly one entry, the asked word at the pinned
   * cue. Two device-measured lessons are folded into that (2026-09-01):
   *
   *   - The pin must EVICT, not yield. The first version kept whatever core
   *     had already planned on the pinned cue, and on a device with stale
   *     saved words core routinely puts one there ("como", saved in an
   *     earlier test run, lands on the very cue "que" is pinned to). The
   *     asked word then stayed at its earliest cue — BEFORE the
   *     walkthrough's startAt — and no blank ever appeared at all.
   *   - The rest of the plan goes with it. A scripted fill beat is ONE
   *     blank; other due words freezing the clip seconds after the coached
   *     answer would turn the beat into a quiz.
   *
   * Only the onboarding walkthrough passes firstCueIndex, so the real feed
   * and the Words-tab targeted review (which passes only `first`) never
   * take this branch. If the word cannot be located in the pinned cue, the
   * full plan stands untouched — best-effort, like everything scripted.
   */
  if (first && firstCueIndex !== undefined) {
    const key = normalizeAnswer(first);
    const asked = entries.find((e) => normalizeAnswer(e.word.text) === key);
    if (asked && asked.kind === 'recall') {
      const at = locateBlank(video.cues[firstCueIndex], asked.word.text);
      if (at) {
        flog(
          `focus "${first}" pinned to cue ${firstCueIndex}` +
            (asked.cueIndex !== firstCueIndex
              ? ` (core placed it at cue ${asked.cueIndex})`
              : '') +
            (entries.length > 1
              ? `, ${entries.length - 1} other planned blank(s) dropped — scripted beat`
              : '')
        );
        return [{ kind: 'recall', cueIndex: firstCueIndex, word: asked.word, ...at }];
      }
    }
  }
  return entries;
}

/**
 * Where in the cue a blanked word sits, and where to hold the clock for it.
 *
 * SHARED BY BOTH PLAN BUILDERS so a blue blank and a green one can never be
 * held at subtly different points. Located by normalizeAnswer exactly as the
 * web does (SubtitleTrack.tsx:234-240), because the cue's surface form and the
 * planned form differ by accent and case.
 */
export function locateBlank(
  cue: Cue | undefined,
  wordText: string
): { wordIndex: number; pauseAt: number; surface: string } | null {
  if (!cue) return null;
  const target = normalizeAnswer(wordText);
  /**
   * PREFER THE OCCURRENCE THE PLANNERS COULD HAVE CHOSEN. Both planners skip
   * words with no audible span (srs.ts MIN_AUDIBLE_S, levels.ts inline — both
   * 0.05s), but a cue can hold the same surface twice: an inaudible alignment
   * artifact at position 0 and the audible occurrence the plan actually meant.
   * A bare findIndex pinned the blank — and the hold point — on the artifact,
   * which for a sentence-initial duplicate froze the video at cue.start+pad,
   * before the line was ever heard. Fall back to the bare match so a cue that
   * only says the word inaudibly still degrades the way it always did.
   */
  const audibleIndex = cue.words.findIndex(
    (w) => w.end - w.start > 0.05 && normalizeAnswer(w.text) === target
  );
  const wordIndex =
    audibleIndex >= 0
      ? audibleIndex
      : cue.words.findIndex((w) => normalizeAnswer(w.text) === target);
  // Both core planners only pick a cue whose words contain the word, so a miss
  // means the cue changed under us. Drop the blank rather than hold at a
  // position that does not exist.
  if (wordIndex < 0) return null;
  const blankWord = cue.words[wordIndex];
  /**
   * The ceiling is padded INSIDE the cue's end — see CUE_END_PAD_S for the
   * last-word boundary failure this prevents. The outer max keeps a
   * degenerate sub-0.14s cue from inverting the clamp; there the start pad
   * wins and the hold degrades to the old boundary behaviour rather than to
   * a position before the cue.
   */
  const holdCeiling = Math.max(cue.start + CUE_START_PAD_S, cue.end - CUE_END_PAD_S);
  return {
    wordIndex,
    pauseAt: Math.min(holdCeiling, Math.max(blankWord.end, cue.start + CUE_START_PAD_S)),
    surface: blankWord.text,
  };
}

/**
 * Merge the two plans into the ordered list the hold walks.
 *
 * THE PRECEDENCE IS THE WEB'S, TWICE OVER. core already keeps them disjoint —
 * the feed passes the recall plan's cues to computeLevelBlankPlan as
 * `excludeCues`, and computeLevelBlankPlan additionally skips any word already
 * in the SRS (levels.ts:311). This merge is the same belt-and-braces the web
 * keeps at render (SubtitleTrack.tsx:109-118): level entries go in FIRST, then
 * recall entries overwrite, so on a cue collision the user's own saved word
 * always wins.
 *
 * Sorted by cue because the hold walks the array expecting monotonic pause
 * points and returns early on the first one still ahead of the clock.
 */
export function mergeBlankPlans(
  levelEntries: BlankEntry[],
  recallEntries: BlankEntry[]
): RecallPlan {
  const byCue = new Map<number, BlankEntry>();
  for (const entry of levelEntries) byCue.set(entry.cueIndex, entry);
  for (const entry of recallEntries) byCue.set(entry.cueIndex, entry);

  const entries = [...byCue.values()]
    .sort((a, b) => a.cueIndex - b.cueIndex)
    .slice(0, MAX_TRACKABLE_BLANKS);

  return { entries, pauseAts: entries.map((e) => e.pauseAt) };
}

/**
 * Grade one typed answer — core's matchAnswer: normalizeAnswer on both sides
 * (accent- and case-insensitive, punctuation trimmed) plus the spelling
 * near-miss tier ('almost', Levenshtein <=1 at 4-7 letters, <=2 at 8+). NO
 * lemma tolerance: "están" answers "estan", but "estar" does not.
 *
 * Compared against the SAVED word's text rather than the cue's surface form —
 * the two are equal after normalisation by construction (computeBlankPlan
 * matched them that way). Downstream grading maps 'almost' to correct; the
 * three-way value exists for the UI (yellow reveal instead of celebration).
 */
export function gradeAnswer(answer: string, word: { text: string }): AnswerMatch {
  return matchAnswer(answer, word.text);
}

/**
 * How far before the cue's start a segment replay seeks. Embed seeks land
 * within ±0.5s (measured, docs/rn-port-map.md §5e), so aiming exactly at
 * cue.start risks landing after the first word; a 0.4s pad makes "replay the
 * line" reliably include the line's first word.
 */
export const SEEK_BACK_PAD_S = 0.4;

/**
 * Temporary checkpoint-F instrumentation. Prefixed so it greps out in one pass
 * when the hold numbers are settled.
 */
export function flog(message: string): void {
  console.log(`[loro:F] ${message}`);
}

/** Same, for the blue level-blanks. Separate prefix so the two can be read
    apart on device when both flags are on. */
export function llog(message: string): void {
  console.log(`[loro:L] ${message}`);
}

/** ms, one decimal — the hold numbers are sub-frame and round to nothing. */
export function ms(seconds: number): string {
  return `${(seconds * 1000).toFixed(1)}ms`;
}

/**
 * The correct-answer haptic. ONE line, isolated so swapping to expo-haptics is
 * a one-line change — see HAPTIC_ON_CORRECT for why it is not expo-haptics yet.
 */
export function recallHaptic(): void {
  if (!HAPTIC_ON_CORRECT) return;
  try {
    Vibration.vibrate(15);
  } catch {
    // Never let feedback break grading.
  }
}
