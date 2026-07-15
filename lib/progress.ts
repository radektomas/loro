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
