#!/usr/bin/env node
/**
 * Loro — publish YouTube-embed videos into the feed.
 *
 *   npm run publish-embeds -- --dry-run          # plan only, writes nothing
 *   npm run publish-embeds -- --limit 12         # publish up to 12 videos
 *   npm run publish-embeds -- --ids rnY8kn2rqDA  # exactly these candidates
 *
 * For each eligible candidate: fetch its Spanish caption track (word-timed
 * ASR), convert to Loro cues, translate + gloss with OpenAI, and append the
 * finished entry to data/embedVideos.json — which ships with the app; the
 * feed picks it up on the next dev reload or deploy. The candidate row moves
 * to 'published'. No media is ever downloaded and no storage is touched:
 * playback is the official iframe embed.
 *
 * RUN THIS ON YOUR OWN MACHINE (it is a manual curation step, not CI): the
 * caption fetch behaves like a browser loading the watch page and belongs on
 * a residential connection. No YouTube API key needed — playback and captions cost zero
 * quota. Needs OPENAI_API_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.
 *
 * Crash-safe: the JSON file is rewritten after EVERY video, so an interrupt
 * loses at most the video in flight. Idempotent: already-published ids are
 * skipped; re-running with the same ids refreshes them in place.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from './lib/env.mts';
import { REPO_ROOT } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE, type CandidateRow } from './lib/candidates.mts';
import {
  CAPTION_FETCH_DELAY_MS,
  fetchCaptions,
  NoCaptionsError,
} from './lib/captionFetch.mts';
import { json3ToCues, type CueOut } from './lib/json3ToCues.mts';
import { estimateLevel } from './lib/estimateLevel.mts';
import { curationScore } from './config/curation.mts';
import { glossWords, translateCues, type GlossOut } from './lib/glossCues.mts';
import { sleep } from './lib/youtube.mts';

const EMBEDS_PATH = path.join(REPO_ROOT, 'data', 'embedVideos.json');

// ------------------------------------------------------------ batch tuning

/** Source diversity within one publish batch. */
const BATCH_MAX_PER_CHANNEL = 2;
/** Candidate quality floor for auto-selection (explicit --ids bypasses). */
const MIN_VIEWS = 5_000;
const MIN_SECONDS = 20;
const MAX_SECONDS = 75;
/** A transcript with fewer words than this is a slideshow, not speech. */
const MIN_WORDS = 15;

type EmbedEntry = {
  id: string;
  youtubeId: string;
  creator: string;
  level: string;
  durationSeconds: number;
  thumbnailUrl: string;
  attribution: {
    channelTitle: string;
    channelUrl: string;
    videoUrl: string;
    license: 'creativeCommon' | 'youtube';
  };
  cues: CueOut[];
  dictionary: Record<string, GlossOut>;
};

type Options = {
  dryRun: boolean;
  limit: number;
  ids: string[] | null;
  license: 'creativeCommon' | 'youtube' | 'both';
  /** Restrict to these difficulty_level values; null means any. */
  levels: string[] | null;
};

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    dryRun: false,
    limit: 8,
    ids: null,
    license: 'both',
    levels: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`${arg} needs a value`);
        process.exit(1);
      }
      return v;
    };
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--limit':
        options.limit = Number(next());
        break;
      case '--ids':
        options.ids = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--level':
        // Publish only these difficulty levels, e.g. --level A1,A2. Requires
        // rate-candidates to have run; unrated rows are excluded rather than
        // guessed at, so a typo yields an empty batch instead of a wrong one.
        options.levels = next()
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        break;
      case '--license': {
        const v = next();
        options.license =
          v === 'cc' ? 'creativeCommon' : v === 'any' ? 'both' : 'youtube';
        break;
      }
      default:
        console.error(`Unknown flag "${arg}". Flags: --dry-run --limit N --ids a,b --license cc|yt|any --level A1,A2`);
        process.exit(1);
    }
  }
  return options;
}

