import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SWEPT_LICENSE_BRANCHES,
  TOPICS,
  type LicenseBranch,
  type Region,
  type Topic,
  type TopicSlug,
} from '../config/harvest-queries.mts';
import { HARVEST_RUNS_TABLE } from './candidates.mts';

/**
 * The search matrix, the resume cursor, and daily quota accounting.
 *
 * A full sweep is ~490 search calls against a ~95-call daily allowance, so a
 * "run" is never the whole job — it is one bounded slice of it. This module
 * is what makes the next slice start exactly where the last one stopped.
 */

// ------------------------------------------------------------- the matrix

export type Combo = {
  /** Position in the canonical ordering — this is what the cursor stores. */
  index: number;
  topic: TopicSlug;
  topicLabel: string;
  query: string;
  tags: readonly string[];
  region: Region;
  license: LicenseBranch;
  /** Pages to fetch for this combination, from the topic's config. */
  pages: number;
};

/**
 * The canonical, DETERMINISTIC ordering of every (query x region x license).
 *
 * ORDERED QUERY-FIRST, deliberately: the outer loop is the query INDEX, so the
 * matrix runs query 1 of every topic, then query 2 of every topic, and so on.
 *
 * The point is that matrix order IS information order. Per-query eligible
 * yield is the highest-value thing we can learn, and topic-major ordering
 * would spend a whole day on seven regions of "animales curiosos" before ever
 * seeing a second query. Query-major means any prefix of the sweep is a broad
 * sample across all eight topics — so there is no separate "phase" machinery
 * to maintain, and stopping early always leaves the most informative subset.
 *
 * Regions come from the TOPIC, not a global list: geographic topics sweep
 * several, generic ones collapse to one (see Topic.regions).
 *
 * Determinism is the contract: the cursor is an index into this list, so the
 * order must be a pure function of the config. Editing TOPICS therefore shifts
 * the meaning of a saved index — which is why the cursor stores its combo's
 * identity too and is relocated by key on resume (see resolveResumeIndex).
 */
export function buildMatrix(topics: readonly Topic[] = TOPICS): Combo[] {
  const combos: Combo[] = [];
  const deepest = topics.reduce((n, t) => Math.max(n, t.queries.length), 0);
  for (let queryIndex = 0; queryIndex < deepest; queryIndex++) {
    for (const topic of topics) {
      const query = topic.queries[queryIndex];
      // Topics have unequal query counts; the shallow ones simply drop out of
      // later rounds rather than repeating or padding.
      if (query === undefined) continue;
      for (const region of topic.regions) {
        for (const license of SWEPT_LICENSE_BRANCHES) {
          combos.push({
            index: combos.length,
            topic: topic.slug,
            topicLabel: topic.label,
            query,
            tags: topic.tags,
            region,
            license,
            pages: topic.pages,
          });
        }
      }
    }
  }
  return combos;
}

/** Stable identity of a combo, independent of its position in the matrix. */
export function comboKey(combo: Combo): string {
  return `${combo.topic}|${combo.query}|${combo.region}|${combo.license}`;
}

export function describeCombo(combo: Combo): string {
  return `${combo.topic}/${combo.region}/${combo.license} "${combo.query}"`;
}

// -------------------------------------------------------------- the cursor

export type HarvestCursor = {
  /** Index into buildMatrix() where the NEXT run should start. */
  comboIndex: number;
  /** comboKey at that index when it was written — guards against config edits. */
  comboKey: string;
  /** Mid-combo pagination, when PAGES_PER_COMBO > 1. */
  pageToken: string | null;
};

export type HarvestRunStatus =
  | 'running'
  | 'completed'
  | 'quota_exhausted'
  | 'failed';

export type HarvestRunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: HarvestRunStatus;
  quota_spent: number;
  cursor: HarvestCursor | null;
  stats: Record<string, unknown> | null;
  error: string | null;
};

/**
 * Where to resume.
 *
 * If the config changed since the cursor was written, the stored index now
 * points at a different combination — so we re-find the saved combo by key.
 * If it is gone entirely (a query was deleted), we restart from 0 rather than
 * silently skipping a chunk of the matrix. Cheap and obvious beats clever.
 */
