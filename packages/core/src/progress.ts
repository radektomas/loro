import type { SavedWord } from './types.ts';
import { normalizeAnswer } from './srs.ts';
import { normalizeSurface } from './dictionary.ts';
import { isFunctionWord } from './glossary.ts';

/**
 * Progress metrics derived from saved words. Pure functions only — persistence
 * lives in storage.ts.
 *
 * Everything here counts real, honest effort: reviews due, and streaks of days
 * with a correct recall. There is deliberately no "comprehension" metric —
 * users only save words they DON'T know, so any score built from saved words
 * measures the opposite of understanding and punishes fluent users. Progress on
 * this screen is measured by what the user has LEARNED, which only ever grows.
 */

// ---------------------------------------------------------------------------
// Learned — the one definition every screen must share

/**
 * Has this word been LEARNED, as opposed to filed as known?
 *
 * Two routes in, both earned through the review loop:
 *   - learnedAt is stamped: the word crossed into known through a graded
 *     answer on this device (srs.grade). The normal case from 2026-09-07 on.
 *   - no stamp, but known with at least two correct answers: a word restored
 *     from Supabase (the stamp does not sync — storage.toRow) or graded
 *     before the stamp existed. Two corrects is the floor because one is
 *     what a legacy level fill carried, and that is the exact case this
 *     definition exists to exclude.
 *
 * Deliberately NOT `state === 'known'`. A starter-deck grant is known on
 * arrival with zero answers, and a legacy level fill was known after one
 * keystroke; neither was learned in Loro, and counting them is how the
 * Progress page came to open on "de ×3".
 */
export function isLearned(word: SavedWord): boolean {
  if (word.learnedAt !== null) return true;
  return word.state === 'known' && word.correct >= 2;
}

/**
 * ONE ENTRY PER DISTINCT WORD, the most advanced one.
 *
 * Storage keys a word on (text, videoId), so "de" saved from three videos is
 * three rows, and the old Progress list rendered all three. Folded through
 * normalizeAnswer — the same identity the blank planner uses when it decides
 * those rows are one thing to practise (srs.computeBlankPlan). Higher box
 * wins; on a tie the later stamp, so "learned this week" reads the freshest
 * crossing.
 */
export function distinctWords(words: readonly SavedWord[]): SavedWord[] {
  const byKey = new Map<string, SavedWord>();
  for (const w of words) {
    const key = normalizeAnswer(w.text);
    if (!key) continue;
    const held = byKey.get(key);
    if (
      !held ||
      w.box > held.box ||
      (w.box === held.box && (w.learnedAt ?? 0) > (held.learnedAt ?? 0))
    ) {
      byKey.set(key, w);
    }
  }
  return [...byKey.values()];
}

/** Local day keys of the current Mon..Sun week — the strip's own columns. */
export function weekKeys(now: number = Date.now()): string[] {
  return weekStrip([], now).map((d) => d.key);
}

/**
 * Words that crossed into known THIS WEEK (local Mon..Sun), one per distinct
 * word, freshest first. Stamp-only on purpose: a restored word carries no
 * stamp, and inventing a date for it would put last month's learning in
 * this week's card.
 */
export function learnedThisWeek(
  words: readonly SavedWord[],
  now: number = Date.now()
): SavedWord[] {
  const week = new Set(weekKeys(now));
  return distinctWords(
    words.filter((w) => w.learnedAt !== null && week.has(dayKey(w.learnedAt)))
  ).sort((a, b) => (b.learnedAt ?? 0) - (a.learnedAt ?? 0));
}

/**
 * Content words first, glue collapsed. "de", "que" and "la" are real
 * answers and real reviews, but as CHIPS on a progress card they read as
 * padding — so the card names the words worth naming and counts the rest.
 */
export function splitFunctionWords<T extends { text: string }>(
  words: readonly T[]
): { content: T[]; small: T[] } {
  const content: T[] = [];
  const small: T[] = [];
  for (const w of words) {
    (isFunctionWord(normalizeSurface(w.text)) ? small : content).push(w);
  }
  return { content, small };
}

