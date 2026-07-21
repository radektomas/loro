#!/usr/bin/env node
/**
 * Loro — fill difficulty_level on eligible candidates, before publishing.
 *
 *   npm run rate-candidates -- --limit 40        # rate 40 unrated candidates
 *   npm run rate-candidates -- --dry-run         # show levels, write nothing
 *   npm run rate-candidates -- --limit 200
 *
 * WHY THIS EXISTS. difficulty_level has been null on every row since the
 * table was created, so publishing could not select for learner level and
 * the feed skewed hard to fast speech: after the first 48 videos the split
 * was A1 5 / A2 8 / B1 18 / B2 6 — a genuine beginner had about three
 * minutes of usable content. Natural vlog speech is fast; that is exactly
 * what good curation selects for.
 *
 * WHY IT IS CHEAP. Level comes from speech rate, which needs the caption
 * track and nothing else. Captions cost no YouTube API quota and no OpenAI
 * spend, so a candidate can be rated for free and only the ones we actually
 * want get the expensive translate+gloss pass in publish-embeds.
 *
 * Idempotent and resumable: only rows with a null difficulty_level are
 * considered, and each is written as soon as it is rated, so an interrupt
 * loses at most the row in flight. A candidate whose captions cannot be
 * fetched is left null and simply retried on a later run — it is never
 * rejected here, because a bot check and a caption-less video look
 * identical from outside and this script must not poison the pool.
 */

import { loadEnv } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE } from './lib/candidates.mts';
import {
  CAPTION_FETCH_DELAY_MS,
  fetchCaptions,
  NoCaptionsError,
} from './lib/captionFetch.mts';
import { json3ToCues } from './lib/json3ToCues.mts';
import { estimateLevel, speechRate } from './lib/estimateLevel.mts';
import { curationScore } from './config/curation.mts';
import { sleep } from './lib/youtube.mts';

type Options = { limit: number; dryRun: boolean };

function parseArgs(argv: string[]): Options {
  const options: Options = { limit: 40, dryRun: argv.includes('--dry-run') };
  const at = argv.indexOf('--limit');
  if (at >= 0) {
    const value = Number(argv[at + 1]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`--limit needs a positive number, got ${argv[at + 1]}`);
    }
    options.limit = value;
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadEnv();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from(CANDIDATES_TABLE)
    .select('youtube_id,title,channel_title,category_id,view_count,description')
    .eq('status', 'eligible')
    .is('difficulty_level', null)
    .limit(2000);
  if (error) throw new Error(`candidate query failed: ${error.message}`);

  // Only rate what we would ever publish — no point spending requests on
  // rows curation already rules out.
  const queue = (data ?? [])
    .filter((row) => curationScore(row).score >= 0)
    .slice(0, options.limit);

  console.log(`\nLoro candidate rater${options.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  ${data?.length ?? 0} unrated eligible, ${queue.length} to rate\n`);

  const tally: Record<string, number> = {};
  let failed = 0;

  for (const row of queue) {
    const id = row.youtube_id as string;
    try {
      const { json3 } = await fetchCaptions(id);
      const cues = json3ToCues(json3);
      const level = estimateLevel(cues);
      const wpm = speechRate(cues);
      tally[level] = (tally[level] ?? 0) + 1;

      const rate = wpm === null ? ' n/a ' : `${Math.round(wpm)}`.padStart(4);
      console.log(
        `  ${level}  ${rate} wpm  ${(row.channel_title ?? '?').slice(0, 22).padEnd(24)}${(row.title ?? '').slice(0, 44)}`
      );

      if (!options.dryRun) {
        const { error: updateError } = await supabase
          .from(CANDIDATES_TABLE)
          .update({ difficulty_level: level, updated_at: new Date().toISOString() })
          .eq('youtube_id', id);
        if (updateError) {
          throw new Error(`write failed for ${id}: ${updateError.message}`);
        }
      }
    } catch (err) {
      failed++;
      const why = err instanceof NoCaptionsError ? err.message : String(err);
      console.log(`  --   skip  ${id}: ${why.slice(0, 88)}`);
    }
    await sleep(CAPTION_FETCH_DELAY_MS);
  }

  console.log('\n========================================================');
  const summary = Object.entries(tally)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${v}`)
    .join('   ');
  console.log(`rated ${queue.length - failed}   ${summary}   unrated ${failed}`);
  console.log('');
}

await main();
