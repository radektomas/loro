import type { LevelState } from './levels.ts';

/**
 * Pure merge logic for account-synced progress (streak days, watch history,
 * level meter). Persistence and transport live in storage.ts; this module
 * is side-effect free so the merge semantics are testable in isolation.
 *
 * The one rule: SYNC NEVER MOVES PROGRESS BACKWARDS. Day and video sets are
 * unioned; the level takes whichever side is further along. Two devices that
 * diverge converge at the next hydrate — the same self-healing shape the
 * saved-word and follows engines use.
 */

export type ProgressSnapshot = {
  /** "YYYY-MM-DD" local day keys, sorted ascending. */
  recallDays: string[];
  watchedIds: string[];
  /** null = the level meter has never been touched on this side. */
  levelState: LevelState | null;
};

export const EMPTY_PROGRESS: ProgressSnapshot = {
  recallDays: [],
  watchedIds: [],
  levelState: null,
};

/** The loro_progress row shape (jsonb columns arrive as parsed values). */
export type ProgressRow = {
  user_id: string;
  recall_days: unknown;
  watched_ids: unknown;
  level_state: unknown;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

/** Tolerant row -> snapshot: malformed jsonb degrades to empty, never throws. */
export function rowToSnapshot(row: ProgressRow | null): ProgressSnapshot {
  if (!row) return EMPTY_PROGRESS;
  const ls = row.level_state as Partial<LevelState> | null;
  const levelState =
    ls && typeof ls.level === 'number' && typeof ls.meter === 'number'
      ? { level: ls.level, meter: ls.meter }
      : null;
  return {
    recallDays: [...new Set(stringArray(row.recall_days))].sort(),
    watchedIds: [...new Set(stringArray(row.watched_ids))],
    levelState,
  };
}

/** Further-along level wins; equal levels compare meters. */
function pickLevel(
  a: LevelState | null,
  b: LevelState | null
): LevelState | null {
  if (!a) return b;
  if (!b) return a;
  if (a.level !== b.level) return a.level > b.level ? a : b;
  return a.meter >= b.meter ? a : b;
}

export function mergeProgress(
  a: ProgressSnapshot,
  b: ProgressSnapshot
): ProgressSnapshot {
  return {
    recallDays: [...new Set([...a.recallDays, ...b.recallDays])].sort(),
    watchedIds: [...new Set([...a.watchedIds, ...b.watchedIds])],
    levelState: pickLevel(a.levelState, b.levelState),
  };
}

/** True when the two snapshots carry identical progress — used to skip the
    push when a hydrate found nothing new locally. */
export function sameProgress(a: ProgressSnapshot, b: ProgressSnapshot): boolean {
  return (
    a.recallDays.length === b.recallDays.length &&
    a.recallDays.every((d, i) => d === b.recallDays[i]) &&
    a.watchedIds.length === b.watchedIds.length &&
    new Set([...a.watchedIds, ...b.watchedIds]).size === a.watchedIds.length &&
    (a.levelState === null) === (b.levelState === null) &&
    (a.levelState === null ||
      (a.levelState.level === b.levelState!.level &&
        a.levelState.meter === b.levelState!.meter))
  );
}