function loadEmbeds(): EmbedEntry[] {
  let raw: string;
  try {
    raw = readFileSync(EMBEDS_PATH, 'utf8');
  } catch (err) {
    // Only a genuinely missing file means "no embeds yet".
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  // A parse failure must ABORT, never be treated as an empty library: the
  // one process that writes this file also reads it, and swallowing a
  // truncated file here would let the next publish overwrite the entire
  // published catalog with a single entry. (Found in review — the original
  // bare catch was exactly that data-loss chain.)
  return JSON.parse(raw) as EmbedEntry[];
}

function saveEmbeds(entries: EmbedEntry[]): void {
  // Atomic: write a sibling temp file, then rename. A crash mid-write leaves
  // the old file intact instead of a truncated one.
  const tmp = `${EMBEDS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2) + '\n');
  renameSync(tmp, EMBEDS_PATH);
}

/**
 * Definitive caption absence — a fact about the VIDEO, safe to persist.
 * Deliberately narrow: "no captionTracks in player config" is NOT here,
 * because a bot-check interstitial or a page-format change produces exactly
 * that message for every video at once — persisting it would mass-reject
 * good candidates. Those cases skip as transient and retry next run.
 */
function isDefinitiveNoCaptions(err: NoCaptionsError): boolean {
  return (
    err.message.includes('none Spanish') ||
    err.message.includes('empty caption payload')
  );
}

async function selectCandidates(
  supabase: SupabaseClient,
  options: Options,
  alreadyPublished: ReadonlySet<string>
): Promise<CandidateRow[]> {
  if (options.ids) {
    const { data, error } = await supabase
      .from(CANDIDATES_TABLE)
      .select('*')
      .in('youtube_id', options.ids);
    if (error) throw new Error(error.message);
    return (data ?? []) as CandidateRow[];
  }
  const { data, error } = await supabase
    .from(CANDIDATES_TABLE)
    .select('*')
    .eq('status', 'eligible')
    .gte('duration_seconds', MIN_SECONDS)
    .lte('duration_seconds', MAX_SECONDS)
    .gte('view_count', MIN_VIEWS)
    .order('view_count', { ascending: false })
    .limit(400);
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as CandidateRow[];

  if (options.license !== 'both') {
    rows = rows.filter((r) => r.license === options.license);
  }
  // Declared audio language must be Spanish or unstated (the es ASR track is
  // the real proof either way).
  rows = rows.filter(
    (r) => !r.default_audio_language || r.default_audio_language.startsWith('es')
  );
  rows = rows.filter((r) => !alreadyPublished.has(r.youtube_id));

  if (options.levels) {
    const wanted = new Set(options.levels);
    // Unrated rows are dropped, not guessed at — run rate-candidates first.
    rows = rows.filter(
      (r) => r.difficulty_level && wanted.has(r.difficulty_level.toUpperCase())
    );
  }

  // Curation: drop what is not a person speaking, and rank what is left by
  // how likely it is to be one. Views are a floor inside curationScore, NOT
  // the sort key — sorting by views selects for "viral short-form format",
  // which in Spanish means gaming and kid animation.
  const scored = rows
    .map((row) => ({ row, verdict: curationScore(row) }))
    .filter((s) => s.verdict.score >= 0);

  // CC first (the strategically valuable branch), then curation tier, then
  // audience size only as a tie-break within a tier.
  scored.sort((a, b) => {
    const ccA = a.row.license === 'creativeCommon' ? 0 : 1;
    const ccB = b.row.license === 'creativeCommon' ? 0 : 1;
    if (ccA !== ccB) return ccA - ccB;
    if (a.verdict.score !== b.verdict.score) return b.verdict.score - a.verdict.score;
    return (b.row.view_count ?? 0) - (a.row.view_count ?? 0);
  });
  rows = scored.map((s) => s.row);

  // Batch-level source diversity.
  const perChannel = new Map<string, number>();
  const picked: CandidateRow[] = [];
  for (const row of rows) {
    const channel = row.channel_id ?? row.youtube_id;
    const n = perChannel.get(channel) ?? 0;
    if (n >= BATCH_MAX_PER_CHANNEL) continue;
    perChannel.set(channel, n + 1);
    picked.push(row);
    if (picked.length >= options.limit) break;
  }
  return picked;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadEnv();
  const supabase = getAdminClient();

  const embeds = loadEmbeds();
  const published = new Set(embeds.map((e) => e.youtubeId));
  const candidates = await selectCandidates(supabase, options, published);

  console.log(`\nLoro embed publisher${options.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  ${embeds.length} already published, ${candidates.length} candidate(s) selected\n`);
  if (candidates.length === 0) {
    console.log('Nothing to do.\n');
    return;
  }

  const stats = { published: 0, noCaptions: 0, thin: 0, skipped: 0, failed: 0 };

  for (const candidate of candidates) {
    const id = candidate.youtube_id;
    const label = `${candidate.channel_title ?? '?'} — "${(candidate.title ?? '').slice(0, 48)}"`;
    console.log(`▶ ${id}  ${label}`);
    console.log(`   license=${candidate.license}  ${candidate.duration_seconds}s  ${candidate.view_count} views`);

    if (options.dryRun) {
      console.log('   (dry run — would fetch captions, gloss, publish)\n');
      continue;
    }

    try {
      const { json3, track } = await fetchCaptions(id);
      const cues = json3ToCues(json3);
      const wordCount = cues.reduce((n, c) => n + c.words.length, 0);
      console.log(`   captions: ${track.languageCode}/${track.kind || 'uploaded'} -> ${cues.length} cues, ${wordCount} words`);

      if (wordCount < MIN_WORDS) {
        stats.thin += 1;
        const { error: thinErr } = await supabase
          .from(CANDIDATES_TABLE)
          .update({ status: 'rejected', reject_reason: 'captions_too_thin' })
          .eq('youtube_id', id);
        if (thinErr) console.warn(`   ! status write failed: ${thinErr.message}`);
        console.log('   ✗ too little speech — rejected (captions_too_thin)\n');
        continue;
      }

      const videoName = candidate.title ?? id;
      await translateCues(cues, videoName);
      const dictionary = await glossWords(cues, videoName);
      console.log(`   glossed: ${Object.keys(dictionary).length} dictionary entries`);

      const entry: EmbedEntry = {
        id,
        youtubeId: id,
        creator: candidate.channel_title ?? 'YouTube creator',
        level: estimateLevel(cues),
        durationSeconds: candidate.duration_seconds ?? 0,
        thumbnailUrl: candidate.thumbnail_url ?? '',
        attribution: {
          channelTitle: candidate.channel_title ?? 'YouTube creator',
          channelUrl: `https://www.youtube.com/channel/${candidate.channel_id ?? ''}`,
          videoUrl: `https://www.youtube.com/watch?v=${id}`,
          license: candidate.license ?? 'youtube',
        },
        cues,
        dictionary,
      };

      // Crash-safe: rewrite the file after every video.
      const existing = embeds.findIndex((e) => e.id === entry.id);
      if (existing >= 0) embeds[existing] = entry;
      else embeds.push(entry);
      saveEmbeds(embeds);

      const { error: pubErr } = await supabase
        .from(CANDIDATES_TABLE)
        .update({ status: 'published', detected_language: track.languageCode })
        .eq('youtube_id', id);
      if (pubErr) console.warn(`   ! status write failed (row stays eligible): ${pubErr.message}`);

      stats.published += 1;
      console.log('   ✓ published\n');
    } catch (error) {
      if (error instanceof NoCaptionsError && isDefinitiveNoCaptions(error)) {
        stats.noCaptions += 1;
        const { error: ncErr } = await supabase
          .from(CANDIDATES_TABLE)
          .update({ status: 'rejected', reject_reason: 'no_captions' })
          .eq('youtube_id', id);
        if (ncErr) console.warn(`   ! status write failed: ${ncErr.message}`);
        console.log(`   ✗ ${error.message} — rejected (no_captions)\n`);
      } else {
        // Transient (network, consent wall, OpenAI hiccup): skip, no verdict.
        stats.failed += 1;
        console.log(`   ! skipped (transient): ${error instanceof Error ? error.message : error}\n`);
      }
    }

    await sleep(CAPTION_FETCH_DELAY_MS);
  }

  console.log('='.repeat(56));
  console.log(`published ${stats.published}   no_captions ${stats.noCaptions}   too_thin ${stats.thin}   transient-skips ${stats.failed}`);
  console.log(`data/embedVideos.json now holds ${embeds.length} video(s).`);
  if (stats.published > 0) {
    console.log('\nThe feed picks these up on the next `npm run dev` reload or deploy.');
  }
  console.log('');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
