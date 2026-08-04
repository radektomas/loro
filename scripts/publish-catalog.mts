#!/usr/bin/env node
/**
 * Loro — publish the repo's video catalog into loro_catalog_videos, then
 * snapshot it into the loro-catalog Storage bucket.
 *
 *   npm run publish-catalog -- --dry-run        # plan only, writes nothing
 *   npm run publish-catalog                     # upsert rows, then snapshot
 *   npm run publish-catalog -- --snapshot-only  # skip the table, snapshot only
 *
 * Reads data/videos.json (seed clips) and data/embedVideos.json (YouTube
 * embeds) — the same two files the app bundles today and which stay canonical
 * — and upserts every entry into loro_catalog_videos, keyed on the text id.
 *
 * ONE DIRECTION ONLY. The repo JSON is the source of truth; the table and the
 * snapshot are both derived from it. Nothing here ever reads either one back
 * into the files, so a catalog published by mistake is undone by re-running
 * against the repo, and the table can be dropped and rebuilt at any time.
 *
 * IDEMPOTENT. The table key is the app's own video id (see the migration: text,
 * not uuid, because loro_saved_words.video_id already holds these strings), so
 * a second run updates in place rather than duplicating. The snapshot is named
 * by the hash of its own bytes, so a second run on unchanged content produces
 * the same name and uploads nothing.
 *
 * VALIDATE EVERYTHING BEFORE WRITING ANYTHING. A partial catalog is worse than
 * no catalog: a client that fetched it would render a feed with holes in it and
 * have no way to tell that from a short catalog. So every row is checked first
 * and a single bad row aborts the whole run, naming the id.
 *
 * THE SNAPSHOT IS BUILT FROM THE VALIDATED ROWS, NOT READ BACK FROM THE TABLE.
 * Those are the same content by construction — the upsert immediately precedes
 * it — but only one of them is reproducible: a table read returns jsonb with
 * its keys reordered and numeric as strings, so the bytes would depend on
 * Postgres's serialization rather than on the repo. Building from the rows
 * makes the hash a pure function of the two JSON files, which is what lets
 * --dry-run compute the REAL hash with no database at all.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in .env — the
 * table and the bucket both deny writes to every other key.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { REPO_ROOT } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import {
  buildSnapshot,
  COMPARED_COLUMNS,
  embedRow,
  findProblem,
  POINTER_PATH,
  sameRow,
  seedRow,
  snapshotPath,
  SNAPSHOT_BUCKET,
  type CatalogPointer,
  type CatalogRow,
  type EmbedEntry,
  type SeedEntry,
  type Snapshot,
} from './lib/catalog.mts';

const CATALOG_TABLE = 'loro_catalog_videos';
const SEEDS_PATH = path.join(REPO_ROOT, 'data', 'videos.json');
const EMBEDS_PATH = path.join(REPO_ROOT, 'data', 'embedVideos.json');

/** Rows per upsert request. The catalog's biggest entry is ~39KB of JSON, so
    25 keeps every request comfortably under a megabyte. */
const UPSERT_CHUNK = 25;
/** Rows per read page when fetching current state for the diff. */
const FETCH_PAGE = 50;

/** A year. The blob is named by its own content hash, so it can never go
    stale — that is the entire point of the immutable-URL model. */
const BLOB_CACHE_SECONDS = 31_536_000;
/** A minute. The pointer is the one mutable object; a long TTL here would
    leave clients reading a stale hash long after a publish. */
const POINTER_CACHE_SECONDS = 60;

// -------------------------------------------------------------------- args

type Options = { dryRun: boolean; snapshotOnly: boolean };

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { dryRun: false, snapshotOnly: false };
  for (const arg of argv) {
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--snapshot-only':
        // Re-upload a snapshot without touching the table — for a bucket that
        // was cleared, or a snapshot that failed after a successful upsert.
        options.snapshotOnly = true;
        break;
      default:
        console.error(`Unknown flag "${arg}". Flags: --dry-run --snapshot-only`);
        process.exit(1);
    }
  }
  return options;
}

// -------------------------------------------------------------------- load

function readJson<T>(file: string): T[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`\nCannot read ${path.relative(REPO_ROOT, file)}: ${String(error)}\n`);
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`\n${path.relative(REPO_ROOT, file)} is not valid JSON: ${String(error)}\n`);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error(`\n${path.relative(REPO_ROOT, file)} must hold a JSON array.\n`);
    process.exit(1);
  }
  return parsed as T[];
}

// ------------------------------------------------------------------- table

