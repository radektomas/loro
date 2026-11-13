/**
 * What the scaler reads before it plans a batch: what's winning, what's
 * untested, and which clip pairs are waiting in the REELS inbox.
 *
 *   node scripts/scale/report.mts            (runs enrich.mts first)
 *   node scripts/scale/report.mts --no-enrich
 *
 * Prints markdown. Every number is a multiple of the reel's own channel's
 * usual reel at the time it was posted (lib/scaleStats.ts), never raw views.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getAdminClient } from '../lib/supabaseAdmin.mts';
import { loadMarketingData } from '../../app/api/_lib/instagram.ts';
import { buildMarketingData } from '../../app/api/_lib/marketingData.ts';
import { ACCOUNTS, hookKey, type Account } from '../../lib/cutReels.ts';
import { baselineAt, rankBy, scorePosts, trackRecord, type Dimension, type PostTags, type ScoredPost } from '../../lib/scaleStats.ts';

const HERE = path.dirname(new URL(import.meta.url).pathname);
if (!process.argv.includes('--no-enrich')) {
  execFileSync('node', [path.join(HERE, 'enrich.mts')], { stdio: ['ignore', 'inherit', 'inherit'] });
}

/** The inbox folders on the Desktop (cut-reels skill): never a folder named "loro.app". */
const INBOX: Record<Account, string> = {
  'radek.spanish': `${homedir()}/Desktop/REELS radek.spanish`,
  'radek.explains.spanish': `${homedir()}/Desktop/REELS radek.explains.spanish`,
  'loro.app': `${homedir()}/Desktop/REELS loro app`,
};

const data = buildMarketingData(await loadMarketingData(getAdminClient()));
const name = new Map(data.accounts.map((a) => [a.igUserId, a.username]));
const idOf = new Map(data.accounts.map((a) => [a.username, a.igUserId]));
const reelPosts = data.posts.filter((p) => p.productType === 'REELS' || (p.productType == null && p.mediaType === 'VIDEO'));
const reels = scorePosts(reelPosts, new Map<string, PostTags>(Object.entries(data.tags)));
const x = (m: number | null) => (m == null ? '–' : `${m.toFixed(1)}x`);
const hookOf = (r: ScoredPost) => r.tags?.hook ?? '(no hook)';
const out: string[] = [];
const say = (s = '') => out.push(s);

say(`# Scaler report — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
say();
say('## Channels (usual reel = median of the last 12 settled reels)');
for (const a of ACCOUNTS) {
  const id = idOf.get(a);
  if (!id) {
    say(`- @${a}: not connected`);
    continue;
  }
  const own = reels.filter((r) => r.igUserId === id);
  const now = baselineAt(own, id, new Date(Date.now() + 48 * 3600 * 1000));
  const monthAgo = baselineAt(own, id, new Date(Date.now() - 30 * 86400 * 1000));
  say(`- @${a}: usual reel ${now ?? '–'} views (a month ago ${monthAgo ?? '–'}), ${own.length} reels`);
}

const DIMS: [Dimension, string, number][] = [
  ['hook', 'Hooks', 15],
  ['hookKind', 'Hook style', 5],
  ['line1Variant', 'Line 1 (/cut reels)', 8],
  ['voice', 'Voice (/cut reels)', 3],
  ['demoKind', 'Demo', 5],
  ['format', 'Format', 5],
];
for (const scope of ['all channels', ...ACCOUNTS] as const) {
  const pool = scope === 'all channels' ? reels : reels.filter((r) => name.get(r.igUserId) === scope);
  if (pool.length === 0) continue;
  say();
  say(`## Winners — ${scope === 'all channels' ? scope : `@${scope}`}`);
  for (const [dim, label, top] of DIMS) {
    const rows = rankBy(pool, dim).slice(0, top);
    if (!rows.length) continue;
    say(`### ${label}`);
    for (const r of rows) say(`- ${r.verdict.toUpperCase()} ${x(r.medianMultiple)} (n=${r.n}, ${x(r.min)}–${x(r.max)}, last 3: ${x(r.recentMedian)}) ${r.label}`);
  }
}

