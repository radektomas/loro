#!/usr/bin/env node
/**
 * Loro — publish the repo's video catalog into loro_catalog_videos.
 *
 *   npm run publish-catalog -- --dry-run     # plan only, writes nothing
 *   npm run publish-catalog                  # upsert every row
 *
 * Reads data/videos.json (seed clips) and data/embedVideos.json (YouTube
 * embeds) — the same two files the app bundles today and which stay canonical
 * — and upserts every entry into loro_catalog_videos, keyed on the text id.
 *
 * ONE DIRECTION ONLY. The repo JSON is the source of truth; this table is
 * derived from it. Nothing here ever reads the table back into the files, so a
 * catalog published by mistake is undone by re-running against the repo, and
 * the table can be dropped and rebuilt at any time without losing content.
 *
 * IDEMPOTENT. The key is the app's own video id (see the migration: text, not
 * uuid, because loro_saved_words.video_id already holds these strings), so a
 * second run updates in place rather than duplicating. A row whose content
 * already matches is reported as unchanged and still included in the upsert —
 * PostgREST has no per-row skip, and an upsert of identical values is a no-op
 * apart from updated_at.
 *
 * VALIDATE EVERYTHING BEFORE WRITING ANYTHING. A partial catalog is worse than
 * no catalog: a client that fetched it would render a feed with holes in it and
 * have no way to tell that from a short catalog. So every row is checked first
 * and a single bad row aborts the whole run, naming the id.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in .env — the
 * table denies writes to every other key (RLS, no write policy).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { REPO_ROOT } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';

const CATALOG_TABLE = 'loro_catalog_videos';
const SEEDS_PATH = path.join(REPO_ROOT, 'data', 'videos.json');
const EMBEDS_PATH = path.join(REPO_ROOT, 'data', 'embedVideos.json');

/** Rows per upsert request. The catalog's biggest entry is ~39KB of JSON, so
    25 keeps every request comfortably under a megabyte. */
const UPSERT_CHUNK = 25;
/** Rows per read page when fetching current state for the diff. */
const FETCH_PAGE = 50;

const LEVELS = new Set(['A1', 'A2', 'B1', 'B2']);
const LICENSES = new Set(['creativeCommon', 'youtube']);

// ------------------------------------------------------------------- shapes

type Cue = {
  start: number;
  end: number;
  words: { text: string; start: number; end: number }[];
  translations: Record<string, string>;
};

type Gloss = {
  lemma: string;
  pos: string;
  note: string | null;
  glosses: Record<string, string>;
};

type SeedEntry = {
  id: string;
  src: string;
  poster: string;
  creator: string;
  level: string;
  cues: Cue[];
  dictionary: Record<string, Gloss>;
};

type EmbedEntry = {
  id: string;
  youtubeId: string;
  creator: string;
  level: string;
  durationSeconds: number;
  thumbnailUrl: string;
  attribution: {
    channelTitle: string;
    channelUrl: string;
    videoUrl: string;
    license: string;
  };
  cues: Cue[];
  dictionary: Record<string, Gloss>;
};

/** One row of loro_catalog_videos, exactly as the table declares it. */
type CatalogRow = {
  id: string;
  kind: 'embed' | 'seed';
  creator: string;
  level: string;
  src: string | null;
  poster: string | null;
  youtube_id: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  attribution_channel_title: string | null;
  attribution_channel_url: string | null;
  attribution_video_url: string | null;
  attribution_license: string | null;
  cues: Cue[];
  dictionary: Record<string, Gloss>;
};

/** The columns the diff compares. created_at/updated_at are excluded on
    purpose — they are bookkeeping, and including them would report every row
    as changed on every run. */
const COMPARED_COLUMNS = [
  'id',
  'kind',
  'creator',
  'level',
  'src',
  'poster',
  'youtube_id',
  'thumbnail_url',
  'duration_seconds',
  'attribution_channel_title',
  'attribution_channel_url',
  'attribution_video_url',
  'attribution_license',
  'cues',
  'dictionary',
] as const;

// -------------------------------------------------------------------- args

