import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EXPLANATIONS_POINTER_PATH,
  explanationsPath,
} from '../packages/core/src/explanations.ts';
import { canonical, SNAPSHOT_BUCKET, SNAPSHOT_HASH_LENGTH } from './lib/catalog.mts';
import {
  BATCHES_DIR,
  findProblem,
  loadCatalogEntries,
  mergeBatches,
  type ExplanationBatch,
} from './lib/explanations.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';

/**
 * Publish the word explanations: validate every batch against the live
 * catalog data, merge, and upload to the SAME bucket as the catalog with the
 * SAME two-object discipline —
 *
 *   explanations/<hash>.json   immutable, 1-year cache, upsert:false
 *   explanations/latest.json   the pointer, 60s cache, WRITTEN LAST, ALWAYS
 *
 * publish-catalog.mts is the reference for every rule here: validate all
 * before writing anything; the hash is a pure function of the repo files (so
 * --dry-run computes the real hash with no network); blob before pointer so a
 * crash in between leaves clients on the previous complete blob.
 *
 *   node scripts/publish-explanations.mts             # validate + upload
 *   node scripts/publish-explanations.mts --dry-run   # validate + report only
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in .env.
 */

const BLOB_CACHE_SECONDS = 31_536_000;
const POINTER_CACHE_SECONDS = 60;

function loadBatches(): Map<number, ExplanationBatch> {
  if (!existsSync(BATCHES_DIR)) {
    console.error(`\n✗ ${BATCHES_DIR} does not exist — no batches to publish.\n`);
    process.exit(1);
  }
  const batches = new Map<number, ExplanationBatch>();
  for (const file of readdirSync(BATCHES_DIR).sort()) {
    const match = /^batch-(\d{3})\.json$/.exec(file);
    if (!match) continue;
    const parsed = JSON.parse(
      readFileSync(path.join(BATCHES_DIR, file), 'utf8')
    ) as ExplanationBatch;
    batches.set(Number.parseInt(match[1], 10), parsed);
  }
  return batches;
}

function publicUrl(supabase: SupabaseClient, objectPath: string): string {
  return supabase.storage.from(SNAPSHOT_BUCKET).getPublicUrl(objectPath).data
    .publicUrl;
}

/** Same measured Supabase behaviour as publish-catalog.mts requireBucket: a
    missing bucket lists as empty-and-no-error, so it is checked explicitly. */
async function requireBucket(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error(`\nCannot list Storage buckets: ${error.message}\n`);
    process.exit(1);
  }
  if (!(data ?? []).some((bucket) => bucket.id === SNAPSHOT_BUCKET)) {
    console.error(`\n✗ Storage bucket "${SNAPSHOT_BUCKET}" does not exist.\n`);
    process.exit(1);
  }
}

async function blobExists(supabase: SupabaseClient, hash: string): Promise<boolean> {
  const { data, error } = await supabase.storage
    .from(SNAPSHOT_BUCKET)
    .list('explanations', { search: `${hash}.json` });
  if (error) {
    console.error(`\nCannot list ${SNAPSHOT_BUCKET}: ${error.message}\n`);
    process.exit(1);
  }
  return (data ?? []).some((object) => object.name === `${hash}.json`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  console.log('\nValidating explanation batches…');
  const videos = loadCatalogEntries();
  const batches = loadBatches();
  const problem = findProblem(batches, videos);
  if (problem) {
    console.error(`\n✗ ${problem}\n`);
    process.exit(1);
  }

  const merged = mergeBatches(batches);
  const body = canonical(merged);
  const count = Object.keys(merged).length;
  const hash = createHash('sha256')
    .update(body, 'utf8')
    .digest('hex')
    .slice(0, SNAPSHOT_HASH_LENGTH);
  const bytes = Buffer.byteLength(body, 'utf8');

  console.log(`  batches    ${batches.size}`);
  console.log(`  lemmas     ${count}`);
  console.log(`  hash       ${hash}`);
  console.log(`  size       ${(bytes / 1048576).toFixed(2)}MB`);

  const supabase = getAdminClient();
  await requireBucket(supabase);
  const exists = await blobExists(supabase, hash);
  console.log(`  blob       ${exists ? 'already present — content unchanged' : 'new, would upload'}`);

  const objectPath = explanationsPath(hash);
  if (dryRun) {
    console.log('  (dry run — nothing uploaded, pointer not moved)\n');
    console.log(`  would be   ${publicUrl(supabase, objectPath)}`);
    console.log(`  pointer    ${publicUrl(supabase, EXPLANATIONS_POINTER_PATH)}\n`);
    return;
  }

  if (!exists) {
    const { error } = await supabase.storage
      .from(SNAPSHOT_BUCKET)
      .upload(objectPath, Buffer.from(body, 'utf8'), {
        contentType: 'application/json',
        cacheControl: String(BLOB_CACHE_SECONDS),
        upsert: false,
      });
    if (error) {
      console.error(`\n✗ blob upload failed: ${error.message}`);
      console.error('  The pointer was NOT moved; clients keep the previous blob. Re-run to retry.\n');
      process.exit(1);
    }
    console.log(`  uploaded   ${objectPath}`);
  }

  const pointer = { hash, count, generatedAt: new Date().toISOString() };
  const { error } = await supabase.storage
    .from(SNAPSHOT_BUCKET)
    .upload(EXPLANATIONS_POINTER_PATH, Buffer.from(JSON.stringify(pointer), 'utf8'), {
      contentType: 'application/json',
      cacheControl: String(POINTER_CACHE_SECONDS),
      upsert: true,
    });
  if (error) {
    console.error(`\n✗ pointer write failed: ${error.message}`);
    console.error(`  The blob ${objectPath} is up but nothing points at it. Re-run to finish.\n`);
    process.exit(1);
  }
  console.log(`  pointer    ${EXPLANATIONS_POINTER_PATH} -> ${hash}\n`);
  console.log(`  ${publicUrl(supabase, objectPath)}`);
  console.log(`  ${publicUrl(supabase, EXPLANATIONS_POINTER_PATH)}\n`);
}

await main();
