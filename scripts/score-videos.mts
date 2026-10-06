/**
 * SCORE EVERY VIDEO FROM HOW PEOPLE ACTUALLY WATCHED IT — the input to the
 * ranked feed (core/feedRank.ts; Radek, 2026-10-03: "good unseen videos
 * with good ratings ... filter out the shit videos").
 *
 *   npm run score-videos                 # compute, print, write the bundled file
 *   npm run score-videos -- --publish    # ...and upload it for apps already out
 *
 * THE SIGNALS, all from loro_analytics_events (store builds only):
 *   watch-through  time from reaching a video to reaching the next one, as a
 *                  share of the video's length, capped at 1. video_watched
 *                  fires when a slide takes the screen ("reached", not
 *                  "finished"), so the gap to the next one is the dwell.
 *                  Gaps over 5 minutes are a closed app, not a watch.
 *   early skip     swiped away inside 3 seconds.
 *   saves          words saved from it, per view.
 * engagement = 0.6 watch + 0.25 (1 - skip) + 0.15 min(1, 3 * saves/view).
 *
 * SMALL NUMBERS ARE SHRUNK, not trusted. A video's score is pulled toward
 * its CREATOR's, and a creator's toward the catalog average, by how little
 * evidence there is (empirical-Bayes style: VIDEO_K and CREATOR_K pseudo-
 * views). So one bad view never buries a video, and a creator whose videos
 * people keep skipping drags down its unwatched ones too.
 *
 * SHORT FIRST (Radek, 2026-10-06). Watch-through is ~66% on clips of 20s
 * or less and ~20% on 36-60s ones, which were 57% of all views — so a
 * new user's first minutes were mostly clips they abandoned. Every video's
 * score gets a length bonus (lengthBonus): short up, long down. It goes
 * into the published score itself, so installed apps feel it on their next
 * launch, and every catalog video gets a score so new short ones do too.
 * Benching still judges the score WITHOUT the bonus: a short video people
 * skip is still benched.
 *
 * BENCHED = smoothed score under BENCH_BELOW with real evidence behind it
 * (the creator's views >= BENCH_MIN_EVIDENCE). Benched videos sort after
 * everything; they are not deleted.
 *
 * OUTPUT: packages/core/src/catalog/videoScores.ts, bundled into the app,
 * and with --publish the same bytes at loro-catalog/feed/scores.json, which
 * the app refreshes from, so scores move without a release.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO_ROOT } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';

const DAYS = 60;
const MAX_GAP_S = 300;
const SKIP_S = 3;
const VIDEO_K = 6;
const CREATOR_K = 5;
const BENCH_BELOW = 0.33;
const BENCH_MIN_EVIDENCE = 12;
export const SCORES_OBJECT = 'feed/scores.json';
const BUCKET = 'loro-catalog';
const OUT = path.join(REPO_ROOT, 'packages', 'core', 'src', 'catalog', 'videoScores.ts');

const publish = process.argv.includes('--publish');
loadEnv();
const db = getAdminClient();

type Entry = { id: string; youtubeId?: string; durationSeconds?: number; creator?: string; attribution?: { channelTitle?: string } };
const catalog: Entry[] = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data', 'embedVideos.json'), 'utf8'));
const byId = new Map<string, Entry>();
for (const v of catalog) {
  byId.set(v.id, v);
  if (v.youtubeId) byId.set(v.youtubeId, v);
}
const creatorOf = (v: Entry) => v.attribution?.channelTitle ?? v.creator ?? '?';

const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
const rows: { install_id: string; name: string; at: string; props: { videoId?: string }; build_profile: string | null }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('loro_analytics_events')
    .select('install_id,name,at,props,build_profile')
    .gte('at', since)
    .in('name', ['video_watched', 'word_saved'])
    .order('at')
    .range(from, from + 999);
  if (error) throw error;
  rows.push(...(data as typeof rows));
  if (data!.length < 1000) break;
}
const store = rows.filter((r) => r.build_profile !== 'development' && r.build_profile !== 'preview');

type Stats = { views: number; watch: number[]; skips: number; saves: number };
const blank = (): Stats => ({ views: 0, watch: [], skips: 0, saves: 0 });
const perVideo = new Map<string, Stats>();
const perCreator = new Map<string, Stats>();
const statFor = <K,>(m: Map<K, Stats>, k: K) => m.get(k) ?? m.set(k, blank()).get(k)!;

const byInstall = new Map<string, typeof rows>();
for (const r of store.filter((r) => r.name === 'video_watched')) {
  (byInstall.get(r.install_id) ?? byInstall.set(r.install_id, []).get(r.install_id)!).push(r);
}
for (const list of byInstall.values()) {
  for (let i = 0; i < list.length; i++) {
    const v = byId.get(list[i].props.videoId ?? '');
    if (!v) continue;
    const vs = statFor(perVideo, v.id);
    const cs = statFor(perCreator, creatorOf(v));
    vs.views++;
    cs.views++;
    const next = list[i + 1];
    if (!next) continue;
    const gap = (Date.parse(next.at) - Date.parse(list[i].at)) / 1000;
    if (gap >= MAX_GAP_S) continue;
    const share = Math.min(1, gap / Math.max(1, v.durationSeconds ?? 30));
    vs.watch.push(share);
    cs.watch.push(share);
    if (gap < SKIP_S) {
      vs.skips++;
      cs.skips++;
    }
  }
}
for (const r of store.filter((r) => r.name === 'word_saved')) {
  const v = byId.get(r.props.videoId ?? '');
  if (!v) continue;
  statFor(perVideo, v.id).saves++;
  statFor(perCreator, creatorOf(v)).saves++;
}

const engagement = (s: Stats): number | null => {
  if (s.watch.length === 0) return null;
  const watch = s.watch.reduce((a, b) => a + b, 0) / s.watch.length;
  const skip = s.skips / s.watch.length;
  const saves = Math.min(1, (3 * s.saves) / Math.max(1, s.views));
  return 0.6 * watch + 0.25 * (1 - skip) + 0.15 * saves;
};

const allStats = [...perVideo.values()].reduce((acc, s) => {
  acc.views += s.views;
  acc.watch.push(...s.watch);
  acc.skips += s.skips;
  acc.saves += s.saves;
  return acc;
}, blank());
const prior = engagement(allStats) ?? 0.5;

const creatorScore = new Map<string, number>();
for (const [name, s] of perCreator) {
  const e = engagement(s);
  const n = s.watch.length;
  creatorScore.set(name, e === null ? prior : (n * e + CREATOR_K * prior) / (n + CREATOR_K));
}

/** The short-first nudge, added to a video's score (see the header). */
function lengthBonus(seconds: number | undefined): number {
  if (seconds === undefined) return 0;
  if (seconds <= 20) return 0.25;
  if (seconds <= 35) return 0.22;
  if (seconds <= 45) return 0;
  if (seconds <= 60) return -0.08;
  return -0.15;
}