type Options = { dryRun: boolean };

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { dryRun: false };
  for (const arg of argv) {
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        console.error(`Unknown flag "${arg}". Flags: --dry-run`);
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

function seedRow(entry: SeedEntry): CatalogRow {
  return {
    id: entry.id,
    kind: 'seed',
    creator: entry.creator,
    level: entry.level,
    src: entry.src,
    poster: entry.poster ?? '',
    youtube_id: null,
    thumbnail_url: null,
    duration_seconds: null,
    attribution_channel_title: null,
    attribution_channel_url: null,
    attribution_video_url: null,
    attribution_license: null,
    cues: entry.cues,
    dictionary: entry.dictionary,
  };
}

function embedRow(entry: EmbedEntry): CatalogRow {
  return {
    id: entry.id,
    kind: 'embed',
    creator: entry.creator,
    level: entry.level,
    // An embed's Video.src is '' — the slide renders the iframe. Stored as
    // null rather than '' so "no media file" is one value, not two.
    src: null,
    poster: null,
    youtube_id: entry.youtubeId,
    thumbnail_url: entry.thumbnailUrl,
    duration_seconds: entry.durationSeconds,
    attribution_channel_title: entry.attribution?.channelTitle ?? null,
    attribution_channel_url: entry.attribution?.channelUrl ?? null,
    attribution_video_url: entry.attribution?.videoUrl ?? null,
    attribution_license: entry.attribution?.license ?? null,
    cues: entry.cues,
    dictionary: entry.dictionary,
  };
}

// ---------------------------------------------------------------- validate

/** Abort the whole run, naming the row. Never publishes a partial catalog. */
function fail(id: string, reason: string): never {
  console.error(`\n✗ ${CATALOG_TABLE} row "${id}" is invalid: ${reason}`);
  console.error('  Nothing was written. Fix the source JSON and re-run.\n');
  process.exit(1);
}

/**
 * Every rule the table's own constraints enforce, checked here first so the
 * failure names the offending id and the source file instead of arriving as a
 * Postgres constraint violation mid-batch.
 */
function validate(rows: readonly CatalogRow[]): void {
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id.trim()) fail(`<index ${index}>`, 'id is empty or not a string');

    // A duplicate id would silently collapse two videos into one row on
    // upsert — the catalog would come back one video short with no error.
    const first = seen.get(id);
    if (first !== undefined) {
      fail(id, `duplicate id (also at index ${first})`);
    }
    seen.set(id, index);

    if (!Array.isArray(row.cues)) fail(id, 'cues is not an array');
    if (row.cues.length === 0) fail(id, 'cues is empty — not a playable slide');
    if (!row.dictionary || typeof row.dictionary !== 'object') {
      fail(id, 'dictionary is missing');
    }
    if (!row.creator?.trim()) fail(id, 'creator is empty');
    if (!LEVELS.has(row.level)) {
      fail(id, `level "${row.level}" is not one of A1/A2/B1/B2`);
    }

    // Kind-specific completeness. The embed half is the one that matters: a
    // slide missing any TASL field cannot render a lawful attribution line,
    // and that must fail here rather than on a user's screen.
    if (row.kind === 'embed') {
      if (!row.youtube_id?.trim()) fail(id, 'embed has no youtube_id');
      if (!row.thumbnail_url?.trim()) fail(id, 'embed has no thumbnail_url');
      if (!row.attribution_channel_title?.trim()) fail(id, 'embed has no attribution channelTitle');
      if (!row.attribution_channel_url?.trim()) fail(id, 'embed has no attribution channelUrl');
      if (!row.attribution_video_url?.trim()) fail(id, 'embed has no attribution videoUrl');
      if (!row.attribution_license || !LICENSES.has(row.attribution_license)) {
        fail(id, `attribution license "${row.attribution_license}" is not creativeCommon|youtube`);
      }
    } else if (row.kind === 'seed') {
      if (!row.src?.trim()) fail(id, 'seed has no src');
    } else {
      fail(id, `unknown kind "${String(row.kind)}"`);
    }
  });
}

// -------------------------------------------------------------------- diff

/**
 * Stable stringify with recursively sorted object keys.
 *
 * Required, not tidiness: jsonb does not preserve key order, so a row read back
 * from Postgres has the same content as the file with its object keys in a
 * different order. A plain JSON.stringify comparison would report all 216 rows
 * as changed on every single run.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function sameRow(local: CatalogRow, remote: Record<string, unknown>): boolean {
  for (const column of COMPARED_COLUMNS) {
    const a = local[column];
    // numeric comes back from PostgREST as a string ("31.5"), so compare the
    // NUMBER for that column rather than its representation.
    if (column === 'duration_seconds') {
      const b = remote[column];
      const an = a === null ? null : Number(a);
      const bn = b === null || b === undefined ? null : Number(b);
      if (an !== bn) return false;
      continue;
    }
    if (canonical(a) !== canonical(remote[column] ?? null)) return false;
  }
  return true;
}

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

// -------------------------------------------------------------------- main

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const seeds = readJson<SeedEntry>(SEEDS_PATH).map(seedRow);
  const embeds = readJson<EmbedEntry>(EMBEDS_PATH).map(embedRow);
  const rows = [...seeds, ...embeds];

  console.log(`\nLoro catalog publisher${options.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  data/videos.json       ${seeds.length} seed(s)`);
  console.log(`  data/embedVideos.json  ${embeds.length} embed(s)`);
  console.log(`  ${rows.length} row(s) to publish into ${CATALOG_TABLE}\n`);

  // Before the client is even created: a bad catalog should fail without
  // needing credentials or a network, so --dry-run is a real check on a
  // machine that cannot reach the database.
  validate(rows);
  console.log(`✓ validated ${rows.length} row(s) — ids, cues, dictionary, level, per-kind completeness\n`);

  const supabase = getAdminClient();
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
  console.log('');

  if (options.dryRun) {
    console.log('Dry run — nothing was written.\n');
    return;
  }

  const pending = [...inserts, ...updates, ...unchanged];
  if (pending.length === 0) {
    console.log('Nothing to do.\n');
    return;
  }

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
  console.log('');

  console.log('='.repeat(56));
  console.log(`${CATALOG_TABLE} now holds ${rows.length} row(s):`);
  console.log(`  seed   ${seeds.length}`);
  console.log(`  embed  ${embeds.length}`);
  console.log('\nNothing reads this table yet — the app still uses the bundled catalog.\n');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
