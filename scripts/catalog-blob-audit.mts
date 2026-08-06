#!/usr/bin/env node
/**
 * Loro — find, and then revoke, every published copy of a video id.
 *
 *   npm run catalog-audit -- --id AQRWt2bNMHo          # READ ONLY. Default.
 *   npm run catalog-audit -- --id AQRWt2bNMHo --json   # same, machine-readable
 *   npm run catalog-audit -- --revoke <hash>           # delete ONE snapshot blob
 *
 * WHY THIS EXISTS. scripts/publish-catalog.mts is content-addressed and never
 * deletes anything: every snapshot it has ever produced is still sitting in the
 * loro-catalog bucket under catalog/<hash>.json, and that bucket is public
 * (migration 20260804010000 — `insert into storage.buckets … public = true`).
 * So removing a video from data/embedVideos.json and re-publishing changes only
 * which blob the POINTER names. Every older blob stays exactly where it was,
 * publicly downloadable, with the removed video still inside it.
 *
 * That is a publish-path fact with a read-path consequence, and the two halves
 * are fixed in two different places:
 *
 *   apps/mobile/src/platform/denylist.ts   stops the app rendering the id, no
 *                                          matter which snapshot a device holds
 *   this script                            removes the bytes from the internet
 *
 * BOTH ARE NEEDED. The denylist does not delete anything, and deletion does not
 * reach a device that already downloaded the blob weeks ago.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SCAN IS READ-ONLY AND THE REVOKE IS ONE OBJECT AT A TIME, ON PURPOSE.
 *
 * There is no --revoke-all, and adding one would be a mistake. Deleting the
 * blob the pointer currently names breaks the catalog for every client that has
 * not cached it — a 404 on the one object the loader cannot fall back from — so
 * the destructive mode takes a single explicit hash, refuses the live one, and
 * makes you read the scan output first.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in .env. The
 * listing and the delete both require it (the bucket has NO insert/update/delete
 * policy, so only a service-role key — which bypasses RLS — can write). The
 * per-blob content check deliberately does NOT use it: it fetches the PUBLIC
 * URL with no credentials at all, which is the only way to answer the question
 * that actually matters — can a stranger still download this.
 */

import { getAdminClient } from './lib/supabaseAdmin.mts';
import { POINTER_PATH, SNAPSHOT_BUCKET, snapshotPath } from './lib/catalog.mts';

const CATALOG_TABLE = 'loro_catalog_videos';
/** Storage list() caps at 100 by default; the bucket holds one object per
    distinct catalog ever published, so one page of 1000 is the whole history. */
const LIST_LIMIT = 1000;

// -------------------------------------------------------------------- args

type Options =
  | { mode: 'scan'; id: string; json: boolean }
  | { mode: 'revoke'; hash: string };

function usage(message: string): never {
  console.error(`\n${message}\n`);
  console.error('  --id <videoId>    scan every snapshot for this id (read only)');
  console.error('  --json            print the scan as JSON');
  console.error('  --revoke <hash>   DELETE catalog/<hash>.json from the bucket\n');
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Options {
  let id: string | null = null;
  let hash: string | null = null;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--id') {
      id = argv[++i] ?? usage('--id needs a video id.');
    } else if (arg === '--revoke') {
      hash = argv[++i] ?? usage('--revoke needs a snapshot hash.');
    } else {
      usage(`Unknown flag "${arg}".`);
    }
  }

  if (hash !== null) {
    // Not combined with a scan: the scan is what you read BEFORE revoking, and
    // running both in one invocation invites revoking against stale output.
    if (id !== null) usage('--revoke and --id are separate runs. Scan first, then revoke.');
    return { mode: 'revoke', hash };
  }
  if (id === null) usage('Nothing to do. Pass --id <videoId> to scan.');
  return { mode: 'scan', id, json };
}

// ------------------------------------------------------------------ shared

function publicUrl(objectPath: string): string {
  return getAdminClient().storage.from(SNAPSHOT_BUCKET).getPublicUrl(objectPath)
    .data.publicUrl;
}