/** Every existing row, paged so one response never carries the whole catalog. */
async function fetchExisting(
  supabase: SupabaseClient
): Promise<Map<string, Record<string, unknown>>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from(CATALOG_TABLE)
      .select(COMPARED_COLUMNS.join(','))
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) {
      console.error(`\nCannot read ${CATALOG_TABLE}: ${error.message}`);
      console.error('  Has supabase/migrations/20260804000000_catalog_videos.sql been applied?\n');
      process.exit(1);
    }
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    for (const row of page) byId.set(String(row.id), row);
    if (page.length < FETCH_PAGE) break;
  }
  return byId;
}

async function publishRows(
  supabase: SupabaseClient,
  rows: readonly CatalogRow[],
  dryRun: boolean
): Promise<void> {
  const existing = await fetchExisting(supabase);

  const inserts: CatalogRow[] = [];
  const updates: CatalogRow[] = [];
  const unchanged: CatalogRow[] = [];
  for (const row of rows) {
    const remote = existing.get(row.id);
    if (!remote) inserts.push(row);
    else if (sameRow(row, remote)) unchanged.push(row);
    else updates.push(row);
  }

  // Rows in the table that the repo no longer has. Reported, never deleted:
  // an id here may still be referenced by loro_saved_words.video_id, so
  // removing content is a deliberate act (scripts/prune-embeds.mts), not a
  // side effect of a publish.
  const orphans = [...existing.keys()].filter(
    (id) => !rows.some((row) => row.id === id)
  );

  console.log(`  insert     ${inserts.length}`);
  console.log(`  update     ${updates.length}`);
  console.log(`  unchanged  ${unchanged.length}`);
  if (orphans.length > 0) {
    console.log(`  in table but not in the repo JSON: ${orphans.length}`);
    for (const id of orphans.slice(0, 10)) console.log(`    ${id}`);
    if (orphans.length > 10) console.log(`    …and ${orphans.length - 10} more`);
    console.log('    (left alone — saved words may still reference them)');
  }

  if (dryRun) {
    console.log('  (dry run — no rows written)\n');
    return;
  }

  const pending = [...inserts, ...updates, ...unchanged];
  let written = 0;
  for (let i = 0; i < pending.length; i += UPSERT_CHUNK) {
    const chunk = pending.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from(CATALOG_TABLE)
      .upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.error(`\n✗ upsert failed at row ${i + 1}/${pending.length}: ${error.message}`);
      console.error(`  ${written} row(s) were written before this. Re-run to resume —`);
      console.error('  the upsert is keyed on id, so replaying is safe.\n');
      process.exit(1);
    }
    written += chunk.length;
    process.stdout.write(`\r  upserted ${written}/${pending.length}`);
  }
  console.log('\n');
}

// ---------------------------------------------------------------- snapshot

function publicUrl(supabase: SupabaseClient, objectPath: string): string {
  return supabase.storage.from(SNAPSHOT_BUCKET).getPublicUrl(objectPath).data
    .publicUrl;
}

/**
 * Abort unless the bucket actually exists.
 *
 * Checked explicitly, and this is not defensive padding: listing a path in a
 * bucket that does not exist returns an EMPTY ARRAY AND NO ERROR (measured
 * against the project, 2026-08-04). Without this check, blobExists() reads a
 * missing bucket as "the blob isn't there yet", and --dry-run cheerfully
 * reports "new, would upload" for a bucket nothing can be uploaded to — a
 * dry run whose whole job is to say whether a real run would work.
 */
async function requireBucket(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error(`\nCannot list Storage buckets: ${error.message}\n`);
    process.exit(1);
  }
  if (!(data ?? []).some((bucket) => bucket.id === SNAPSHOT_BUCKET)) {
    console.error(`\n✗ Storage bucket "${SNAPSHOT_BUCKET}" does not exist.`);
    console.error(
      '  Apply supabase/migrations/20260804010000_catalog_snapshot_bucket.sql\n' +
        '  in the Supabase SQL editor, then re-run.\n'
    );
    process.exit(1);
  }
}

/** Is this hash already in the bucket? Asked by list() rather than by
    attempting the upload, so --dry-run can report the decision truthfully.
    Only meaningful after requireBucket() — see the note there. */
async function blobExists(
  supabase: SupabaseClient,
  hash: string
): Promise<boolean> {
  const { data, error } = await supabase.storage
    .from(SNAPSHOT_BUCKET)
    .list('catalog', { search: `${hash}.json` });
  if (error) {
    console.error(`\nCannot list ${SNAPSHOT_BUCKET}: ${error.message}\n`);
    process.exit(1);
  }
  return (data ?? []).some((object) => object.name === `${hash}.json`);
}

