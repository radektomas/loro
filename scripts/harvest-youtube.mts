#!/usr/bin/env node
/**
 * Loro — YouTube discovery harvest.
 *
 *   npm run harvest -- --plan          # zero-quota preview of the sweep
 *   npm run harvest -- --dry-run       # real API reads, writes nothing
 *   npm run harvest                    # harvest until the quota budget is spent
 *   npm run harvest -- --topic food --region MX --license cc --limit 4
 *
 * Walks a deterministic matrix of (Spanish query x region x license branch),
 * pulls short videos from the YouTube Data API v3, upserts them into
 * loro_video_candidates, and applies the eligibility filter. It is resumable:
 * a full sweep costs several days of quota, so each run picks up where the
 * last one stopped (loro_harvest_runs.cursor).
 *
 * Requires YOUTUBE_API_KEY and SUPABASE_SERVICE_ROLE_KEY in .env, and the
 * migration supabase/migrations/20260721000000_video_candidates.sql.
 *
 * Run directly — no build step, no TS runner. Node strips the types.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DAILY_QUOTA_UNITS,
  SWEPT_LICENSE_BRANCHES,
  QUOTA_BUDGET,
  QUOTA_COST,
  REGIONS,
  TOPICS,
  type LicenseBranch,
  type Region,
  type TopicSlug,
} from './config/harvest-queries.mts';
import { loadEnv, requireEnv } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import {
  CANDIDATES_TABLE,
  fetchEligibleCountsByChannel,
  mapVideoToCandidate,
  applyVerdict,
  upsertCandidates,
  type CandidateInsert,
} from './lib/candidates.mts';
import { filterCandidate, type RejectReason } from './lib/candidateFilter.mts';
import { recordPage, type PageObservation } from './lib/harvestPages.mts';
import {
  batchIds,
  listVideos,
  searchVideos,
  QuotaExceededError,
  QuotaMeter,
  type YouTubeVideo,
} from './lib/youtube.mts';
import {
  buildMatrix,
  checkpointRun,
  comboKey,
  describeCombo,
  fetchLastRun,
  finishRun,
  quotaSpentToday,
  resolveResumeIndex,
  startRun,
  type Combo,
  type HarvestCursor,
  type HarvestRunStatus,
} from './lib/harvestState.mts';

// ---------------------------------------------------------------------- CLI

type Options = {
  dryRun: boolean;
  plan: boolean;
  limit: number | null;
  topic: TopicSlug | null;
  region: Region | null;
  license: LicenseBranch | null;
};

const USAGE = `
Loro YouTube discovery harvest

  node scripts/harvest-youtube.mts [flags]

  --plan              Print the sweep plan and exit. No network, no writes,
                      no quota. Use this to see where the next run resumes.
  --dry-run           Call the API and run the filter, but write NOTHING to
                      the database. NOTE: this still spends real quota.
  --limit N           Process at most N combinations this run.
  --topic <slug>      ${TOPICS.map((t) => t.slug).join(', ')}
  --region <code>     ${REGIONS.join(', ')}
  --license cc|any    cc = Creative Commons only, any = both licenses.
  -h, --help          This message.

Selection flags (--topic/--region/--license) make the run EXPLORATORY: quota
is still recorded, but the sweep cursor is left untouched so an ad-hoc probe
never corrupts the resume point of the full sweep.
`;

function fail(message: string): never {
  console.error(`\n${message}\n${USAGE}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    dryRun: false,
    plan: false,
    limit: null,
    topic: null,
    region: null,
    license: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value.`);
      return value;
    };
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--plan':
        options.plan = true;
        break;
      case '--limit': {
        const value = Number(next());
        if (!Number.isInteger(value) || value <= 0) {
          fail('--limit needs a positive integer.');
        }
        options.limit = value;
        break;
      }
      case '--topic': {
        const value = next();
        const topic = TOPICS.find((t) => t.slug === value);
        if (!topic) fail(`Unknown topic "${value}".`);
        options.topic = topic.slug;
        break;
      }
      case '--region': {
        const value = next().toUpperCase();
        const region = REGIONS.find((r) => r === value);
        if (!region) fail(`Unknown region "${value}".`);
        options.region = region;
        break;
      }
      case '--license': {
        const value = next();
        // 'cc' is the shorthand the spec asks for; it maps to the API's
        // videoLicense=creativeCommon. The two vocabularies stay distinct.
        const license: LicenseBranch | null =
          value === 'cc' ? 'creativeCommon' : value === 'any' ? 'any' : null;
        if (!license) fail('--license takes "cc" or "any".');
        options.license = license;
        break;
      }
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        fail(`Unknown flag "${arg}".`);
    }
  }
  return options;
}

function isSelected(combo: Combo, options: Options): boolean {
  if (options.topic && combo.topic !== options.topic) return false;
  if (options.region && combo.region !== options.region) return false;
  if (options.license && combo.license !== options.license) return false;
  return true;
}

// ------------------------------------------------------------------- report

type RunStats = {
  combosProcessed: number;
  videosSeen: number;
  inserted: number;
  updated: number;
  eligible: number;
  rejected: number;
  /** Rows already past 'discovered' — left alone, counted for transparency. */
  untouched: number;
  rejectReasons: Map<string, number>;
  eligibleByLicense: Map<string, number>;
  eligibleByTopic: Map<string, number>;
  eligibleByRegion: Map<string, number>;
  /** One per search.list call — the pool-depth evidence. */
  pages: PageObservation[];
  /** Per query: videos seen and eligible. The top-ranked tuning lever. */
  seenByQuery: Map<string, number>;
  eligibleByQuery: Map<string, number>;
};

