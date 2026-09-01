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

/**
 * The box at which a word counts as KNOWN — stateForBox's own threshold,
 * exported so progress UI can say "2 of 3 correct" against the same line
 * the state flips on. Three correct answers from a fresh save land exactly
 * here; if this number moves, every "of 3" in the apps moves with it.
 */
export const KNOWN_BOX = 3;

/** The display/merge state a word in `box` carries. Exported for the callers
    that save words directly INTO a box (starter deck, calibration escape
    hatch) so box and state can never disagree. */
export function stateForBox(box: number): WordState {
  if (box >= KNOWN_BOX) return 'known';
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
    learnedAt: null,
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
    const state = stateForBox(box);
    return {
      ...word,
      box,
      state,
      dueAt: now + BOX_INTERVALS_MS[box],
      correct: word.correct + 1,
      lastReviewedAt: now,
      // The crossing INTO known is the earning moment "learned this week"
      // counts from. Only the transition stamps — a known word reviewed
      // onward (box 3 -> 4) keeps its original date, and a lapse followed by
      // re-earning stamps afresh, which is the honest reading of both.
      learnedAt:
        state === 'known' && word.state !== 'known' ? now : word.learnedAt,
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
 * The asked-for word's saved record and its earliest audible cue in this
 * video — null if the video never says it, or if the word is not due.
 */
function locateAsked(
  video: Video,
  allWords: SavedWord[],
  text: string,
  now: number
): { cueIndex: number; word: SavedWord; key: string } | null {
  const key = normalizeAnswer(text);
  if (!key) return null;
  let word: SavedWord | undefined;
  for (const w of allWords) {
    // Due-ness still applies; MIN_AGE_MS deliberately does not — see the note
    // on opts.first below.
    if (w.dueAt > now) continue;
    if (normalizeAnswer(w.text) !== key) continue;
    if (moreUrgent(w, word)) word = w;
  }
  if (!word) return null;
  for (let ci = 0; ci < video.cues.length; ci++) {
    for (const spoken of video.cues[ci].words) {
      if (spoken.end - spoken.start <= MIN_AUDIBLE_S) continue;
      if (normalizeAnswer(spoken.text) === key) return { cueIndex: ci, word, key };
    }
  }
  return null;
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
 * `opts.first` NAMES THE WORD THE USER ASKED TO REVIEW, and it changes the
 * shape of the plan rather than just its contents: that word is placed at its
 * earliest audible cue, exempt from every cap, and NOTHING BEFORE IT IS
 * BLANKED. Both halves are the point. Without the exemption a word can be
 * spoken on screen and never asked, because five more urgent words got there
 * first; without the truncation the user tapped "review THIS word" and then
 * had to answer three other people's words before reaching it. It must still
 * be DUE — a graded word does not come back because the feed once jumped here
 * — but the one-minute grace after saving is waived, since asking for a word
 * by name is a louder signal than the clock.
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
  now: number = Date.now(),
  opts: { first?: string } = {}
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
  const asked = opts.first ? locateAsked(video, allWords, opts.first, now) : null;
  if (dueByText.size === 0 && !asked) return new Map();

  const plan = new Map<number, SavedWord>();
  const used = new Set<string>();
  let inFirstTwo = 0;

  // The asked-for word goes in first and decides where the rest of the plan
  // starts, so it is the first blank the user meets.
  let from = 0;
  if (asked) {
    plan.set(asked.cueIndex, asked.word);
    used.add(asked.key);
    if (asked.cueIndex < 2) inFirstTwo++;
    from = asked.cueIndex + 1;
  }

  for (let ci = from; ci < video.cues.length; ci++) {
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
