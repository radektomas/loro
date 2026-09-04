#!/usr/bin/env node
/**
 * Loro — take videos out of the catalog, by id.
 *
 *   npm run block -- --ids abc,def                    # preview only
 *   npm run block -- --ids abc,def --reason "…" --apply
 *
 * This is the write half of /admin/catalog. The dashboard can show you every
 * video in the feed but it cannot remove one, because data/embedVideos.json in
 * this repo is canonical and loro_catalog_videos is derived from it — a web
 * write would be overwritten by the next publish-catalog. So the dashboard
 * hands you this command and the removal happens here, on the machine that
 * owns the repo.
 *
 * What it does, which is the documented removal path with the manual steps
 * collapsed into one (see the README and the content-removal notes):
 *
 *   1. append each id to BLOCKED_VIDEOS in scripts/config/harvest-queries.mts,
 *      with the reason you gave — the list requires one, and an unexplained
 *      blocklist rots
 *   2. npm run refilter -- --apply     (retroactive over the candidate pool)
 *   3. npm run prune-embeds -- --apply (drops them from data/embedVideos.json)
 *
 * It deliberately STOPS before publish-catalog. That step is what reaches real
 * devices, and it stays a separate, deliberate act — the command is printed at
 * the end. Everything this script does before that point is a local file edit
 * plus candidate-status writes, all reviewable in `git diff` and revertible.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in .env, same as the rest of the pipeline.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO_ROOT } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE } from './lib/candidates.mts';

const CONFIG_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'config',
  'harvest-queries.mts'
);

export type NewBlock = { youtubeId: string; title: string; reason: string };

/** The declaration this script writes into. Matched exactly; if it is ever
    renamed, this script must fail loudly rather than append to whatever array
    happens to come next in the file. */
const ANCHOR = 'export const BLOCKED_VIDEOS: readonly BlockedVideo[] = [';

/** A TS string literal, single-quoted like the rest of the config. */
function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Insert entries at the END of the BLOCKED_VIDEOS array literal.
 *
 * Pure and exported so the test can exercise the string surgery without a
 * database or a filesystem. The array is found by its declaration and closed
 * at the first line that is exactly `];` after it — which holds because this
 * config is prettier-formatted with one entry per object and no nested array
 * literal is ever closed at column 0.
 */
export function insertBlockedVideos(source: string, entries: readonly NewBlock[]): string {
  if (entries.length === 0) return source;
  const start = source.indexOf(ANCHOR);
  if (start === -1) {
    throw new Error(
      `Could not find "${ANCHOR}" in harvest-queries.mts — the list was renamed or moved. Refusing to guess where to append.`
    );
  }
  const closeIndex = source.indexOf('\n];', start);
  if (closeIndex === -1) {
    throw new Error('BLOCKED_VIDEOS is not closed by a line starting "];".');
  }
  const block = entries
    .map(
      (e) =>
        `  {\n` +
        `    youtubeId: ${literal(e.youtubeId)},\n` +
        `    title: ${literal(e.title)},\n` +
        `    reason: ${literal(e.reason)},\n` +
        `  },`
    )
    .join('\n');
  return `${source.slice(0, closeIndex)}\n${block}${source.slice(closeIndex)}`;
}

/** Ids already present anywhere in the file, so a re-run is a no-op rather
    than a duplicate entry (the list is a Set at runtime, but a duplicated
    literal makes the file misleading to read). */
export function alreadyBlocked(source: string, id: string): boolean {
  return source.includes(`youtubeId: '${id}'`);
}

type Options = { ids: string[]; reason: string; apply: boolean };

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { ids: [], reason: '', apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`${arg} needs a value`);
        process.exit(1);
      }
      return v;
    };
    switch (arg) {
      case '--ids':
        options.ids = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--reason':
        options.reason = next();
        break;
      case '--apply':
        options.apply = true;
        break;
      default:
        console.error(
          `Unknown flag "${arg}". Usage: npm run block -- --ids a,b --reason "why" [--apply]`
        );
        process.exit(1);
    }
  }
  if (options.ids.length === 0) {
    console.error('\n  --ids is required. Usage: npm run block -- --ids a,b --reason "why" [--apply]\n');
    process.exit(1);
  }
  return options;
}

function run(script: string, args: readonly string[]): void {
  console.log(`\n$ node ${script} ${args.join(' ')}`);
  execFileSync('node', [path.join(REPO_ROOT, 'scripts', script), ...args], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadEnv();

  const source = readFileSync(CONFIG_PATH, 'utf8');
  const supabase = getAdminClient();

  // Titles come from the candidate row when there is one, because the
  // blocklist is read by humans and "Channel — Title" is what makes an entry
  // reviewable a year later. Embeds published from an --ids pass always have
  // one; a seed clip does not, and falls back to its catalog creator.
  const { data: rows, error } = await supabase
    .from(CANDIDATES_TABLE)
    .select('youtube_id,title,channel_title')
    .in('youtube_id', options.ids);
  if (error) throw new Error(error.message);
  const byId = new Map((rows ?? []).map((r) => [r.youtube_id as string, r]));

  const reason =
    options.reason.trim() ||
    'removed from the catalog via /admin/catalog — no reason given';

  const fresh: NewBlock[] = [];
  const skipped: string[] = [];
  for (const id of options.ids) {
    if (alreadyBlocked(source, id)) {
      skipped.push(id);
      continue;
    }
    const row = byId.get(id);
    const title = row
      ? `${row.channel_title ?? '?'} — ${row.title ?? '?'}`
      : `(no candidate row) ${id}`;
    fresh.push({ youtubeId: id, title, reason });
  }

  console.log(`\nLoro block${options.apply ? '' : ' (PREVIEW — nothing written)'}`);
  console.log(`  ${options.ids.length} id(s) given, ${fresh.length} new, ${skipped.length} already blocked\n`);
  for (const e of fresh) console.log(`  + ${e.youtubeId}  ${e.title.slice(0, 70)}`);
  for (const id of skipped) console.log(`  · ${id} already in BLOCKED_VIDEOS — skipping`);
  console.log(`\n  reason: ${reason}`);

  if (fresh.length === 0) {
    console.log('\nNothing to add.\n');
    return;
  }
  if (!options.apply) {
    console.log('\nPREVIEW ONLY. Re-run with --apply to write the blocklist, refilter and prune.\n');
    return;
  }

  writeFileSync(CONFIG_PATH, insertBlockedVideos(source, fresh));
  console.log(`\n✓ wrote ${fresh.length} entr(ies) to scripts/config/harvest-queries.mts`);

  run('refilter-candidates.mts', ['--apply']);
  run('prune-embeds.mts', ['--apply']);

  console.log('\n========================================================');
  console.log('Removed locally. Nothing has reached a device yet.');
  console.log('Review with `git diff`, then ship it:\n');
  console.log('    npm run publish-catalog\n');
}

// Only run when invoked directly — the test imports the pure helpers above.
if (process.argv[1] && process.argv[1].endsWith('block-videos.mts')) {
  main().catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
