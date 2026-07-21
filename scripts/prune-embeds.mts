#!/usr/bin/env node
/**
 * Loro — retire published embeds that no longer pass curation.
 *
 *   npm run prune-embeds              # report only, writes nothing
 *   npm run prune-embeds -- --apply   # remove them and mark the candidates
 *
 * Curation policy changes (a new exclusion, a raised floor) only affect
 * FUTURE batches; videos published under the old rules stay in the feed
 * until something removes them. That is this script.
 *
 * A pruned video is marked 'rejected' with a specific reject_reason rather
 * than deleted or returned to 'eligible' — same rule as the harvest: a row
 * we have already judged must keep its verdict, or the next run rediscovers
 * it, re-evaluates it, and re-publishes exactly what we just removed.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO_ROOT } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE } from './lib/candidates.mts';
import { curationScore } from './config/curation.mts';

const EMBEDS_PATH = path.join(REPO_ROOT, 'data', 'embedVideos.json');

type EmbedEntry = { youtubeId: string; creator?: string };

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  loadEnv();
  const supabase = getAdminClient();

  const raw = readFileSync(EMBEDS_PATH, 'utf8');
  const embeds = JSON.parse(raw) as EmbedEntry[];
  const ids = embeds.map((e) => e.youtubeId);

  const { data, error } = await supabase
    .from(CANDIDATES_TABLE)
    .select('youtube_id,title,description,category_id,view_count,channel_title')
    .in('youtube_id', ids);
  if (error) throw new Error(`candidate lookup failed: ${error.message}`);

  const byId = new Map((data ?? []).map((r) => [r.youtube_id as string, r]));

  const doomed: { id: string; label: string; reason: string }[] = [];
  for (const entry of embeds) {
    const row = byId.get(entry.youtubeId);
    // A published embed with no candidate row (hand-added, or a table edit)
    // is not ours to judge — leave it alone rather than silently dropping it.
    if (!row) continue;
    const verdict = curationScore(row);
    if (verdict.score < 0) {
      doomed.push({
        id: entry.youtubeId,
        label: `${row.channel_title ?? '?'} — ${(row.title ?? '').slice(0, 52)}`,
        reason: verdict.reason,
      });
    }
  }

  console.log(`\nLoro embed pruner${apply ? '' : ' (REPORT ONLY)'}`);
  console.log(`  ${embeds.length} published, ${doomed.length} now fail curation\n`);
  for (const d of doomed) {
    console.log(`  ✗ ${d.id}  ${d.label}`);
    console.log(`      ${d.reason}`);
  }
  if (doomed.length === 0) {
    console.log('  Nothing to prune.\n');
    return;
  }
  if (!apply) {
    console.log('\n  Re-run with --apply to remove these.\n');
    return;
  }

  const remove = new Set(doomed.map((d) => d.id));
  const kept = embeds.filter((e) => !remove.has(e.youtubeId));

  // Mark candidates first: if the write fails we have changed nothing.
  for (const d of doomed) {
    const { error: updateError } = await supabase
      .from(CANDIDATES_TABLE)
      .update({
        status: 'rejected',
        reject_reason: `unpublished: ${d.reason}`,
        updated_at: new Date().toISOString(),
      })
      .eq('youtube_id', d.id);
    if (updateError) {
      throw new Error(`failed to mark ${d.id}: ${updateError.message}`);
    }
  }

  const tmp = `${EMBEDS_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(kept, null, 2)}\n`);
  renameSync(tmp, EMBEDS_PATH);

  console.log(`\n  Removed ${doomed.length}. ${kept.length} video(s) remain.\n`);
}

await main();