function emptyStats(): RunStats {
  return {
    combosProcessed: 0,
    videosSeen: 0,
    inserted: 0,
    updated: 0,
    eligible: 0,
    rejected: 0,
    untouched: 0,
    rejectReasons: new Map<string, number>(),
    eligibleByLicense: new Map<string, number>(),
    eligibleByTopic: new Map<string, number>(),
    eligibleByRegion: new Map<string, number>(),
    pages: [],
    seenByQuery: new Map<string, number>(),
    eligibleByQuery: new Map<string, number>(),
  };
}

/**
 * Statuses that count as a query having produced something useful: it passed
 * the filter, or it has already moved further down the pipeline.
 */
const PRODUCTIVE_STATUSES = new Set([
  'eligible',
  'processing',
  'ready',
  'published',
]);

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '  0.0%';
  return `${((part / whole) * 100).toFixed(1).padStart(5)}%`;
}

function section(title: string): void {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

function printSorted(map: Map<string, number>, total: number): void {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const [key, count] of entries) {
    console.log(
      `  ${padRight(key, 26)} ${String(count).padStart(5)}   ${percent(count, total)}`
    );
  }
}

/**
 * Table-wide totals. The point of the whole exercise: is there enough
 * Creative Commons material to make self-hosting the backbone of the feed,
 * or does the feed have to be built on embeds?
 */
type PoolTotals = {
  candidates: number;
  eligibleCc: number;
  eligibleYoutube: number;
  readyCc: number;
  readyYoutube: number;
};