/**
 * Words whose LAST answer was today and correct, one per distinct word,
 * freshest first — what the day-done card can honestly show as "today's
 * words". A word answered wrong today is lapsed and excluded; a word
 * answered right today and then wrong is lapsed too, and excluded, which
 * is the truthful reading of its day.
 */
export function answeredCorrectToday(
  words: readonly SavedWord[],
  now: number = Date.now()
): SavedWord[] {
  const today = dayKey(now);
  return distinctWords(
    words.filter(
      (w) =>
        w.correct > 0 &&
        w.state !== 'lapsed' &&
        w.lastReviewedAt !== null &&
        dayKey(w.lastReviewedAt) === today
    )
  ).sort((a, b) => (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0));
}

// ---------------------------------------------------------------------------
// Daily counts — how many correct answers each local day carried

/** "YYYY-MM-DD" -> correct answers that day. Stored by storage.ts. */
export type DailyCounts = Record<string, number>;

/** Keep this many trailing days; older keys are pruned on write. */
export const DAILY_COUNTS_KEEP_DAYS = 70;

export function countForDay(counts: DailyCounts, day: string): number {
  const n = counts[day];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Add one correct answer to `day`, pruning keys older than the window. */
export function bumpDay(
  counts: DailyCounts,
  day: string,
  keepDays: number = DAILY_COUNTS_KEEP_DAYS
): DailyCounts {
  const merged: DailyCounts = {};
  for (const key of Object.keys(counts)) {
    const n = countForDay(counts, key);
    if (n > 0) merged[key] = n;
  }
  merged[day] = countForDay(merged, day) + 1;
  // Day keys sort as dates, so the trailing slice is the newest window.
  const keys = Object.keys(merged).sort();
  const next: DailyCounts = {};
  for (const key of keys.slice(Math.max(0, keys.length - keepDays))) {
    next[key] = merged[key];
  }
  return next;
}

/** How many of `days` reached `goal` correct answers. */
export function daysMeetingGoal(
  counts: DailyCounts,
  days: readonly string[],
  goal: number
): number {
  return days.filter((d) => countForDay(counts, d) >= goal).length;
}

// ---------------------------------------------------------------------------
// Due reviews

export function dueCount(words: SavedWord[], now: number = Date.now()): number {
  return words.filter((w) => w.dueAt <= now).length;
}

/** Earliest upcoming dueAt strictly in the future; null if none. */
export function nextDueAt(
  words: SavedWord[],
  now: number = Date.now()
): number | null {
  let next: number | null = null;
  for (const w of words) {
    if (w.dueAt > now && (next === null || w.dueAt < next)) next = w.dueAt;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Streak — consecutive LOCAL days with at least one correct recall.
// Opening the app is not learning; only correct recalls count.

/** Local calendar day of an epoch-ms timestamp: "2026-07-14". */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Calendar index of a day key — consecutive days differ by exactly 1. */
function dayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** One cell of the week strip. */
export type WeekDay = {
  /** "YYYY-MM-DD" local day key */
  key: string;
  /** Single-letter column heading, Mon-first */
  label: string;
  /** Was the day earned (the daily goal met)? */
  active: boolean;
  /** A missed day the weekly streak freeze covered — see computeStreaks. */
  frozen: boolean;
  isToday: boolean;
  /** Later this week — rendered as empty, never as a miss. */
  isFuture: boolean;
};

const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/**
 * The current week, Monday-first, marked with the days that had a correct
 * recall. Built from the SAME day-key list the streak is computed from
 * (storage.getCorrectRecallDays), so the strip and the number can never
 * disagree.
 *
 * Existing days are what this shows — deliberately. A streak that reset to 0
 * still has real practice behind it, and the strip is how that stays visible
 * instead of the week reading as a failure.
 */
export function weekStrip(
  days: string[],
  now: number = Date.now(),
  /** computeStreaks(days, now).frozen — the days the freeze covered. */
  frozen: readonly string[] = []
): WeekDay[] {
  const set = new Set(days);
  const ice = new Set(frozen);
  const today = new Date(now);
  const todayKey = dayKey(now);
  // getDay() is Sunday-based; shift so Monday is 0.
  const offset = (today.getDay() + 6) % 7;

  return WEEK_LABELS.map((label, i) => {
    // Local calendar arithmetic — Date normalises month/year rollover, and
    // day-of-month maths keeps this correct across DST shifts, which adding
    // 86_400_000 ms would not.
    const d = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - offset + i
    );
    const key = dayKey(d.getTime());
    return {
      key,
      label,
      active: set.has(key),
      frozen: ice.has(key),
      isToday: key === todayKey,
      isFuture: i > offset,
    };
  });
}

export type Streaks = {
  current: number;
  longest: number;
  /** Missed days inside the current run that the freeze covered, newest first. */
  frozen: string[];
  /** Would a miss right now be covered? False for the week after a freeze. */
  freezeAvailable: boolean;
};

/**
 * ONE STREAK FREEZE A WEEK, FOR EVERYONE, AUTOMATICALLY.
 *
 * Radek, 2026-09-07: "one streak freeze per week for every user". A single
 * missed day does not end the streak if no other miss was forgiven in the
 * seven days before it. Two missed days in a row always end it — a freeze
 * covers a day, not a holiday.
 *
 * COMPUTED ON READ, NOT STORED. The streak is derived from recallDays, which
 * syncs; a stored "freeze used on" flag would be one more thing to merge,
 * and a rule applied to the same list on every device gives the same answer
 * everywhere for free. It also means the rule is retroactive: a user whose
 * streak died last month to one missed Tuesday gets it back, which is the
 * generous reading and the one nobody will complain about.
 */
export const FREEZE_EVERY_DAYS = 7;

/** The inverse of dayIndex. */
function keyOfIndex(index: number): string {
  const d = new Date(index * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * `current` counts back from today — or from yesterday, so the streak isn't
 * "broken" before the day is over. A single missed day is frozen when the
 * freeze is available (see FREEZE_EVERY_DAYS); frozen days keep the run
 * alive but do not add to it. A longer gap simply resets it; no drama.
 */
export function computeStreaks(
  days: string[],
  now: number = Date.now()
): Streaks {
  const set = new Set(days.map(dayIndex));
  const sorted = [...set].sort((a, b) => a - b);

  // Longest, forwards, with the same freeze rule: a gap of exactly one day
  // is bridged when no freeze was spent in the seven days before it.
  let longest = 0;
  let run = 0;
  let lastFreeze = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const gap = i > 0 ? sorted[i] - sorted[i - 1] : 0;
    if (i === 0 || gap === 1) {
      run = i === 0 ? 1 : run + 1;
    } else if (gap === 2 && sorted[i] - 1 - lastFreeze >= FREEZE_EVERY_DAYS) {
      lastFreeze = sorted[i] - 1;
      run++;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  // Current, backwards from today (or yesterday while today is still open).
  const today = dayIndex(dayKey(now));
  let cursor = set.has(today) ? today : today - 1;
  let current = 0;
  const frozen: number[] = [];
  let newestFreeze: number | null = null;
  for (;;) {
    if (set.has(cursor)) {
      current++;
      cursor--;
      continue;
    }
    // A miss. Only a single one, with an earned day behind it, can be frozen.
    if (!set.has(cursor - 1)) break;
    if (newestFreeze !== null && newestFreeze - cursor < FREEZE_EVERY_DAYS) break;
    frozen.push(cursor);
    newestFreeze = cursor;
    cursor--;
  }
  if (current === 0) frozen.length = 0; // nothing to keep alive

  return {
    current,
    longest,
    frozen: frozen.map(keyOfIndex),
    freezeAvailable: newestFreeze === null || today - newestFreeze >= FREEZE_EVERY_DAYS,
  };
}
