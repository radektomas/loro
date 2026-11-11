/**
 * Make every Instagram post say what it is, so the dashboard can rank WHY a
 * reel won. Runs on Radek's Mac (Apple Vision, ffmpeg, the rendered reels):
 *
 *   node scripts/scale/enrich.mts
 *   node scripts/scale/enrich.mts --reread   (read every cover again, keeping Radek's edits)
 *
 * 1. Auto-link: each approved/posted /cut reel without a link is matched to
 *    its Instagram post by comparing the cover with our frames (dHash over the
 *    hook beat, 10 fps; the cover can be any frame Radek picked) and the hook
 *    read off the cover with the reel's hook (lib/linkMatch.ts).
 * 2. Tags from /cut: a linked post gets its hook, lines, demo and voice from
 *    the reel's job.
 * 3. Cover hooks: every other reel gets its hook read off the cover. An
 *    unreadable cover gets an empty row, so it isn't re-read every run; the
 *    dashboard shows "add hook".
 * Rows Radek edited (manual) are never overwritten.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getAdminClient } from '../lib/supabaseAdmin.mts';
import { shortcodeOf } from '../../lib/cutReels.ts';
import { hamming, pickMatch, type Candidate } from '../../lib/linkMatch.ts';
import { cleanCoverText, inferFormat, inferHookKind, line1Variant, textSimilarity, voiceOf, type OcrLine } from '../../lib/scaleStats.ts';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PY = `${homedir()}/.venvs/reels/bin/python`;
const CACHE = `${homedir()}/.cache/loro-cut`;
const COVERS = `${CACHE}/covers`;
const FRAMES = `${CACHE}/frames`;
mkdirSync(COVERS, { recursive: true });
mkdirSync(FRAMES, { recursive: true });

const db = getAdminClient();
type Row = Record<string, any>;

async function all(table: string, select: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const [accounts, media, tagRows, cutReels] = await Promise.all([
  all('loro_marketing_ig_accounts', 'ig_user_id, username'),
  all('loro_marketing_ig_media', 'media_id, ig_user_id, media_type, media_product_type, permalink, thumbnail_url, posted_at'),
  all('loro_marketing_post_tags', 'media_id, manual, hook, cut_reel_id'),
  all('loro_cut_reels', 'id, account, hook, lines, job, status, permalink, ig_media_id, posted_at, updated_at'),
]);
const usernameOf = new Map(accounts.map((a) => [String(a.ig_user_id), String(a.username)]));
const reels = media.filter((m) => m.media_product_type === 'REELS' || m.media_type === 'VIDEO');
const tags = new Map(tagRows.map((t) => [String(t.media_id), t]));
const byCode = new Map(media.map((m) => [shortcodeOf(m.permalink), String(m.media_id)]).filter(([c]) => c) as [string, string][]);

/** Download a cover into the cache (Instagram's CDN links expire; the daily sync refreshes them). */
async function cover(m: Row): Promise<string | null> {
  const file = `${COVERS}/${m.media_id}.jpg`;
  if (existsSync(file)) return file;
  if (!m.thumbnail_url) return null;
  const res = await fetch(m.thumbnail_url);
  if (!res.ok) return null;
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function ocr(files: string[]): Map<string, OcrLine[]> {
  const out = new Map<string, OcrLine[]>();
  for (let i = 0; i < files.length; i += 80) {
    const chunk = files.slice(i, i + 80);
    const txt = execFileSync('swift', [path.join(HERE, 'ocr.swift'), ...chunk], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
    for (const line of txt.split('\n').filter(Boolean)) {
      const j = JSON.parse(line);
      out.set(j.path, j.lines);
    }
  }
  return out;
}

function dhash(files: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!files.length) return out;
  const txt = execFileSync(PY, [path.join(HERE, 'dhash.py'), ...files], { encoding: 'utf8', maxBuffer: 64 << 20 });
  for (const line of txt.split('\n').filter(Boolean)) {
    const j = JSON.parse(line);
    out.set(j.path, j.hash);
  }
  return out;
}

/** Our reel's hook beat at 10 fps, hashed (cached per rendered file). */
function reelHashes(out: string, beat: number): string[] {
  if (!existsSync(out)) return [];
  // keyed by path AND mtime: a recut overwrites the same file
  const dir = `${FRAMES}/${Buffer.from(`${out}@${statSync(out).mtimeMs}`).toString('base64url').slice(-80)}`;
  if (!existsSync(dir) || readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-t', String(beat), '-vf', 'fps=10,scale=270:-2', `${dir}/%03d.png`]);
  }
  return [...dhash(readdirSync(dir).map((f) => `${dir}/${f}`)).values()].filter((h): h is string => !!h);
}

const linkedMedia = new Set(cutReels.map((r) => r.ig_media_id ?? byCode.get(shortcodeOf(r.permalink) ?? '')).filter(Boolean));
let linked = 0;
let fromCut = 0;
let read = 0;
let unreadable = 0;

// ---------- 1. auto-link ----------
const toLink = cutReels.filter((r) => ['approved', 'posted'].includes(r.status) && !r.ig_media_id && !r.permalink);
const candidateCovers = new Map<string, string>();
for (const r of toLink) {
  const since = new Date(r.updated_at).getTime() - 86400 * 1000;
  for (const m of reels) {
    if (usernameOf.get(m.ig_user_id) !== r.account || linkedMedia.has(m.media_id)) continue;
    if (new Date(m.posted_at).getTime() < since) continue;
    const f = await cover(m);
    if (f) candidateCovers.set(m.media_id, f);
  }
}
const candText = ocr([...candidateCovers.values()]);
const candHash = dhash([...candidateCovers.values()]);
for (const r of toLink) {
  const since = new Date(r.updated_at).getTime() - 86400 * 1000;
  const ours = reelHashes(r.job?.out ?? '', Number(r.job?.beat ?? 3));
  const cands: Candidate[] = [];
  for (const m of reels) {
    const f = candidateCovers.get(m.media_id);
    if (!f || usernameOf.get(m.ig_user_id) !== r.account || linkedMedia.has(m.media_id)) continue;
    if (new Date(m.posted_at).getTime() < since) continue;
    const h = candHash.get(f);
    const hook = cleanCoverText(candText.get(f) ?? []);
    cands.push({
      mediaId: m.media_id,
      hashDist: h && ours.length ? Math.min(...ours.map((o) => hamming(o, h))) : null,
      textSim: hook ? textSimilarity(hook, r.hook) : null,
    });
  }
  const pick = pickMatch(cands);
  if (!pick) continue;
  const m = reels.find((x) => x.media_id === pick)!;
  const { error } = await db
    .from('loro_cut_reels')
    .update({ ig_media_id: pick, status: 'posted', posted_at: r.posted_at ?? m.posted_at })
    .eq('id', r.id);
  if (error) throw new Error(`link ${r.id}: ${error.message}`);
  r.ig_media_id = pick;
  linkedMedia.add(pick);
  linked++;
  console.log(`linked @${r.account} "${r.hook}" → ${m.permalink}`);
}

// ---------- 2. tags from /cut ----------
const upserts: Row[] = [];
for (const r of cutReels) {
  const mid = r.ig_media_id ?? byCode.get(shortcodeOf(r.permalink) ?? '');
  if (!mid || tags.get(mid)?.manual) continue;
  const lines: string[] = (r.lines ?? []).map((l: any) => (typeof l === 'string' ? l : l.text));
  upserts.push({
    media_id: mid,
    hook: r.hook,
    hook_source: 'cut',
    hook_kind: inferHookKind(r.hook),
    format: 'cut',
    demo_kind: lines.some((l) => /peppa/i.test(l)) ? 'peppa' : 'reels',
    line1_variant: lines[0] ? line1Variant(lines[0]) : null,
    voice: voiceOf(lines),
    cut_reel_id: r.id,
    manual: false,
    updated_at: new Date().toISOString(),
  });
  fromCut++;
}

// ---------- 3. hooks off covers ----------
const fromCutIds = new Set(upserts.map((u) => u.media_id));
// --reread: read every cover again (after the cleaning rules improve); rows Radek edited are kept
const reread = process.argv.includes('--reread');
const todo = reels.filter((m) => !fromCutIds.has(m.media_id) && (reread ? !tags.get(m.media_id)?.manual && tags.get(m.media_id)?.cut_reel_id == null : !tags.has(m.media_id)));
const files = new Map<string, string>();
for (const m of todo) {
  const f = await cover(m);
  if (f) files.set(m.media_id, f);
}
const text = ocr([...files.values()]);
for (const m of todo) {
  const f = files.get(m.media_id);
  if (!f) continue; // cover not downloadable now: retried next run
  const hook = cleanCoverText(text.get(f) ?? []);
  upserts.push({
    media_id: m.media_id,
    hook,
    hook_source: hook ? 'cover' : null,
    hook_kind: hook ? inferHookKind(hook) : null,
    format: hook ? inferFormat(hook) : 'other',
    demo_kind: 'unknown',
    manual: false,
    updated_at: new Date().toISOString(),
  });
  if (hook) read++;
  else unreadable++;
}

// one row per post: two /cut reels can carry the same link (an old slot, a pasted twice link), and
// Postgres refuses to upsert the same row twice in one statement. The first one seen wins.
const unique = [...new Map([...upserts].reverse().map((u) => [u.media_id, u])).values()];
for (let i = 0; i < unique.length; i += 200) {
  const { error } = await db.from('loro_marketing_post_tags').upsert(unique.slice(i, i + 200), { onConflict: 'media_id' });
  if (error) throw new Error(`loro_marketing_post_tags: ${error.message}`);
}
console.log(`linked ${linked} · tagged from /cut ${fromCut} · hooks read ${read} · unreadable ${unreadable}`);
