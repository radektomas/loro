import type { SavedWord } from '@/types';

/**
 * Progress metrics derived from saved words. Pure functions only — persistence
 * lives in lib/storage.
 *
 * Everything here counts real, honest effort: reviews due, and streaks of days
 * with a correct recall. There is deliberately no "comprehension" metric —
 * users only save words they DON'T know, so any score built from saved words
 * measures the opposite of understanding and punishes fluent users. Progress on
 * this screen is measured by what the user has LEARNED, which only ever grows.
 */

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
  /** Was there a correct recall on this day? */
  active: boolean;
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
export function weekStrip(days: string[], now: number = Date.now()): WeekDay[] {
  const set = new Set(days);
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
      isToday: key === todayKey,
      isFuture: i > offset,
    };
  });
}

export type Streaks = { current: number; longest: number };

/**
 * `current` counts back from today — or from yesterday, so the streak isn't
 * "broken" before the day is over. A gap simply resets it; no drama.
 */
export function computeStreaks(
  days: string[],
  now: number = Date.now()
): Streaks {
  const indices = [...new Set(days)].map(dayIndex).sort((a, b) => a - b);

  let longest = 0;
  let run = 0;
  for (let i = 0; i < indices.length; i++) {
    run = i > 0 && indices[i] === indices[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const set = new Set(indices);
  const today = dayIndex(dayKey(now));
  let cursor: number | null = set.has(today)
    ? today
    : set.has(today - 1)
      ? today - 1
      : null;
  let current = 0;
  while (cursor !== null && set.has(cursor)) {
    current++;
    cursor--;
  }
  return { current, longest };
}
