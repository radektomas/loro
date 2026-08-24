import type { SavedWord, Video, WordState } from './types.ts';

/**
 * Leitner-box spaced repetition for saved words, plus the blank-selection
 * planner that decides which words appear as fill-in-the-blank prompts
 * inside the feed. Pure functions only — persistence lives in storage.ts.
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

/** The display/merge state a word in `box` carries. Exported for the callers
    that save words directly INTO a box (starter deck, calibration escape
    hatch) so box and state can never disagree. */
export function stateForBox(box: number): WordState {
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

/** Three-way grade for a typed answer. 'almost' is a spelling near-miss. */
export type AnswerMatch = 'correct' | 'almost' | 'wrong';

/**
 * Classic two-row Levenshtein distance. Inputs are short, already-normalised
 * words, so the quadratic DP is nowhere near a cost concern.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, sub);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Grade a typed answer with a near-miss tier. Both sides pass through
 * normalizeAnswer first, so accents, case and edge punctuation are already
 * forgiven — 'almost' is spelling-only, on top of that forgiveness.
 *
 * The rule, on the normalised expected length L:
 *  - L < 4: never 'almost'. One edit on "el"/"es"/"tu" is a different word,
 *    and the dangerous accent pairs (el/él, esta/está) are already folded to
 *    'correct' by normalizeAnswer.
 *  - 4 <= L <= 7: 'almost' iff distance <= 1.
 *  - L >= 8: 'almost' iff distance <= 2. Plain Levenshtein prices a
 *    transposition at 2, so "nesecito" -> "necesito" lands here — that is the
 *    reason for the 2-at-8 tier.
 *
 * Downstream grading treats 'almost' as correct (the caller maps it); the
 * three-way value exists for the UI, which shows yellow plus the exact
 * spelling instead of the green celebration.
 */
export function matchAnswer(answer: string, expected: string): AnswerMatch {
  const a = normalizeAnswer(answer);
  const e = normalizeAnswer(expected);
  if (!a || !e) return 'wrong';
  if (a === e) return 'correct';
  const limit = e.length >= 8 ? 2 : e.length >= 4 ? 1 : 0;
  if (limit === 0 || Math.abs(a.length - e.length) > limit) return 'wrong';
  return levenshtein(a, e) <= limit ? 'almost' : 'wrong';
}

/** A word with no audible span was never heard, so it can't be recalled. */
const MIN_AUDIBLE_S = 0.05;

/** Pick the more urgent of two saved words: lowest box, then earliest due. */
function moreUrgent(a: SavedWord, b: SavedWord | undefined): boolean {
  return !b || a.box < b.box || (a.box === b.box && a.dueAt < b.dueAt);
}

/**
 * Decide which cue positions of `video` become blanks right now.
 * Returns cueIndex -> the word to blank. Rules:
 *  - only due words (dueAt <= now) saved at least 1 minute ago
 *  - a word is reviewable in ANY video that speaks it, not just the one it
 *    was saved from (see below)
 *  - one blank per cue, and never the same word twice in one video; where
 *    several words compete, the lowest box wins
 *  - at most one blank within the first two cues
 *  - at most five blanks per video
 * Words not chosen simply stay due for a later video.
 *
 * WHY REVIEW IS CROSS-VIDEO. This used to require `w.videoId === video.id`,
 * which quietly disabled spaced repetition: the feed is a finite list that
 * does not repeat, so once a slide scrolled past, its words could never come
 * up again and the whole Leitner schedule (1 min -> 60 days) scheduled
 * reviews that could never fire. Matching on the spoken word instead means a
 * word saved today genuinely returns in tomorrow's feed — measured on the
 * first 30 published videos, 21% of teachable words recur across videos, and
 * that share grows with the catalog.
 *
 * The saved word keeps its ORIGIN videoId — it is the same review item, seen
 * somewhere new — so grading, storage keys and /vocab attribution are all
 * unchanged. The known cost is that the prompt shows the gloss from where the
 * word was first met, which can read slightly off for a word used in another
 * sense elsewhere. Accepted deliberately: a slightly-off prompt beats a
 * review that never happens.
 */
export function computeBlankPlan(
  video: Video,
  allWords: SavedWord[],
  now: number = Date.now()
): Map<number, SavedWord> {
  // The most urgent due review per distinct word. Saving the same word from
  // two videos creates two entries (storage keys on text+videoId); they are
  // one thing to practise, so they compete rather than both being blanked.
  const dueByText = new Map<string, SavedWord>();
  for (const w of allWords) {
    if (w.dueAt > now || now - w.savedAt < MIN_AGE_MS) continue;
    const key = normalizeAnswer(w.text);
    if (!key) continue;
    if (moreUrgent(w, dueByText.get(key))) dueByText.set(key, w);
  }
  if (dueByText.size === 0) return new Map();

  const plan = new Map<number, SavedWord>();
  const used = new Set<string>();
  let inFirstTwo = 0;

  for (let ci = 0; ci < video.cues.length; ci++) {
    if (plan.size >= MAX_BLANKS_PER_VIDEO) break;
    if (ci < 2 && inFirstTwo >= MAX_BLANKS_IN_FIRST_TWO_CUES) continue;

    let chosen: SavedWord | undefined;
    let chosenKey = '';
    for (const word of video.cues[ci].words) {
      if (word.end - word.start <= MIN_AUDIBLE_S) continue;
      const key = normalizeAnswer(word.text);
      if (!key || used.has(key)) continue;
      const candidate = dueByText.get(key);
      if (candidate && moreUrgent(candidate, chosen)) {
        chosen = candidate;
        chosenKey = key;
      }
    }
    if (!chosen) continue;

    plan.set(ci, chosen);
    used.add(chosenKey);
    if (ci < 2) inFirstTwo++;
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