async function fetchPoolTotals(
  supabase: SupabaseClient
): Promise<PoolTotals | null> {
  // head:true + count:'exact' asks Postgres for the count only — no rows
  // cross the wire, so this stays cheap as the table grows.
  const base = () =>
    supabase.from(CANDIDATES_TABLE).select('*', { count: 'exact', head: true });

  try {
    const [all, eligibleCc, eligibleYt, readyCc, readyYt] = await Promise.all([
      base(),
      base().eq('status', 'eligible').eq('license', 'creativeCommon'),
      base().eq('status', 'eligible').eq('license', 'youtube'),
      base().in('status', ['ready', 'published']).eq('license', 'creativeCommon'),
      base().in('status', ['ready', 'published']).eq('license', 'youtube'),
    ]);
    for (const result of [all, eligibleCc, eligibleYt, readyCc, readyYt]) {
      if (result.error) throw new Error(result.error.message);
    }
    return {
      candidates: all.count ?? 0,
      eligibleCc: eligibleCc.count ?? 0,
      eligibleYoutube: eligibleYt.count ?? 0,
      readyCc: readyCc.count ?? 0,
      readyYoutube: readyYt.count ?? 0,
    };
  } catch (error) {
    console.warn(
      `  ! could not read pool totals: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

function printReport(
  stats: RunStats,
  meter: QuotaMeter,
  totals: PoolTotals | null,
  options: Options,
  outcome: string
): void {
  console.log('\n' + '='.repeat(64));
  console.log('HARVEST REPORT');
  console.log('='.repeat(64));
  if (options.dryRun) {
    console.log('DRY RUN — nothing was written to the database.');
  }
  console.log(`Outcome: ${outcome}`);

  section('Rows');
  console.log(`  combinations processed   ${stats.combosProcessed}`);
  console.log(`  videos seen              ${stats.videosSeen}`);
  console.log(`  new rows                 ${stats.inserted}`);
  console.log(`  updated rows             ${stats.updated}`);
  if (stats.untouched > 0) {
    console.log(
      `  left alone               ${stats.untouched}  (already past 'discovered')`
    );
  }

  const judged = stats.eligible + stats.rejected;
  section('Eligibility');
  console.log(
    `  eligible                 ${String(stats.eligible).padStart(5)}   ${percent(stats.eligible, judged)}`
  );
  console.log(
    `  rejected                 ${String(stats.rejected).padStart(5)}   ${percent(stats.rejected, judged)}`
  );

  section('Top rejection reasons');
  printSorted(stats.rejectReasons, stats.rejected);

  // The headline number. CC and standard-licence videos are NEVER pooled:
  // one may be self-hosted, the other may only ever be embedded.
  section('Eligible by license  (CC = self-hostable, youtube = embed only)');
  const cc = stats.eligibleByLicense.get('creativeCommon') ?? 0;
  const yt = stats.eligibleByLicense.get('youtube') ?? 0;
  console.log(
    `  creativeCommon           ${String(cc).padStart(5)}   ${percent(cc, stats.eligible)}   may be downloaded & self-hosted`
  );
  console.log(
    `  youtube                  ${String(yt).padStart(5)}   ${percent(yt, stats.eligible)}   official iframe embed ONLY`
  );

  section('Eligible by topic');
  printSorted(stats.eligibleByTopic, stats.eligible);

  section('Eligible by region');
  printSorted(stats.eligibleByRegion, stats.eligible);

  // Per-query yield: the highest-ranked tuning lever. A query that returns 50
  // videos and 2 eligible is costing a full 100 units for almost nothing, and
  // without this it stays invisible until someone audits the whole table.
  section('Eligible yield per query  (the tuning lever)');
  const queries = new Set([...stats.seenByQuery.keys(), ...stats.eligibleByQuery.keys()]);
  if (queries.size === 0) {
    console.log('  (none)');
  } else {
    const ranked = [...queries]
      .map((q) => {
        const seen = stats.seenByQuery.get(q) ?? 0;
        const elig = stats.eligibleByQuery.get(q) ?? 0;
        return { q, seen, elig, rate: seen > 0 ? elig / seen : 0 };
      })
      .sort((a, b) => b.rate - a.rate);
    console.log(`  ${padRight('query', 44)}${'seen'.padStart(5)}${'elig'.padStart(6)}   yield`);
    for (const r of ranked) {
      console.log(
        `  ${padRight(r.q, 44)}${String(r.seen).padStart(5)}${String(r.elig).padStart(6)}   ${percent(r.elig, r.seen)}`
      );
    }
  }

  // Is one page per combination enough? nextPageToken answers it directly,
  // and it came free with a response we already paid 100 units for.
  section('Pagination — is the pool exhausted at one page?');
  if (stats.pages.length === 0) {
    console.log('  (no searches made)');
  } else {
    for (const page of stats.pages) {
      console.log(
        `  ${padRight(`${page.topic}/${page.region}/${page.licenseBranch}`, 34)}` +
          `p${page.pageIndex} ${String(page.resultCount).padStart(3)} ids   ` +
          `more: ${page.nextPageToken ? 'YES' : 'no '}   ~${page.totalResults ?? '?'} total`
      );
    }
    const withMore = stats.pages.filter((p) => p.nextPageToken !== null).length;
    console.log(
      `\n  ${withMore}/${stats.pages.length} searches have further pages available` +
        ` — ${percent(withMore, stats.pages.length)} of the queries probed are NOT exhausted.`
    );
  }

  section('Quota');
  console.log(
    `  search.list calls        ${String(meter.searchCalls).padStart(5)} x ${QUOTA_COST.search} = ${meter.searchCalls * QUOTA_COST.search}`
  );
  console.log(
    `  videos.list calls        ${String(meter.videoCalls).padStart(5)} x ${QUOTA_COST.videos} = ${meter.videoCalls * QUOTA_COST.videos}`
  );
  console.log(`  total spent              ${meter.spent} / ${meter.budget}`);

  if (totals) {
    section('Candidate pool (whole table)');
    console.log(`  candidates total         ${totals.candidates}`);
    console.log(`  eligible  CC / youtube   ${totals.eligibleCc} / ${totals.eligibleYoutube}`);
    console.log(`  ready+published CC / yt  ${totals.readyCc} / ${totals.readyYoutube}`);
    const pool = totals.eligibleCc + totals.eligibleYoutube;
    if (pool > 0) {
      console.log(
        `\n  ${percent(totals.eligibleCc, pool)} of the eligible pool is Creative Commons —` +
          ` that share is the self-host-vs-embed answer.`
      );
    }
  }
  console.log('');
}

// ------------------------------------------------------------- the harvest

/** Everything one combo produced, before anything is written. */
type ComboHarvest = {
  candidates: CandidateInsert[];
  nextPageToken: string | null;
  /** True when the combo could not be finished (quota ran out mid-combo). */
  incomplete: boolean;
  /** One entry per search.list call actually made. */
  pages: PageObservation[];
};

async function harvestCombo(
  combo: Combo,
  pageToken: string | null,
  apiKey: string,
  meter: QuotaMeter,
  onPage: (observation: PageObservation) => Promise<void>
): Promise<ComboHarvest> {
  const candidates: CandidateInsert[] = [];
  const pages: PageObservation[] = [];
  let token: string | null = pageToken;
  let incomplete = false;

  for (let page = 0; page < combo.pages; page++) {
    if (!meter.canAfford('search')) {
      incomplete = true;
      break;
    }
    const requestToken = token;
    const search = await searchVideos(
      {
        query: combo.query,
        region: combo.region,
        license: combo.license,
        pageToken: requestToken ?? undefined,
      },
      apiKey
    );
    meter.charge('search');

    const ids = (search.items ?? [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    // Free depth signal: it arrived with a response we already paid for.
    const observation: PageObservation = {
      topic: combo.topic,
      query: combo.query,
      region: combo.region,
      licenseBranch: combo.license,
      pageIndex: page,
      requestPageToken: requestToken,
      nextPageToken: search.nextPageToken ?? null,
      resultCount: ids.length,
      totalResults: search.pageInfo?.totalResults ?? null,
    };
    pages.push(observation);
    await onPage(observation);

    console.log(
      `    page ${page} -> ${String(ids.length).padStart(2)} ids   ` +
        `next page: ${observation.nextPageToken ? 'YES' : 'no '}   ` +
        `(totalResults~${observation.totalResults ?? '?'}, quota ${meter.spent}/${meter.budget})`
    );

    // Batched 50 at a time: videos.list costs 1 unit per CALL regardless of
    // how many ids it carries, so per-video calls would cost 50x for nothing.
    for (const batch of batchIds(ids)) {
      if (!meter.canAfford('videos')) {
        incomplete = true;
        break;
      }
      const videos: YouTubeVideo[] = await listVideos(batch, apiKey);
      meter.charge('videos');
      for (const video of videos) {
        const candidate = mapVideoToCandidate({
          video,
          regionHint: combo.region,
          topicTags: combo.tags,
          sourceQuery: combo.query,
          source: 'query',
        });
        if (candidate) candidates.push(candidate);
      }
    }

    token = search.nextPageToken ?? null;
    if (incomplete || !token) break;
  }

  return { candidates, nextPageToken: token, incomplete, pages };
}

/**
 * Write a combo's candidates and judge the ones still sitting at 'discovered'.
 *
 * Rows that already moved past 'discovered' (processing / ready / published,
 * or a previous 'rejected'/'eligible' verdict) are NOT re-judged: their status
 * is pipeline state and re-harvesting must never reset it. Re-running the
 * filter over the existing table after tuning thresholds is a separate job.
 */
async function persistAndJudge(
  supabase: SupabaseClient,
  candidates: readonly CandidateInsert[],
  combo: Combo,
  channelCounts: Map<string, number>,
  stats: RunStats,
  options: Options
): Promise<void> {
  if (candidates.length === 0) return;
  bump(stats.seenByQuery, `${combo.topic} | ${combo.query}`, candidates.length);

  if (options.dryRun) {
    // Judge in memory so the report is real, but touch nothing. A
    // CandidateInsert already carries every column the filter reads.
    for (const candidate of candidates) {
      const verdict = filterCandidate(candidate, {
        eligibleCountsByChannel: channelCounts,
      });
      recordVerdict(
        verdict.eligible,
        verdict.reason ?? null,
        candidate,
        combo,
        channelCounts,
        stats
      );
    }
    return;
  }

  const { inserted, updated, rows } = await upsertCandidates(
    supabase,
    candidates
  );
  stats.inserted += inserted;
  stats.updated += updated;

  for (const candidate of candidates) {
    const row = rows.get(candidate.youtube_id);
    if (!row) continue;
    if (row.status !== 'discovered') {
      stats.untouched += 1;
      // Still counts toward this QUERY's yield. The row's verdict is not
      // re-decided (that is the idempotency invariant), but the query really
      // did return a video whose status we know — and per-query yield must
      // reflect every video the query surfaced, not just the ones that
      // happened to be new this run. Otherwise re-harvesting an established
      // combination reports 0% and a perfectly good query looks worthless.
      if (PRODUCTIVE_STATUSES.has(row.status)) {
        bump(stats.eligibleByQuery, `${combo.topic} | ${combo.query}`);
      }
      continue;
    }
    const verdict = filterCandidate(row, {
      eligibleCountsByChannel: channelCounts,
    });
    await applyVerdict(
      supabase,
      row.youtube_id,
      verdict.eligible ? 'eligible' : 'rejected',
      verdict.eligible ? null : (verdict.reason ?? null)
    );
    recordVerdict(
      verdict.eligible,
      verdict.reason ?? null,
      row,
      combo,
      channelCounts,
      stats
    );
  }
}

function recordVerdict(
  eligible: boolean,
  reason: RejectReason | null,
  candidate: Pick<CandidateInsert, 'channel_id' | 'license'>,
  combo: Combo,
  channelCounts: Map<string, number>,
  stats: RunStats
): void {
  if (!eligible) {
    stats.rejected += 1;
    bump(stats.rejectReasons, reason ?? 'unknown');
    return;
  }
  stats.eligible += 1;
  // Keep the diversity filter honest WITHIN a run: without this, a single
  // channel could contribute 50 eligible videos in one pass because the
  // counts were read once at startup.
  if (candidate.channel_id) bump(channelCounts, candidate.channel_id);
  bump(stats.eligibleByLicense, candidate.license ?? 'unknown');
  bump(stats.eligibleByTopic, combo.topic);
  bump(stats.eligibleByRegion, combo.region);
  bump(stats.eligibleByQuery, `${combo.topic} | ${combo.query}`);
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadEnv();

  const matrix = buildMatrix();
  const selectedCount = matrix.filter((c) => isSelected(c, options)).length;
  const exploratory = Boolean(options.topic || options.region || options.license);

  // ---- plan mode: zero network, zero quota, zero writes -------------------
  if (options.plan) {
    const supabase = getAdminClient();
    const lastRun = await fetchLastRun(supabase);
    const resume = resolveResumeIndex(lastRun?.cursor ?? null, matrix);
    const spentToday = await quotaSpentToday(supabase);
    console.log(`\nMatrix: ${matrix.length} combinations`);
    console.log(
      `  ${TOPICS.length} topics x ${TOPICS.reduce((n, t) => n + t.queries.length, 0)} queries total` +
        ` — regions per topic, ${SWEPT_LICENSE_BRANCHES.length} license branch (CC only)`
    );
    console.log(`Selected by flags: ${selectedCount}`);
    if (resume.note) console.log(`Cursor: ${resume.note}`);
    console.log(
      `Resume at #${resume.index}: ${matrix[resume.index] ? describeCombo(matrix[resume.index]) : '(end of sweep — next run restarts)'}`
    );
    console.log(`Quota spent today: ${spentToday} / ${DAILY_QUOTA_UNITS}`);
    console.log(
      `A full sweep costs ~${matrix.length * QUOTA_COST.search} units` +
        ` (~${Math.ceil((matrix.length * QUOTA_COST.search) / DAILY_QUOTA_UNITS)} days at the default cap).\n`
    );
    return;
  }

  const apiKey = requireEnv('YOUTUBE_API_KEY');
  const supabase = getAdminClient();

  // ---- budget ------------------------------------------------------------
  // Two ceilings: this run's configured budget, and whatever is left of the
  // day's real allowance after earlier runs. The lower one wins.
  const spentToday = await quotaSpentToday(supabase);
  const dailyRemaining = Math.max(0, DAILY_QUOTA_UNITS - spentToday);
  const budget = Math.min(QUOTA_BUDGET, dailyRemaining);
  const meter = new QuotaMeter(budget);

  console.log(`\nLoro YouTube harvest${options.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(
    `  quota: ${spentToday} spent today, ${dailyRemaining} left of ${DAILY_QUOTA_UNITS}; this run may spend ${budget}`
  );
  if (options.dryRun) {
    console.log('  DRY RUN writes nothing — but API reads still cost quota.');
  }

  if (!meter.canAfford('search')) {
    console.log(
      '\nNot enough quota left today for a single search. Try again after midnight Pacific.\n'
    );
    return;
  }

  const lastRun = await fetchLastRun(supabase);
  const resume = resolveResumeIndex(lastRun?.cursor ?? null, matrix);
  if (resume.note) console.log(`  ${resume.note}`);
  if (exploratory) {
    console.log(
      '  exploratory run (selection flags set) — the sweep cursor will NOT be moved'
    );
  }

  const channelCounts = await fetchEligibleCountsByChannel(supabase);
  const stats = emptyStats();

  // The run row exists even for a dry run: quota was really spent, and quota
  // accounting that ignores dry runs would let two dry runs blow the daily cap.
  const run = await startRun(supabase);

  let cursor: HarvestCursor = {
    comboIndex: resume.index,
    comboKey: matrix[resume.index] ? comboKey(matrix[resume.index]) : '',
    pageToken: resume.pageToken,
  };
  let outcome = 'sweep complete — the next run restarts from the top';
  let status: HarvestRunStatus = 'completed';
  let runError: string | null = null;

  // Ctrl-C mid-run must still leave a usable resume point.
  let interrupted = false;
  const onSigint = (): void => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log('\n  interrupt received — finishing the current combination…');
  };
  process.on('SIGINT', onSigint);

  try {
    for (let i = resume.index; i < matrix.length; i++) {
      const combo = matrix[i];
      // The cursor always points at the combo about to be attempted, so an
      // abort here resumes exactly at this one and nothing is skipped.
      cursor = { comboIndex: i, comboKey: comboKey(combo), pageToken: null };

      if (!isSelected(combo, options)) continue;

      if (interrupted) {
        outcome = 'interrupted — resume point saved';
        status = 'completed';
        break;
      }
      if (options.limit !== null && stats.combosProcessed >= options.limit) {
        outcome = `--limit ${options.limit} reached`;
        break;
      }
      if (!meter.canAfford('search')) {
        outcome = 'quota budget reached — resume point saved';
        status = 'quota_exhausted';
        break;
      }

      console.log(
        `\n[${i + 1}/${matrix.length}] ${describeCombo(combo)}`
      );

      const harvested = await harvestCombo(
        combo,
        i === resume.index ? resume.pageToken : null,
        apiKey,
        meter,
        async (observation) => {
          stats.pages.push(observation);
          // A dry run must not write, but it still logs the depth signal.
          if (!options.dryRun) await recordPage(supabase, run.id, observation);
        }
      );
      stats.videosSeen += harvested.candidates.length;

      await persistAndJudge(
        supabase,
        harvested.candidates,
        combo,
        channelCounts,
        stats,
        options
      );
      stats.combosProcessed += 1;

      if (harvested.incomplete) {
        // Stopped inside the combo — leave the cursor ON it so the remainder
        // is picked up next run. Writes already made are idempotent.
        outcome = 'quota budget reached mid-combination — resume point saved';
        status = 'quota_exhausted';
        break;
      }

      // Combo finished: advance past it.
      const nextIndex = i + 1;
      cursor = {
        comboIndex: nextIndex,
        comboKey: matrix[nextIndex] ? comboKey(matrix[nextIndex]) : '',
        pageToken: null,
      };
      if (!exploratory) {
        await checkpointRun(supabase, run.id, meter.spent, cursor);
      }
    }
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      // Google says the day is over. Not an error — the same clean stop as
      // hitting our own budget, with the cursor intact.
      outcome = `daily quota exhausted at Google — ${error.message}`;
      status = 'quota_exhausted';
    } else {
      status = 'failed';
      runError = error instanceof Error ? error.message : String(error);
      outcome = `FAILED — ${runError}`;
    }
  } finally {
    process.off('SIGINT', onSigint);
  }

  const totals = await fetchPoolTotals(supabase);

  await finishRun(supabase, run.id, {
    status,
    quotaSpent: meter.spent,
    // An exploratory run must not move the sweep's resume point, so it
    // re-saves the cursor it inherited rather than its own position.
    cursor: exploratory ? (lastRun?.cursor ?? null) : cursor,
    stats: {
      combosProcessed: stats.combosProcessed,
      videosSeen: stats.videosSeen,
      inserted: stats.inserted,
      updated: stats.updated,
      eligible: stats.eligible,
      rejected: stats.rejected,
      rejectReasons: Object.fromEntries(stats.rejectReasons),
      eligibleByLicense: Object.fromEntries(stats.eligibleByLicense),
      eligibleByTopic: Object.fromEntries(stats.eligibleByTopic),
      eligibleByRegion: Object.fromEntries(stats.eligibleByRegion),
      seenByQuery: Object.fromEntries(stats.seenByQuery),
      eligibleByQuery: Object.fromEntries(stats.eligibleByQuery),
      dryRun: options.dryRun,
      exploratory,
    },
    error: runError,
  });

  printReport(stats, meter, totals, options, outcome);
  if (status === 'failed') process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