/** Every catalog/<hash>.json in the bucket, oldest first. */
async function listSnapshots(): Promise<{ hash: string; createdAt: string }[]> {
  const { data, error } = await getAdminClient()
    .storage.from(SNAPSHOT_BUCKET)
    .list('catalog', { limit: LIST_LIMIT, sortBy: { column: 'created_at', order: 'asc' } });
  if (error) {
    console.error(`\nCannot list ${SNAPSHOT_BUCKET}: ${error.message}\n`);
    process.exit(1);
  }
  const objects = data ?? [];
  if (objects.length === LIST_LIMIT) {
    // Silent truncation here would report "3 blobs still expose it" when the
    // real number is unknown — the one failure mode this script must not have.
    console.error(`\n✗ The listing hit the ${LIST_LIMIT}-object page limit. Results would be`);
    console.error('  incomplete. Raise LIST_LIMIT or page the listing before trusting this.\n');
    process.exit(1);
  }
  return objects
    .filter((object) => object.name.endsWith('.json') && object.name !== 'latest.json')
    .map((object) => ({
      hash: object.name.replace(/\.json$/, ''),
      createdAt: String(object.created_at ?? 'unknown'),
    }));
}

/** The hash the pointer names right now — the one blob that must not be deleted. */
async function liveHash(): Promise<string | null> {
  const response = await fetch(publicUrl(POINTER_PATH));
  if (!response.ok) {
    console.error(`\n✗ Cannot read the pointer (${response.status}). Refusing to guess which`);
    console.error('  snapshot is live — re-run when the pointer is readable.\n');
    process.exit(1);
  }
  const pointer: unknown = await response.json();
  const value = (pointer as { hash?: unknown }).hash;
  return typeof value === 'string' ? value : null;
}

// -------------------------------------------------------------------- scan

type BlobVerdict = {
  hash: string;
  createdAt: string;
  status: number;
  /** null when the body could not be read or parsed. */
  contains: boolean | null;
  count: number | null;
  live: boolean;
  url: string;
};

/**
 * Does this snapshot still hold the id, and can the public still fetch it?
 *
 * Fetched WITHOUT credentials, through the same public URL a phone uses, so a
 * "no" here means genuinely unreachable rather than merely deleted-from-a-view.
 * Matched on both `id` and `youtubeId`: they are the same string for every embed
 * today (scripts/lib/catalog.mts embedRow), and checking both means a publisher
 * that stops making them equal cannot quietly open a hole.
 */
async function inspect(
  hash: string,
  createdAt: string,
  videoId: string,
  live: boolean
): Promise<BlobVerdict> {
  const url = publicUrl(snapshotPath(hash));
  const base = { hash, createdAt, live, url };

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.error(`  ! ${hash}: request failed (${String(error)})`);
    return { ...base, status: 0, contains: null, count: null };
  }
  if (!response.ok) {
    // Already unreachable — a previous revoke, or a bucket that was cleared.
    return { ...base, status: response.status, contains: null, count: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    return { ...base, status: response.status, contains: null, count: null };
  }
  if (!Array.isArray(parsed)) {
    return { ...base, status: response.status, contains: null, count: null };
  }

  const entries = parsed as { id?: unknown; youtubeId?: unknown }[];
  const contains = entries.some(
    (entry) => entry.id === videoId || entry.youtubeId === videoId
  );
  return { ...base, status: response.status, contains, count: entries.length };
}

