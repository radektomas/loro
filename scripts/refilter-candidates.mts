#!/usr/bin/env node
/**
 * Re-apply the eligibility filter to candidates already in the table.
 *
 *   npm run refilter            # preview only — shows every transition
 *   npm run refilter -- --apply # write the new verdicts
 *
 * Costs ZERO quota: it re-reads rows we already paid for and re-runs a pure
 * function over them. Use it after editing anything in
 * scripts/config/harvest-queries.mts — a threshold, a dubbing pattern, or the
 * channel blocklist — to make the change retroactive instead of only applying
 * to future harvests.
 *
 * SAFETY: unlike the harvest, this script writes nothing by default. It
 * rewrites verdicts in bulk, which is a genuinely destructive-shaped
 * operation, so --apply is required. That deliberately inverts the harvest's
 * --dry-run convention; appending new rows and mass-rewriting existing ones
 * do not deserve the same default.
 *
 * SCOPE: only rows in 'discovered' | 'eligible' | 'rejected' are touched.
 * Rows at 'processing', 'ready' or 'published' are downstream of a
 * transcription or a human decision and are never reset by a config edit.
 *
 * Within 'rejected', rows whose reject_reason was recorded by a judge
 * DOWNSTREAM of this filter — the vision gate (not_on_camera:*), the caption
 * fetch (no_captions, captions_too_thin), the liveness sweep (embed_dead),
 * or a curation prune (unpublished:*) — are frozen too. Those verdicts are
 * facts about pixels, captions or a human decision; the pure filter can
 * neither reproduce nor refute them, and before this guard existed a refilter
 * would cheerfully flip 79 gate-rejected voiceover/hands-only videos back to
 * 'eligible' (observed live, 2026-08-21) for publish-embeds to pay to
 * re-judge.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BLOCKED_CHANNELS,
  BLOCKED_VIDEOS,
  CONTENT_KEYWORDS,
} from './config/harvest-queries.mts';
import { loadEnv } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE, type CandidateRow } from './lib/candidates.mts';
import { filterCandidate } from './lib/candidateFilter.mts';

/** Statuses a config change is allowed to revise. */
const REVISABLE = new Set(['discovered', 'eligible', 'rejected']);

/** Reject reasons this filter did not produce and must not overturn. */
const DOWNSTREAM_REASON =
  /^(not_on_camera\b|no_captions$|captions_too_thin$|embed_dead$|unpublished:)/;

/** Is this row's verdict one the pure filter is allowed to revise? */
function revisable(row: CandidateRow): boolean {
  if (!REVISABLE.has(row.status)) return false;
  if (row.status === 'rejected' && row.reject_reason && DOWNSTREAM_REASON.test(row.reject_reason)) {
    return false;
  }
  return true;
}

type Transition = {
  youtubeId: string;
  channelTitle: string;
  title: string;
  from: string;
  fromReason: string | null;
  to: string;
  toReason: string | null;
};

function padRight(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length);
}

async function fetchAll(supabase: SupabaseClient): Promise<CandidateRow[]> {
  const all: CandidateRow[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(CANDIDATES_TABLE)
      .select('*')
      // Deterministic order: the diversity cap depends on the order rows are
      // judged in, so a re-filter must be reproducible run to run.
      .order('discovered_at', { ascending: true })
      .order('youtube_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`read failed: ${error.message}`);
    const rows = (data ?? []) as CandidateRow[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  if (args.some((a) => a !== '--apply')) {
    console.error(`\nUnknown flag. Usage: npm run refilter [-- --apply]\n`);
    process.exit(1);
  }
  loadEnv();
  const supabase = getAdminClient();

  const rows = await fetchAll(supabase);
  const revisableRows = rows.filter(revisable);
  const frozenStatus = rows.filter((row) => !REVISABLE.has(row.status)).length;
  const frozenDownstream = rows.length - revisableRows.length - frozenStatus;

  console.log(`\nRe-filtering ${revisableRows.length} of ${rows.length} rows` +
    (frozenStatus ? ` (${frozenStatus} at processing/ready/published left untouched` : '(') +
    (frozenDownstream ? `${frozenStatus ? ', ' : ''}${frozenDownstream} rejected by downstream judges left untouched)` : ')'));
  console.log(`Blocklist: ${BLOCKED_CHANNELS.length} channel(s), ${BLOCKED_VIDEOS.length} video(s); ${CONTENT_KEYWORDS.length} content-keyword pattern(s)`);
  for (const channel of BLOCKED_CHANNELS) {
    console.log(`  - ${channel.title} (${channel.channelId}) — ${channel.reason}`);
  }
  for (const video of BLOCKED_VIDEOS) {
    console.log(`  - video ${video.youtubeId} (${video.title}) — ${video.reason}`);
  }
  if (!apply) console.log('\nPREVIEW ONLY — no writes. Re-run with --apply to commit.');

  // Rebuild the per-channel eligible counts from scratch rather than reading
  // the current ones: a full re-filter must produce the same result whatever
  // order the rows were originally harvested in.
  const channelCounts = new Map<string, number>();
  const transitions: Transition[] = [];
  const toReasons = new Map<string, number>();

  for (const row of revisableRows) {
    const verdict = filterCandidate(row, { eligibleCountsByChannel: channelCounts });
    const nextStatus = verdict.eligible ? 'eligible' : 'rejected';
    const nextReason = verdict.eligible ? null : (verdict.reason ?? null);
    if (verdict.eligible && row.channel_id) {
      channelCounts.set(row.channel_id, (channelCounts.get(row.channel_id) ?? 0) + 1);
    }
    toReasons.set(nextReason ?? 'eligible', (toReasons.get(nextReason ?? 'eligible') ?? 0) + 1);

    if (row.status !== nextStatus || row.reject_reason !== nextReason) {
      transitions.push({
        youtubeId: row.youtube_id,
        channelTitle: row.channel_title ?? '?',
        title: row.title ?? '',
        from: row.status,
        fromReason: row.reject_reason,
        to: nextStatus,
        toReason: nextReason,
      });
    }
  }

  console.log(`\n${transitions.length} row(s) would change:\n`);
  const grouped = new Map<string, Transition[]>();
  for (const t of transitions) {
    const key = `${t.from}${t.fromReason ? `(${t.fromReason})` : ''} -> ${t.to}${t.toReason ? `(${t.toReason})` : ''}`;
    const list = grouped.get(key) ?? [];
    list.push(t);
    grouped.set(key, list);
  }
  for (const [key, list] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${key}   x${list.length}`);
    for (const t of list.slice(0, 8)) {
      console.log(`      ${padRight(t.channelTitle, 26)} ${t.title.slice(0, 46)}`);
    }
    if (list.length > 8) console.log(`      … and ${list.length - 8} more`);
  }

  console.log('\nResulting verdict distribution:');
  for (const [reason, count] of [...toReasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${padRight(reason, 26)} ${String(count).padStart(5)}`);
  }

  if (!apply) {
    console.log('\nNothing written. Re-run with --apply to commit these changes.\n');
    return;
  }

  let written = 0;
  for (const t of transitions) {
    const { error } = await supabase
      .from(CANDIDATES_TABLE)
      .update({ status: t.to, reject_reason: t.toReason })
      .eq('youtube_id', t.youtubeId);
    if (error) {
      console.error(`  ! ${t.youtubeId}: ${error.message}`);
      continue;
    }
    written += 1;
  }
  console.log(`\nApplied ${written}/${transitions.length} updates.\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