async function uploadSnapshot(
  supabase: SupabaseClient,
  snapshot: Snapshot,
  dryRun: boolean
): Promise<void> {
  const objectPath = snapshotPath(snapshot.hash);
  const bytes = Buffer.byteLength(snapshot.body, 'utf8');

  // Printed BEFORE any network call: the hash is a pure function of the repo
  // JSON, so it is the one thing this step can always report — including on a
  // machine with no database, and including when the checks below abort.
  console.log(`  hash       ${snapshot.hash}`);
  console.log(`  size       ${(bytes / 1048576).toFixed(2)}MB (${snapshot.count} videos)`);

  await requireBucket(supabase);
  const exists = await blobExists(supabase, snapshot.hash);
  console.log(`  blob       ${exists ? 'already present — content unchanged' : 'new, would upload'}`);

  if (dryRun) {
    console.log('  (dry run — nothing uploaded, pointer not moved)\n');
    console.log(`  would be   ${publicUrl(supabase, objectPath)}`);
    console.log(`  pointer    ${publicUrl(supabase, POINTER_PATH)}\n`);
    return;
  }

  if (!exists) {
    // upsert:false is what makes the object immutable: an existing hash is a
    // conflict, never an overwrite. The name is the sha256 of the body, so a
    // conflict can only mean the identical bytes are already there.
    const { error } = await supabase.storage
      .from(SNAPSHOT_BUCKET)
      .upload(objectPath, Buffer.from(snapshot.body, 'utf8'), {
        contentType: 'application/json',
        cacheControl: String(BLOB_CACHE_SECONDS),
        upsert: false,
      });
    if (error) {
      console.error(`\n✗ snapshot upload failed: ${error.message}`);
      console.error('  The pointer was NOT moved, so clients keep reading the previous\n' +
                    '  snapshot. Re-run to retry.\n');
      process.exit(1);
    }
    console.log(`  uploaded   ${objectPath}`);
  }

  // THE POINTER IS WRITTEN LAST, ALWAYS. Until this succeeds, every client
  // keeps reading the previous snapshot — which is a complete, valid catalog.
  // Writing it first would publish a hash whose blob may not exist yet, and
  // every client booting in that window would fetch a 404.
  //
  // Rewritten even when the hash is unchanged: it is ~100 bytes, and doing it
  // unconditionally makes the step self-healing after a run that died between
  // the blob and the pointer.
  const pointer: CatalogPointer = {
    hash: snapshot.hash,
    count: snapshot.count,
    generatedAt: new Date().toISOString(),
  };
  const { error } = await supabase.storage
    .from(SNAPSHOT_BUCKET)
    .upload(POINTER_PATH, Buffer.from(JSON.stringify(pointer), 'utf8'), {
      contentType: 'application/json',
      cacheControl: String(POINTER_CACHE_SECONDS),
      upsert: true,
    });
  if (error) {
    console.error(`\n✗ pointer write failed: ${error.message}`);
    console.error(`  The blob ${objectPath} is up but nothing points at it.`);
    console.error('  Re-run with --snapshot-only to finish.\n');
    process.exit(1);
  }
  console.log(`  pointer    ${POINTER_PATH} -> ${snapshot.hash}`);
  console.log('');
  console.log(`  ${publicUrl(supabase, objectPath)}`);
  console.log(`  ${publicUrl(supabase, POINTER_PATH)}`);
  console.log('');
}

// -------------------------------------------------------------------- main

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const seeds = readJson<SeedEntry>(SEEDS_PATH).map(seedRow);
  const embeds = readJson<EmbedEntry>(EMBEDS_PATH).map(embedRow);
  // Seeds then embeds, each in source-file order — byte-for-byte the order
  // localVideos gives the web today, so the snapshot is not a reshuffle of
  // what users already have.
  const rows = [...seeds, ...embeds];

  console.log(`\nLoro catalog publisher${options.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  data/videos.json       ${seeds.length} seed(s)`);
  console.log(`  data/embedVideos.json  ${embeds.length} embed(s)`);
  console.log(`  ${rows.length} row(s)\n`);

  // Before the client is even created: a bad catalog should fail without
  // needing credentials or a network, so --dry-run is a real check on a
  // machine that cannot reach the database.
  const problem = findProblem(rows);
  if (problem) {
    console.error(`✗ ${CATALOG_TABLE} row "${problem.id}" is invalid: ${problem.reason}`);
    console.error('  Nothing was written. Fix the source JSON and re-run.\n');
    process.exit(1);
  }
  console.log(`✓ validated ${rows.length} row(s) — ids, cues, dictionary, level, per-kind completeness\n`);

  const supabase = getAdminClient();

  if (!options.snapshotOnly) {
    console.log(`table ${CATALOG_TABLE}`);
    await publishRows(supabase, rows, options.dryRun);
  }

  console.log(`snapshot ${SNAPSHOT_BUCKET}`);
  await uploadSnapshot(supabase, buildSnapshot(rows), options.dryRun);

  if (!options.dryRun) {
    console.log('='.repeat(56));
    console.log(`${rows.length} video(s) published: ${seeds.length} seed, ${embeds.length} embed`);
    console.log('\nNothing reads the table or the snapshot yet — the app still uses');
    console.log('the bundled catalog.\n');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
