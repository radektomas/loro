import type { Cue } from '@loro/core/types';

/**
 * Karaoke index maths, as flat number arrays a worklet can scan.
 *
 * ⚠️ WRITTEN HERE, NOT IMPORTED FROM CORE — core has no computeSubtitleState or
 * anything equivalent. On the web this logic is four lines inlined in the rAF
 * loop of components/SubtitleTrack.tsx:200-206:
 *
 *   const ci = cues.findIndex((c) => t >= c.start && t <= c.end);
 *   setWordIndex(cues[ci].words.findIndex((w) => t >= w.start && t < w.end));
 *
 * The boundary conditions are copied exactly, including the asymmetry: a cue
 * matches on `t <= c.end` (inclusive) while a word matches on `t < w.end`
 * (exclusive). That is not a typo in either place — a cue must stay displayed
 * through its final instant, and adjacent words must never both match.
 *
 * This is a candidate to promote into core when the web feed and the RN feed
 * both want it (checkpoint F, where the blank hold needs the same scan). Left
 * app-side for now because this checkpoint may not touch packages/core.
 *
 * WHY FLAT NUMBER ARRAYS. The scan runs in a Reanimated worklet on the UI
 * thread, and a worklet captures its closure by value — a nested Cue[] with
 * word objects and translation records would be deep-copied into the UI runtime
 * every time the active video changes. Plain number arrays copy cheaply and
 * scan without property lookups.
 */

export type CueSpans = {
  /** [start, end, start, end, …] per cue. */
  cueBounds: number[];
  /** [start, end, start, end, …] per word, in cue order. */
  wordBounds: number[];
  /** Index into wordBounds/2 where each cue's words begin. */
  cueWordStart: number[];
  /** How many words each cue has. */
  cueWordCount: number[];
};

export const EMPTY_SPANS: CueSpans = {
  cueBounds: [],
  wordBounds: [],
  cueWordStart: [],
  cueWordCount: [],
};

export function buildCueSpans(cues: Cue[]): CueSpans {
  const cueBounds: number[] = [];
  const wordBounds: number[] = [];
  const cueWordStart: number[] = [];
  const cueWordCount: number[] = [];

  for (const cue of cues) {
    cueBounds.push(cue.start, cue.end);
    cueWordStart.push(wordBounds.length / 2);
    cueWordCount.push(cue.words.length);
    for (const word of cue.words) wordBounds.push(word.start, word.end);
  }

  return { cueBounds, wordBounds, cueWordStart, cueWordCount };
}

/**
 * Which cue is on screen at time `t`, or -1.
 *
 * A worklet — it runs on the UI thread from useFrameCallback. `hint` is the
 * previous answer: playback is monotonic, so checking it first turns the common
 * frame into two comparisons instead of a scan over every cue in the video.
 */
export function cueIndexAt(spans: CueSpans, t: number, hint: number): number {
  'worklet';
  const bounds = spans.cueBounds;
  const count = bounds.length / 2;
  if (count === 0) return -1;

  if (hint >= 0 && hint < count) {
    if (t >= bounds[hint * 2] && t <= bounds[hint * 2 + 1]) return hint;
    // The very next cue is the other overwhelmingly likely answer.
    const next = hint + 1;
    if (next < count && t >= bounds[next * 2] && t <= bounds[next * 2 + 1]) return next;
  }

  for (let i = 0; i < count; i++) {
    if (t >= bounds[i * 2] && t <= bounds[i * 2 + 1]) return i;
  }
  return -1;
}

/**
 * The start of the line the clock is "in" at time `t`: the active cue, or —
 * between cues — the one that just finished. Null before the first cue, when
 * there is nothing behind the playhead to replay. Plain JS (not a worklet):
 * its caller is a press handler, a once-per-tap read, not a per-frame one.
 */
export function currentCueStart(cues: Cue[], t: number): number | null {
  let start: number | null = null;
  for (const cue of cues) {
    if (cue.start > t) break;
    start = cue.start;
  }
  return start;
}

/** Which word within `cueIndex` is being spoken at `t`, or -1. Worklet. */
export function wordIndexAt(spans: CueSpans, cueIndex: number, t: number): number {
  'worklet';
  if (cueIndex < 0) return -1;
  const start = spans.cueWordStart[cueIndex];
  const count = spans.cueWordCount[cueIndex];
  const bounds = spans.wordBounds;
  for (let i = 0; i < count; i++) {
    const b = (start + i) * 2;
    // `t < end`, exclusive — see the header note.
    if (t >= bounds[b] && t < bounds[b + 1]) return i;
  }
  return -1;
}