const recent = reels.filter((r) => r.settled && r.multiple != null && Date.now() - new Date(r.postedAt).getTime() < 14 * 86400 * 1000);
say();
say('## Last 14 days');
say('### Top 5');
for (const r of [...recent].sort((a, b) => b.multiple! - a.multiple!).slice(0, 5)) say(`- ${x(r.multiple)} @${name.get(r.igUserId)} ${r.postedAt.slice(0, 10)} "${hookOf(r)}" [${r.tags?.format ?? '?'}/${r.tags?.demoKind ?? '?'}]`);
say('### Bottom 5');
for (const r of [...recent].sort((a, b) => a.multiple! - b.multiple!).slice(0, 5)) say(`- ${x(r.multiple)} @${name.get(r.igUserId)} ${r.postedAt.slice(0, 10)} "${hookOf(r)}" [${r.tags?.format ?? '?'}/${r.tags?.demoKind ?? '?'}]`);
const climbing = reels.filter((r) => !r.settled);
if (climbing.length) say(`(still climbing, not judged: ${climbing.map((r) => `@${name.get(r.igUserId)} "${hookOf(r)}"`).join('; ')})`);

const bank = JSON.parse(readFileSync(path.join(HERE, '../cut/hooks.json'), 'utf8')) as { hooks: { text: string; kind: string }[]; banned?: string[] };
const hookRank = new Map(rankBy(reels, 'hook').map((r) => [r.key, r]));
say();
say('## Hook bank (scripts/cut/hooks.json)');
for (const a of ACCOUNTS) {
  const id = idOf.get(a);
  const usedHere = new Set(reels.filter((r) => r.igUserId === id && r.tags?.hook).map((r) => hookKey(r.tags!.hook!)));
  const fresh = bank.hooks.filter((h) => !usedHere.has(hookKey(h.text)));
  say(`### Never posted on @${a} (${fresh.length})`);
  for (const h of fresh) {
    const r = hookRank.get(hookKey(h.text));
    say(`- [${h.kind}] ${h.text}${r ? `  ← elsewhere: ${r.verdict} ${x(r.medianMultiple)} n=${r.n}` : ''}`);
  }
}

const VIDEO = /\.(mov|mp4|m4v)$/i;
const dur = (f: string) => {
  try {
    return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim()).toFixed(1);
  } catch {
    return '?';
  }
};
const clips = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => VIDEO.test(f) && !f.startsWith('.')).sort().map((f) => path.join(dir, f)) : []);
say();
say('## Inbox (pairs in filename order: 1st me with 1st demo…)');
let pairs = 0;
for (const a of ACCOUNTS) {
  const me = clips(`${INBOX[a]}/me`);
  const demo = clips(`${INBOX[a]}/demo`);
  const loose = clips(INBOX[a]);
  if (!me.length && !demo.length && !loose.length) continue;
  say(`### @${a}`);
  for (let i = 0; i < Math.max(me.length, demo.length); i++) {
    if (me[i] && demo[i]) {
      pairs++;
      say(`- pair ${i + 1}: me ${me[i]} (${dur(me[i])}s) + demo ${demo[i]} (${dur(demo[i])}s)`);
    } else say(`- left over: ${me[i] ?? demo[i]}`);
  }
  if (loose.length) say(`- loose in the folder (not in me/ or demo/, tell them apart by their frames): ${loose.join(', ')}`);
}
if (pairs === 0) say('(empty: nothing to plan until Radek drops clips in)');

const mediaOf = new Map(Object.entries(data.cutReels).map(([mid, r]) => [r.id, mid]));
const results = data.plans.flatMap((p) =>
  p.items
    .filter((i) => i.status === 'cut')
    .map((i) => {
      const r = i.cutReelId ? reels.find((p2) => p2.mediaId === mediaOf.get(i.cutReelId!)) : undefined;
      return { role: i.role, expected: i.expectedMultiple, actual: r?.settled ? r.multiple : null };
    })
);
const tr = trackRecord(results);
say();
say('## Scaler track record');
say(`- repeat-a-winner reels: median ${x(tr.exploit.median)} (n=${tr.exploit.n}) · test reels: median ${x(tr.test.median)} (n=${tr.test.n}) · hit expected: ${tr.hitRate == null ? '–' : `${Math.round(tr.hitRate * 100)}%`}`);
const open = data.plans.filter((p) => p.status === 'proposed');
if (open.length) say(`- ${open.length} plan(s) still waiting for Radek on getloro.app/marketing#plan`);

console.log(out.join('\n'));