const scores: Record<string, number> = {};
const unboosted: Record<string, number> = {};
const benched: string[] = [];
for (const v of catalog) {
  const c = creatorOf(v);
  const base = creatorScore.get(c) ?? prior;
  const s = perVideo.get(v.id);
  const e = s ? engagement(s) : null;
  const n = s?.watch.length ?? 0;
  const score = e === null ? base : (n * e + VIDEO_K * base) / (n + VIDEO_K);
  // Every video gets a number now: with no evidence it is the prior, and
  // the length bonus still applies (a fresh short clip should come early).
  const boosted = Math.min(1, Math.max(0, score + lengthBonus(v.durationSeconds)));
  scores[v.id] = Math.round(boosted * 1000) / 1000;
  unboosted[v.id] = score;
  const evidence = (perCreator.get(c)?.watch.length ?? 0) + n;
  if (score < BENCH_BELOW && evidence >= BENCH_MIN_EVIDENCE) benched.push(v.id);
}

const out = {
  generatedAt: new Date().toISOString(),
  prior: Math.round(prior * 1000) / 1000,
  scores,
  benched,
};
writeFileSync(
  OUT,
  `/**\n * GENERATED by scripts/score-videos.mts — do not edit by hand. The feed's\n * built-in scores (core/feedRank.ts); the app refreshes them from\n * loro-catalog/${SCORES_OBJECT}.\n */\nexport const VIDEO_SCORES = ${JSON.stringify(out)};\n`
);

// A readable summary of what the feed will now do.
const ranked = [...creatorScore.entries()]
  .filter(([n]) => (perCreator.get(n)?.watch.length ?? 0) >= 8)
  .sort((a, b) => b[1] - a[1]);
console.log(`views ${allStats.views}, catalog ${catalog.length}, scored ${Object.keys(scores).length}, prior ${out.prior}`);
console.log(`benched ${benched.length} videos from ${new Set(benched.map((id) => creatorOf(byId.get(id)!))).size} creators`);
console.log('\ntop creators:   ' + ranked.slice(0, 6).map(([n, s]) => `${n} ${s.toFixed(2)}`).join(' · '));
console.log('bottom creators: ' + ranked.slice(-6).map(([n, s]) => `${n} ${s.toFixed(2)}`).join(' · '));

// What a fresh install's first 30 videos look like, with and without the bonus
// (the same weighted shuffle as core/feedRank, averaged over many shuffles).
const shareShort = (table: Record<string, number>): number => {
  const short = new Set(catalog.filter((v) => (v.durationSeconds ?? 99) <= 35).map((v) => v.id));
  const bench = new Set(benched);
  let hits = 0;
  const RUNS = 400;
  for (let r = 0; r < RUNS; r++) {
    const keyed = catalog
      .filter((v) => !bench.has(v.id))
      .map((v) => ({ id: v.id, k: Math.pow(Math.max(Number.EPSILON, Math.random()), 1 / Math.exp(4 * (table[v.id] ?? prior))) }))
      .sort((a, b) => b.k - a.k)
      .slice(0, 30);
    hits += keyed.filter((x) => short.has(x.id)).length;
  }
  return hits / (RUNS * 30);
};
console.log(`\nfirst 30 videos of a fresh install that are <=35s: ${(100 * shareShort(unboosted)).toFixed(0)}% before, ${(100 * shareShort(scores)).toFixed(0)}% now`);
console.log(`catalog <=35s: ${catalog.filter((v) => (v.durationSeconds ?? 99) <= 35).length} of ${catalog.length}`);

console.log(`\nwrote ${path.relative(REPO_ROOT, OUT)}`);

if (publish) {
  const { error } = await db.storage.from(BUCKET).upload(SCORES_OBJECT, Buffer.from(JSON.stringify(out), 'utf8'), {
    contentType: 'application/json',
    cacheControl: '3600',
    upsert: true,
  });
  if (error) {
    console.error(`\n✗ upload failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`published ${BUCKET}/${SCORES_OBJECT}`);
}
