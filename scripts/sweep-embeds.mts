#!/usr/bin/env node
/**
 * Liveness sweep for published embeds — official Data API only, 1 unit per 50.
 *
 *   npm run sweep-embeds              # report dead embeds
 *   npm run sweep-embeds -- --apply   # also prune them from the feed JSON
 *
 * Embedded videos die out from under us (deleted, privated, embeds disabled).
 * This checks every id in data/embedVideos.json via videos.list and flags any
 * that are gone or no longer embeddable. With --apply, dead entries are
 * removed from the JSON and their candidate rows flipped to rejected
 * (embed_dead) so the discovery pipeline remembers.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO_ROOT, requireEnv } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE } from './lib/candidates.mts';
import { batchIds, listVideos } from './lib/youtube.mts';

const EMBEDS_PATH = path.join(REPO_ROOT, 'data', 'embedVideos.json');

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  loadEnv();
  const apiKey = requireEnv('YOUTUBE_API_KEY');

  const embeds = JSON.parse(readFileSync(EMBEDS_PATH, 'utf8')) as {
    id: string;
    youtubeId: string;
    creator: string;
  }[];
  if (embeds.length === 0) {
    console.log('\nNo embeds published yet — nothing to sweep.\n');
    return;
  }

  const alive = new Set<string>();
  let quota = 0;
  for (const batch of batchIds(embeds.map((e) => e.youtubeId))) {
    const videos = await listVideos(batch, apiKey);
    quota += 1;
    for (const video of videos) {
      if (!video.id) continue;
      // Present in the response AND still embeddable = alive. A video the
      // API omits entirely has been deleted or privated.
      if (video.status?.embeddable !== false) alive.add(video.id);
    }
  }

  const dead = embeds.filter((e) => !alive.has(e.youtubeId));
  console.log(`\nChecked ${embeds.length} embed(s) — ${dead.length} dead, ${quota} quota unit(s).`);
  for (const entry of dead) {
    console.log(`  ✗ ${entry.youtubeId}  ${entry.creator}`);
  }

  if (dead.length === 0 || !apply) {
    if (dead.length > 0) console.log('\nRe-run with --apply to prune them.');
    console.log('');
    return;
  }

  const deadIds = new Set(dead.map((e) => e.youtubeId));
  const kept = embeds.filter((e) => !deadIds.has(e.youtubeId));
  // Atomic write — same rationale as the publisher.
  writeFileSync(`${EMBEDS_PATH}.tmp`, JSON.stringify(kept, null, 2) + '\n');
  renameSync(`${EMBEDS_PATH}.tmp`, EMBEDS_PATH);

  const supabase = getAdminClient();
  for (const entry of dead) {
    const { error } = await supabase
      .from(CANDIDATES_TABLE)
      .update({ status: 'rejected', reject_reason: 'embed_dead' })
      .eq('youtube_id', entry.youtubeId);
    if (error) console.warn(`  ! could not record embed_dead for ${entry.youtubeId}: ${error.message}`);
  }
  console.log(`\nPruned ${dead.length}; data/embedVideos.json now holds ${kept.length}.\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