export function resolveResumeIndex(
  cursor: HarvestCursor | null,
  matrix: readonly Combo[]
): { index: number; pageToken: string | null; note: string | null } {
  if (!cursor) return { index: 0, pageToken: null, note: null };

  const atIndex = matrix[cursor.comboIndex];
  if (atIndex && comboKey(atIndex) === cursor.comboKey) {
    return { index: cursor.comboIndex, pageToken: cursor.pageToken, note: null };
  }

  const relocated = matrix.findIndex((c) => comboKey(c) === cursor.comboKey);
  if (relocated >= 0) {
    return {
      index: relocated,
      pageToken: cursor.pageToken,
      note: `config changed — resume point moved ${cursor.comboIndex} -> ${relocated}`,
    };
  }
  return {
    index: 0,
    pageToken: null,
    note: `config changed — saved combo "${cursor.comboKey}" no longer exists, restarting the sweep`,
  };
}

// ------------------------------------------------------------- persistence

/** The most recent run, whatever its status. */
export async function fetchLastRun(
  supabase: SupabaseClient
): Promise<HarvestRunRow | null> {
  const { data, error } = await supabase
    .from(HARVEST_RUNS_TABLE)
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not read harvest runs: ${error.message}`);
  return (data as HarvestRunRow | null) ?? null;
}

/**
 * Units already spent in the current quota day.
 *
 * YouTube resets quota at midnight PACIFIC, not UTC and not local — so the
 * window is computed in America/Los_Angeles. Getting this wrong means either
 * refusing to run when quota is actually available, or blowing through the
 * real cap right after a reset.
 */
export async function quotaSpentToday(
  supabase: SupabaseClient
): Promise<number> {
  const since = pacificMidnightUtc(new Date());
  const { data, error } = await supabase
    .from(HARVEST_RUNS_TABLE)
    .select('quota_spent')
    .gte('started_at', since.toISOString());
  if (error) throw new Error(`could not read quota history: ${error.message}`);
  return ((data ?? []) as { quota_spent: number | null }[]).reduce(
    (sum, row) => sum + (row.quota_spent ?? 0),
    0
  );
}

/**
 * The instant of the most recent midnight in America/Los_Angeles, as a UTC
 * Date. Uses Intl rather than a hardcoded -7/-8 so DST is handled correctly.
 */
export function pacificMidnightUtc(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  // How far into the Pacific day we currently are.
  const secondsIntoDay =
    get('hour') * 3_600 + get('minute') * 60 + get('second');
  return new Date(now.getTime() - secondsIntoDay * 1_000);
}

export async function startRun(
  supabase: SupabaseClient
): Promise<HarvestRunRow> {
  const { data, error } = await supabase
    .from(HARVEST_RUNS_TABLE)
    .insert({ status: 'running', quota_spent: 0 })
    .select('*')
    .single();
  if (error) throw new Error(`could not open harvest run: ${error.message}`);
  return data as HarvestRunRow;
}

export type FinishArgs = {
  status: HarvestRunStatus;
  quotaSpent: number;
  cursor: HarvestCursor | null;
  stats: Record<string, unknown>;
  error?: string | null;
};

export async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  args: FinishArgs
): Promise<void> {
  const { error } = await supabase
    .from(HARVEST_RUNS_TABLE)
    .update({
      status: args.status,
      quota_spent: args.quotaSpent,
      cursor: args.cursor,
      stats: args.stats,
      error: args.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (error) throw new Error(`could not close harvest run: ${error.message}`);
}

/**
 * Checkpoint mid-run. Called after every combo so that a hard crash (or a
 * SIGINT) still leaves a usable resume point rather than replaying the whole
 * run's quota.
 */
export async function checkpointRun(
  supabase: SupabaseClient,
  runId: string,
  quotaSpent: number,
  cursor: HarvestCursor
): Promise<void> {
  const { error } = await supabase
    .from(HARVEST_RUNS_TABLE)
    .update({ quota_spent: quotaSpent, cursor })
    .eq('id', runId);
  // A failed checkpoint must not kill a run that is otherwise working — the
  // worst case is a resume that repeats one combo.
  if (error) console.warn(`  ! checkpoint failed: ${error.message}`);
}
