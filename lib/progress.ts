import type { Level, SavedWord, Video } from '@/types';
import { normalizeAnswer } from '@/lib/srs';

/**
 * Progress metrics derived from saved words and the video library.
 * Pure functions only — persistence lives in lib/storage.
 *
 * The headline metric is COMPREHENSION: the share of a video's unique words
 * the user knows (state === 'known'). It grows with understanding, not with
 * volume — saving 100 words moves it not at all until they're recalled.
 */

export type Comprehension = {
  /** unique words of the video the user knows */
  known: number;
  /** unique words in the video */
  total: number;
  /** known / total, 0 when the video has no words */
  ratio: number;
};

/**
 * Normalised text of every word the user has brought to 'known', across all
 * videos. Knowledge transfers: "playa" learned in one video counts toward
 * comprehension of every video that uses it.
 */
export function knownWordSet(words: SavedWord[]): Set<string> {
  const set = new Set<string>();
  for (const w of words) {
    if (w.state !== 'known') continue;
    const key = normalizeAnswer(w.text);
    if (key) set.add(key);
  }
  return set;
}

/** Unique (normalised) words spoken in a video. */
export function uniqueVideoWords(video: Video): Set<string> {
  const set = new Set<string>();
  for (const cue of video.cues) {
    for (const word of cue.words) {
      const key = normalizeAnswer(word.text);
      if (key) set.add(key);
    }
  }
  return set;
}

export function videoComprehension(
  video: Video,
  known: Set<string>
): Comprehension {
  const unique = uniqueVideoWords(video);
  let hit = 0;
  for (const word of unique) if (known.has(word)) hit++;
  return {
    known: hit,
    total: unique.size,
    ratio: unique.size > 0 ? hit / unique.size : 0,
  };
}

/** Mean comprehension ratio across videos; null when the list is empty. */
export function averageComprehension(
  videos: Video[],
  known: Set<string>
): number | null {
  if (videos.length === 0) return null;
  const sum = videos.reduce(
    (acc, video) => acc + videoComprehension(video, known).ratio,
    0
  );
  return sum / videos.length;
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

// ---------------------------------------------------------------------------
// Levels — derived from comprehension per CEFR band, not word count.

export const LEVEL_ORDER: Level[] = ['A1', 'A2', 'B1', 'B2'];

/** A band unlocks once the band below averages at least this comprehension. */
export const UNLOCK_THRESHOLD = 0.8;

export type LevelBand = {
  level: Level;
  /** average comprehension across this band's videos; null if none exist */
  ratio: number | null;
  unlocked: boolean;
  current: boolean;
};

/**
 * A1 starts unlocked; each later band unlocks when the previous one averages
 * >= UNLOCK_THRESHOLD. A band with no videos can't be measured: below the
 * first measured band it passes gating through (it can't block what it can't
 * test), but above measured data it can be unlocked — the working level —
 * without unlocking anything past it. Every unlock is therefore backed by a
 * measured >= 80% band, a claim the app can defend.
 */
export function levelLadder(videos: Video[], known: Set<string>): LevelBand[] {
  let unlocked = true;
  let anyMeasured = false;
  const bands: LevelBand[] = LEVEL_ORDER.map((level) => {
    const ratio = averageComprehension(
      videos.filter((v) => v.level === level),
      known
    );
    const band: LevelBand = { level, ratio, unlocked, current: false };
    unlocked =
      unlocked &&
      (ratio === null ? !anyMeasured : ratio >= UNLOCK_THRESHOLD);
    if (ratio !== null) anyMeasured = true;
    return band;
  });
  for (let i = bands.length - 1; i >= 0; i--) {
    if (bands[i].unlocked) {
      bands[i].current = true;
      break;
    }
  }
  return bands;
}
