#!/usr/bin/env node
/**
 * One-off: backfill source_queries / discovery_sources for rows harvested
 * before provenance recording existed.
 *
 *   npm run backfill-provenance              # preview
 *   npm run backfill-provenance -- --apply   # commit
 *
 * Zero quota — pure derivation from data already in the table.
 *
 * HOW THE DERIVATION WORKS, and why it is not a guess.
 *
 * Every harvest run before this script existed was an exploratory run using
 * `--limit 1`. A combination is (topic x query x region x license) ordered
 * topic -> query -> region -> license, so `--limit 1` with a topic/region/
 * license selection always processes the FIRST query of that topic and stops.
 * Consequently each topic contributed exactly ONE query, and a row's
 * topic_tags identify it unambiguously.
 *
 * The table below records what actually ran, rather than recomputing it from
 * the current config — config drifts, history does not. loro_harvest_pages
 * independently corroborates the travel entry ("que ver en" x MX/AR/ES).
 *
 * A row tagged with two topics genuinely has two candidate queries, and both
 * are recorded: it really was returned by both searches.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { TOPICS } from './config/harvest-queries.mts';
import { loadEnv } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE, type CandidateRow } from './lib/candidates.mts';

/**
 * topic slug -> queries known to have been run before provenance existed.
 * Sourced from the twelve exploratory runs of 2026-07-21, all `--limit 1`.
 * Topics absent from this map were never searched.
 */
const HISTORICAL_QUERIES: Readonly<Record<string, readonly string[]>> = {
  animals: ['animales curiosos'],
  travel: ['que ver en'],
  food: ['receta facil'],
  'street-interviews': ['entrevistas en la calle'],
  nature: ['paisajes naturales'],
};

/** tag -> topic slug, so a row's topic_tags can be resolved back to topics. */
const TAG_TO_TOPIC = new Map<string, string>();
for (const topic of TOPICS) {
  for (const tag of topic.tags) TAG_TO_TOPIC.set(tag, topic.slug);
}

function queriesForRow(row: CandidateRow): string[] {
  const topics = new Set<string>();
  for (const tag of row.topic_tags) {
    const slug = TAG_TO_TOPIC.get(tag);
    if (slug) topics.add(slug);
  }
  const queries = new Set<string>();
  for (const slug of topics) {
    for (const query of HISTORICAL_QUERIES[slug] ?? []) queries.add(query);
  }
  return [...queries].sort();
}

async function fetchAll(supabase: SupabaseClient): Promise<CandidateRow[]> {
  const all: CandidateRow[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await supabase
      .from(CANDIDATES_TABLE)
      .select('*')
      .range(from, from + 999);
    if (error) throw new Error(`read failed: ${error.message}`);
    const rows = (data ?? []) as CandidateRow[];
    all.push(...rows);
    if (rows.length < 1_000) break;
  }
  return all;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  if (args.some((a) => a !== '--apply')) {
    console.error('\nUsage: npm run backfill-provenance [-- --apply]\n');
    process.exit(1);
  }
  loadEnv();
  const supabase = getAdminClient();
  const rows = await fetchAll(supabase);

  // Idempotent: only rows that have no provenance yet.
  const pending = rows.filter((row) => (row.source_queries ?? []).length === 0);
  console.log(`\n${rows.length} rows, ${pending.length} without provenance.`);

  const byCount = new Map<number, number>();
  const byQuery = new Map<string, number>();
  const updates: { youtubeId: string; queries: string[] }[] = [];
  const unresolved: CandidateRow[] = [];

  for (const row of pending) {
    const queries = queriesForRow(row);
    byCount.set(queries.length, (byCount.get(queries.length) ?? 0) + 1);
    if (queries.length === 0) {
      unresolved.push(row);
      continue;
    }
    for (const q of queries) byQuery.set(q, (byQuery.get(q) ?? 0) + 1);
    updates.push({ youtubeId: row.youtube_id, queries });
  }

  console.log('\nCandidate queries resolved per row:');
  for (const [n, count] of [...byCount.entries()].sort((a, b) => a[0] - b[0])) {
    const label = n === 0 ? 'unresolved' : `${n} quer${n === 1 ? 'y' : 'ies'}`;
    console.log(`  ${label.padEnd(14)} ${count}`);
  }

  console.log('\nRows per derived query:');
  for (const [q, n] of [...byQuery.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${q.padEnd(30)} ${n}`);
  }

  if (unresolved.length > 0) {
    console.log(`\n${unresolved.length} row(s) left with empty source_queries:`);
    for (const row of unresolved.slice(0, 10)) {
      console.log(`  ${row.youtube_id}  tags=[${row.topic_tags.join(',')}]  region=${row.region_hint}`);
    }
    console.log('  (left empty on purpose — better an honest gap than a fabricated origin)');
  }

  if (!apply) {
    console.log(`\nPREVIEW — would update ${updates.length} rows. Re-run with --apply.\n`);
    return;
  }

  let written = 0;
  for (const update of updates) {
    const { error } = await supabase
      .from(CANDIDATES_TABLE)
      .update({ source_queries: update.queries, discovery_sources: ['query'] })
      .eq('youtube_id', update.youtubeId);
    if (error) {
      console.error(`  ! ${update.youtubeId}: ${error.message}`);
      continue;
    }
    written += 1;
  }
  console.log(`\nBackfilled ${written}/${updates.length} rows.\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
