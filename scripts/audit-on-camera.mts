#!/usr/bin/env node
/**
 * Loro — REVIEW LIST: run the on-camera vision gate over every PUBLISHED
 * embed and report the ones where no real person is visibly speaking —
 * screen recordings, phone tutorials, hands-only demos, B-roll voiceovers.
 *
 *   npm run audit-on-camera                    # audit everything not yet judged
 *   npm run audit-on-camera -- --limit 20      # first N unjudged only
 *   npm run audit-on-camera -- --fresh         # discard the report, re-judge all
 *
 * WHY. The gate (lib/onCameraGate.mts) has stood in front of publish-embeds
 * only since 2026-08-14. Everything published before that was selected by
 * text proxies alone, and the proxies provably leak (the gate's own header
 * cites a published hands-and-cardboard video). This runs the same judge
 * retroactively so the pre-gate portion of the catalog gets the same bar.
 *
 * REPORT ONLY. Writes no candidate status and touches no JSON catalog — a
 * gate failure here is a REVIEW ITEM, not a verdict: the gate samples three
 * frames and is measured to drop real vlogs that cut to B-roll. Remove
 * confirmed offenders via BLOCKED_VIDEOS / BLOCKED_CHANNELS + prune-embeds,
 * same as every other editorial removal.
 *
 * Resumable: verdicts are appended to the report file after every video
 * (tmp+rename, same crash-safety as the publishers), and already-judged ids
 * are skipped on the next run. The report lives in data/ but is gitignored —
 * it is derived state, not catalog source.
 *
 * Needs OPENAI_API_KEY (the model call) in .env. Frames come free from
 * i.ytimg.com. Whole-catalog cost at ~$0.001/video is well under a dollar;
 * --budget-usd guards it anyway (default $5).
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO_ROOT } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE } from './lib/candidates.mts';
import {
  GATE_MODEL,
  judgeOnCamera,
  NoFramesError,
  type OnCameraVerdict,
} from './lib/onCameraGate.mts';
import { sleep } from './lib/youtube.mts';
import {
  BudgetExceededError,
  assertAffordable,
  report as costReport,
  setBudget,
} from './lib/openaiCost.mts';

const EMBEDS_PATH = path.join(REPO_ROOT, 'data', 'embedVideos.json');
const REPORT_PATH = path.join(REPO_ROOT, 'data', 'on-camera-audit.report.json');

/** Politeness between videos. Frame fetches are CDN hits, not watch-page
    scrapes, so this is far below CAPTION_FETCH_DELAY_MS on purpose. */
const DELAY_MS = 250;

type EmbedEntry = { youtubeId: string; creator?: string };

type AuditEntry = OnCameraVerdict & {
  title: string;
  channel: string;
  judgedAt: string;
};

type Report = {
  model: string;
  verdicts: Record<string, AuditEntry>;
};

function loadReport(fresh: boolean): Report {
  if (!fresh) {
    try {
      return JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as Report;
    } catch {
      // Missing or unreadable: start clean. Unlike the catalog files, this is
      // derived state whose loss costs only a re-run, so a bare catch is fine.
    }
  }
  return { model: GATE_MODEL, verdicts: {} };
}

function saveReport(report: Report): void {
  const tmp = `${REPORT_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(tmp, REPORT_PATH);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fresh = args.includes('--fresh');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const budgetIdx = args.indexOf('--budget-usd');
  const budget = budgetIdx >= 0 ? Number(args[budgetIdx + 1]) : 5;
  if (!Number.isFinite(budget) || budget <= 0 || (limitIdx >= 0 && !Number.isInteger(limit))) {
    console.error('Usage: npm run audit-on-camera [-- --limit N --budget-usd 5 --fresh]');
    process.exit(1);
  }

  loadEnv();
  setBudget(budget);
  const supabase = getAdminClient();

  const embeds = JSON.parse(readFileSync(EMBEDS_PATH, 'utf8')) as EmbedEntry[];
  const report = loadReport(fresh);

  // Titles give the judge context and make the report readable; they live
  // only in the candidates table.
  const meta = new Map<string, { title: string; channel: string }>();
  const CHUNK = 100;
  const ids = embeds.map((e) => e.youtubeId);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from(CANDIDATES_TABLE)
      .select('youtube_id,title,channel_title')
      .in('youtube_id', ids.slice(i, i + CHUNK));
    if (error) throw new Error(`candidate lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      meta.set(row.youtube_id as string, {
        title: (row.title as string | null) ?? '',
        channel: (row.channel_title as string | null) ?? '',
      });
    }
  }

  const pending = embeds.filter((e) => !report.verdicts[e.youtubeId]).slice(0, limit);
  console.log(`\nLoro on-camera audit (REPORT ONLY) — model ${GATE_MODEL}`);
  console.log(`  ${embeds.length} published, ${Object.keys(report.verdicts).length} already judged, ${pending.length} to judge\n`);

  let judged = 0;
  let noFrames = 0;
  for (const entry of pending) {
    const id = entry.youtubeId;
    const m = meta.get(id);
    try {
      assertAffordable();
      const verdict = await judgeOnCamera(id, m?.title ?? '');
      report.verdicts[id] = {
        ...verdict,
        title: m?.title ?? '',
        channel: m?.channel ?? entry.creator ?? '',
        judgedAt: new Date().toISOString(),
      };
      saveReport(report);
      judged += 1;
      console.log(
        `  ${verdict.onCamera ? '✓' : '✗'} ${id}  [${verdict.format}] ` +
          `${verdict.framesWithSpeaker}/3  ${(m?.channel ?? entry.creator ?? '?').slice(0, 20)} — ${(m?.title ?? '').slice(0, 44)}`
      );
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        console.log(`\n  ⛔ ${error.message} — stopping. Re-run to resume.\n`);
        break;
      }
      if (error instanceof NoFramesError) {
        // Unknowable, not a verdict — do not persist, retry next run.
        noFrames += 1;
        console.log(`  ? ${id}  no frames served — skipped`);
      } else {
        console.log(`  ! ${id}  transient: ${error instanceof Error ? error.message : error}`);
      }
    }
    await sleep(DELAY_MS);
  }

  // ------------------------------------------------------------- summary
  const fails = Object.entries(report.verdicts)
    .filter(([, v]) => !v.onCamera)
    .sort((a, b) => a[1].format.localeCompare(b[1].format));

  console.log('\n' + '='.repeat(56));
  console.log(`judged this run ${judged}   no-frames ${noFrames}   total judged ${Object.keys(report.verdicts).length}/${embeds.length}`);
  console.log(costReport());
  console.log(`\n${fails.length} published video(s) FAIL the gate — review these:\n`);
  const byFormat = new Map<string, typeof fails>();
  for (const f of fails) {
    const list = byFormat.get(f[1].format) ?? [];
    list.push(f);
    byFormat.set(f[1].format, list);
  }
  for (const [format, list] of [...byFormat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${format}   x${list.length}`);
    for (const [id, v] of list) {
      console.log(`    ${id}  ${v.framesWithSpeaker}/3  ${v.channel.slice(0, 22)} — ${v.title.slice(0, 48)}`);
      console.log(`      ${v.reason}   https://www.youtube.com/watch?v=${id}`);
    }
    console.log('');
  }
  console.log(`Full report: ${path.relative(REPO_ROOT, REPORT_PATH)}`);
  console.log('To remove confirmed offenders: BLOCKED_VIDEOS / BLOCKED_CHANNELS,');
  console.log('then `npm run prune-embeds -- --apply` and `npm run publish-catalog`.\n');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
