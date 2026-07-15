import type { SavedWord, Video, WordState } from '@/types';

/**
 * Leitner-box spaced repetition for saved words, plus the blank-selection
 * planner that decides which words appear as fill-in-the-blank prompts
 * inside the feed. Pure functions only — persistence lives in lib/storage.
 */

const MIN = 60_000;
const DAY = 24 * 60 * 60_000;

/**
 * Review intervals per Leitner box 0-6.
 *
 * The two extra early boxes (1 min, 10 min) make a word's FIRST session dense —
 * a freshly saved word comes back almost immediately — without adding anything
 * to the long tail. Boxes 0-2 are the rapid learning phase; boxes 3+ are the
 * calm mastery schedule.
 */
export const BOX_INTERVALS_MS = [
  1 * MIN, //  box 0 — 1 minute
  10 * MIN, // box 1 — 10 minutes
  1 * DAY, //  box 2 — 1 day
  3 * DAY, //  box 3 — 3 days
  7 * DAY, //  box 4 — 7 days
  21 * DAY, // box 5 — 21 days
  60 * DAY, // box 6 — 60 days
];

export const MAX_BOX = BOX_INTERVALS_MS.length - 1;

/** Blank throttling — the feed must never feel like a test. */
const MAX_BLANKS_PER_VIDEO = 5;
const MAX_BLANKS_IN_FIRST_TWO_CUES = 1;
/** Never blank a word saved less than this long ago (matches box 0's interval). */
const MIN_AGE_MS = 1 * MIN;

function stateForBox(box: number): WordState {
  if (box >= 3) return 'known';
  if (box >= 1) return 'learning';
  return 'new';
}

/** SRS fields for a freshly saved word. */
export function initialSrs(now: number = Date.now()) {
  return {
    state: 'new' as WordState,
    box: 0,
    dueAt: now + BOX_INTERVALS_MS[0],
    correct: 0,
    incorrect: 0,
    lastReviewedAt: null,
  };
}

/** Apply one review result and return the rescheduled word. */
export function grade(
  word: SavedWord,
  wasCorrect: boolean,
  now: number = Date.now()
): SavedWord {
  if (wasCorrect) {
    const box = Math.min(word.box + 1, MAX_BOX);
    return {
      ...word,
      box,
      state: stateForBox(box),
      dueAt: now + BOX_INTERVALS_MS[box],
      correct: word.correct + 1,
      lastReviewedAt: now,
    };
  }
  return {
    ...word,
    box: 0,
    state: 'lapsed',
    dueAt: now + BOX_INTERVALS_MS[0],
    incorrect: word.incorrect + 1,
    lastReviewedAt: now,
  };
}

/**
 * Normalise for answer grading and word matching: lowercase, strip accents
 * (NFD + remove combining marks) and surrounding punctuation. "¡Están!" and
 * "estan" compare equal.
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

/**
 * Decide which cue positions of `video` become blanks right now.
 * Returns cueIndex -> the word to blank. Rules:
 *  - only due words (dueAt <= now) saved at least 1 minute ago
 *  - one blank per cue; if several words are due, the lowest box wins
 *  - at most one blank within the first two cues
 *  - at most five blanks per video
 * Words not chosen simply stay due for a later video.
 */
export function computeBlankPlan(
  video: Video,
  allWords: SavedWord[],
  now: number = Date.now()
): Map<number, SavedWord> {
  const candidates = allWords.filter(
    (w) =>
      w.videoId === video.id &&
      w.dueAt <= now &&
      now - w.savedAt >= MIN_AGE_MS &&
      video.cues[w.cueIndex]?.words.some(
        (cw) => normalizeAnswer(cw.text) === normalizeAnswer(w.text)
      )
  );

  // one candidate per cue: lowest box, then earliest due
  const byCue = new Map<number, SavedWord>();
  for (const w of candidates) {
    const current = byCue.get(w.cueIndex);
    if (
      !current ||
      w.box < current.box ||
      (w.box === current.box && w.dueAt < current.dueAt)
    ) {
      byCue.set(w.cueIndex, w);
    }
  }

  const plan = new Map<number, SavedWord>();
  let inFirstTwo = 0;
  for (const cueIndex of [...byCue.keys()].sort((a, b) => a - b)) {
    if (plan.size >= MAX_BLANKS_PER_VIDEO) break;
    if (cueIndex < 2) {
      if (inFirstTwo >= MAX_BLANKS_IN_FIRST_TWO_CUES) continue;
      inFirstTwo++;
    }
    plan.set(cueIndex, byCue.get(cueIndex)!);
  }
  return plan;
}

/** Human next-due label: "now", "in 8 min", "in 3 hours", "in 2 days". */
export function formatDue(dueAt: number, now: number = Date.now()): string {
  const diff = dueAt - now;
  if (diff <= 0) return 'due now';
  const minutes = Math.round(diff / MIN);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(diff / (60 * MIN));
  if (hours < 24) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(diff / DAY);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}