async function scan(videoId: string, asJson: boolean): Promise<void> {
  const snapshots = await listSnapshots();
  const current = await liveHash();

  if (!asJson) {
    console.log(`\nLoro catalog blob audit — "${videoId}"`);
    console.log(`  bucket     ${SNAPSHOT_BUCKET} (public read)`);
    console.log(`  pointer    ${current ?? '(unreadable)'}`);
    console.log(`  snapshots  ${snapshots.length}\n`);
  }

  // Sequential, not Promise.all: these are ~0.9MB each and the point of the run
  // is a truthful answer, not a fast one.
  const verdicts: BlobVerdict[] = [];
  for (const snapshot of snapshots) {
    verdicts.push(
      await inspect(snapshot.hash, snapshot.createdAt, videoId, snapshot.hash === current)
    );
  }

  // The table is a separate exposure with a separate fix: publish-catalog.mts
  // reports rows the repo no longer has but never deletes them, and the read
  // policy is `using (true)` (migration 20260804000000) — so a leftover row is
  // readable by anyone holding the anon key, which ships in every client.
  const { data: rows, error } = await getAdminClient()
    .from(CATALOG_TABLE)
    .select('id')
    .eq('id', videoId);
  if (error) {
    console.error(`\nCannot read ${CATALOG_TABLE}: ${error.message}\n`);
    process.exit(1);
  }
  const inTable = (rows ?? []).length > 0;

  const exposed = verdicts.filter((verdict) => verdict.contains === true);

  if (asJson) {
    console.log(JSON.stringify({ videoId, pointer: current, inTable, blobs: verdicts }, null, 2));
    return;
  }

  for (const verdict of verdicts) {
    const state =
      verdict.contains === true
        ? 'CONTAINS IT'
        : verdict.contains === false
          ? 'clean'
          : `unreadable (HTTP ${verdict.status})`;
    const size = verdict.count === null ? '' : ` ${String(verdict.count)} videos`;
    console.log(
      `  ${verdict.live ? '→' : ' '} ${verdict.hash}  ${verdict.createdAt}  ${state}${size}`
    );
  }

  console.log('');
  console.log('='.repeat(64));
  if (exposed.length === 0) {
    console.log(`No public snapshot contains "${videoId}".`);
  } else {
    console.log(`${exposed.length} snapshot(s) still publicly serve "${videoId}":\n`);
    for (const verdict of exposed) {
      console.log(`  ${verdict.url}${verdict.live ? '   ← THE LIVE POINTER TARGET' : ''}`);
    }
    console.log('\nRevoke each one (the live target LAST, and only after a publish has');
    console.log('moved the pointer off it):\n');
    for (const verdict of exposed) {
      console.log(
        `  npm run catalog-audit -- --revoke ${verdict.hash}${verdict.live ? '   # refused while live' : ''}`
      );
    }
  }
  console.log('');
  console.log(
    inTable
      ? `⚠️  ${CATALOG_TABLE} STILL HOLDS A ROW for "${videoId}", and that table is\n` +
          '   readable by anyone with the anon key. Deleting the blobs does not touch it.\n' +
          `   Remove it in the SQL editor:  delete from public.${CATALOG_TABLE} where id = '${videoId}';\n` +
          '   (Check loro_saved_words.video_id first — the row may still be referenced.)'
      : `${CATALOG_TABLE} holds no row for "${videoId}".`
  );
  console.log('');
}

// ------------------------------------------------------------------ revoke

/**
 * DESTRUCTIVE. Delete one snapshot object.
 *
 * Deletion, not a policy change, and that is the only thing that actually works
 * here: this bucket is marked public, and Supabase serves /object/public/<path>
 * for a public bucket without evaluating the storage.objects select policy.
 * Tightening or dropping that policy therefore does NOT close the public URL —
 * it only affects authenticated/list access. The two levers that do close it are
 * removing the object and making the whole bucket private, and the second one
 * takes the entire catalog offline for every unauthenticated client.
 */
async function revoke(hash: string): Promise<void> {
  const objectPath = snapshotPath(hash);
  const current = await liveHash();

  console.log(`\nRevoking ${objectPath}`);
  console.log(`  pointer    ${current ?? '(unreadable)'}`);

  if (current !== null && current === hash) {
    console.error('\n✗ REFUSED: the pointer currently names this snapshot.');
    console.error('  Deleting it 404s the catalog for every client that has not cached it,');
    console.error('  and the loader has nothing to fall back to. Publish a catalog without');
    console.error('  the content first (npm run publish-catalog), confirm the pointer moved,');
    console.error('  then revoke this hash.\n');
    process.exit(1);
  }

  const { error } = await getAdminClient()
    .storage.from(SNAPSHOT_BUCKET)
    .remove([objectPath]);
  if (error) {
    console.error(`\n✗ delete failed: ${error.message}\n`);
    process.exit(1);
  }

  // remove() reports success for a path that was never there, so the delete is
  // verified from the OUTSIDE — an uncredentialed GET on the public URL, which
  // is the only claim worth making.
  const response = await fetch(publicUrl(objectPath));
  console.log(`  deleted    ${objectPath}`);
  console.log(`  public GET ${response.status}`);
  if (response.ok) {
    console.error('\n⚠️  STILL 200. The object is gone from Storage but a CDN edge is still');
    console.error('   serving it — the blobs are uploaded with cacheControl 31536000 (a year).');
    console.error('   Re-check over the next few minutes; if it persists, purge the cache from');
    console.error('   the Supabase dashboard (Storage → the bucket → the object) or open a');
    console.error('   support request. Do not treat this as done while it returns 200.\n');
    process.exit(1);
  }
  console.log('\nGone from the public URL.\n');
}

// -------------------------------------------------------------------- main

const options = parseArgs(process.argv.slice(2));
if (options.mode === 'scan') {
  await scan(options.id, options.json);
} else {
  await revoke(options.hash);
}
