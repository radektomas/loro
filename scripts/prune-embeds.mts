#!/usr/bin/env node
/**
 * Loro — retire published embeds that no longer pass curation or that a
 * blocklist entry now names.
 *
 *   npm run prune-embeds              # report only, writes nothing
 *   npm run prune-embeds -- --apply   # remove them and mark the candidates
 *
 * Curation policy changes (a new exclusion, a raised floor) and blocklist
 * additions (BLOCKED_CHANNELS / BLOCKED_VIDEOS in config/harvest-queries.mts)
 * only affect FUTURE batches; videos published under the old rules stay in
 * the feed until something removes them. That is this script.
 *
 * CONTENT_KEYWORDS is deliberately NOT applied here: a published video
 * matching a keyword goes through human review (report-keyword-matches.mts)
 * because "matar el tiempo" is a fine title. The blocklists ARE applied —
 * each entry is already a reviewed human verdict about a specific channel or
 * video, so re-reviewing it at prune time would be re-litigating it.
 *
 * A pruned video is marked 'rejected' with a specific reject_reason rather
 * than deleted or returned to 'eligible' — same rule as the harvest: a row
 * we have already judged must keep its verdict, or the next run rediscovers
 * it, re-evaluates it, and re-publishes exactly what we just removed. For
 * blocklist prunes the reason is exactly the filter's ('channel_blocked' /
 * 'video_blocked'), so a later refilter reproduces rather than rewrites it.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO_ROOT } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE } from './lib/candidates.mts';
import { curationScore } from './config/curation.mts';
import {
  BLOCKED_CHANNEL_IDS,
  BLOCKED_VIDEO_IDS,
} from './config/harvest-queries.mts';

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
    .select('youtube_id,title,description,category_id,view_count,channel_title,channel_id')
    .in('youtube_id', ids);
  if (error) throw new Error(`candidate lookup failed: ${error.message}`);

  const byId = new Map((data ?? []).map((r) => [r.youtube_id as string, r]));

  /** What reject_reason to write: blocklist reasons stay bare so refilter
      reproduces them verbatim; curation reasons keep the unpublished: prefix. */
  const doomed: { id: string; label: string; reason: string; storedReason: string }[] = [];
  for (const entry of embeds) {
    // Video blocks apply even to entries with no candidate row: the id in the
    // JSON is the id that was blocked, and a hand-added entry is not exempt
    // from an editorial "never".
    if (BLOCKED_VIDEO_IDS.has(entry.youtubeId)) {
      const row = byId.get(entry.youtubeId);
      doomed.push({
        id: entry.youtubeId,
        label: `${row?.channel_title ?? entry.creator ?? '?'} — ${(row?.title ?? '').slice(0, 52)}`,
        reason: 'blocked video (BLOCKED_VIDEOS)',
        storedReason: 'video_blocked',
      });
      continue;
    }
    const row = byId.get(entry.youtubeId);
    // A published embed with no candidate row (hand-added, or a table edit)
    // is not ours to judge — leave it alone rather than silently dropping it.
    if (!row) continue;
    if (row.channel_id && BLOCKED_CHANNEL_IDS.has(row.channel_id as string)) {
      doomed.push({
        id: entry.youtubeId,
        label: `${row.channel_title ?? '?'} — ${(row.title ?? '').slice(0, 52)}`,
        reason: `blocked channel ${row.channel_id} (BLOCKED_CHANNELS)`,
        storedReason: 'channel_blocked',
      });
      continue;
    }
    // visionGate:true — the voiceover-listicle patterns are a text GUESS at
    // "is a person on camera", and for the published catalog that question is
    // answered from pixels: post-2026-08-14 publishes went through the gate,
    // and audit-on-camera.mts judges the rest the same way. Without this flag
    // the weaker classifier vetoes the stronger one — observed live
    // 2026-08-21, when the pattern flagged 10 gate-passed clips from
    // Romancito, the vetted channel whose hashtag style is the documented
    // counter-example to exactly this kind of heuristic.
    const verdict = curationScore(row, { visionGate: true });
    if (verdict.score < 0) {
      doomed.push({
        id: entry.youtubeId,
        label: `${row.channel_title ?? '?'} — ${(row.title ?? '').slice(0, 52)}`,
        reason: verdict.reason,
        storedReason: `unpublished: ${verdict.reason}`,
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
        reject_reason: d.storedReason,
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
