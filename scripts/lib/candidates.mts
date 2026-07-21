import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bestThumbnail,
  parseCount,
  parseIsoDuration,
  type YouTubeVideo,
} from './youtube.mts';
import type { StoredLicense } from '../config/harvest-queries.mts';

/**
 * The loro_video_candidates row: shape, mapping from the API, and upsert.
 *
 * Column names stay snake_case here (this is the data layer, same convention
 * as lib/creators.ts) — nothing in this file is consumed by React.
 */

export const CANDIDATES_TABLE = 'loro_video_candidates';
export const HARVEST_RUNS_TABLE = 'loro_harvest_runs';

export type CandidateStatus =
  | 'discovered'
  | 'eligible'
  | 'rejected'
  | 'processing'
  | 'ready'
  | 'published';

export type CandidateRow = {
  id: string;
  youtube_id: string;
  title: string | null;
  description: string | null;
  channel_id: string | null;
  channel_title: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  view_count: number | null;
  like_count: number | null;
  license: StoredLicense | null;
  is_embeddable: boolean | null;
  default_audio_language: string | null;
  detected_language: string | null;
  category_id: string | null;
  region_hint: string | null;
  topic_tags: string[];
  /** Every search query that returned this video, unioned across harvests. */
  source_queries: string[];
  /** How it was found: 'query' | 'channel'. Array — both can be true. */
  discovery_sources: string[];
  thumbnail_url: string | null;
  status: CandidateStatus;
  reject_reason: string | null;
  difficulty_level: string | null;
  discovered_at: string;
  updated_at: string;
};

/** What the harvester writes. No id/timestamps — the database owns those. */
export type CandidateInsert = Omit<
  CandidateRow,
  'id' | 'discovered_at' | 'updated_at' | 'detected_language' | 'difficulty_level'
>;

/** Descriptions run to thousands of characters of hashtags and links. */
const MAX_DESCRIPTION_CHARS = 1_000;

/**
 * Lone UTF-16 surrogates: a high surrogate not followed by a low one, or a low
 * not preceded by a high. Postgres rejects these outright, failing the whole
 * INSERT with "invalid input syntax for type json".
 */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Truncate to a character budget WITHOUT splitting an emoji, then scrub
 * anything Postgres cannot store.
 *
 * Learned the hard way: a plain `.slice(0, 1000)` cuts on UTF-16 code units,
 * so a description with an emoji straddling the boundary leaves a lone
 * surrogate. JSON.stringify emits it as a \udXXX escape and the batch insert
 * dies with "invalid input syntax for type json" — which killed a sweep 51
 * combinations in. Emoji are near-universal in YouTube descriptions, so this
 * was never an edge case.
 *
 * Array.from iterates by CODE POINT, so surrogate pairs stay intact. The regex
 * pass also catches lone surrogates already present in the source, and NUL is
 * stripped because Postgres text cannot hold it at all.
 */
export function sanitizeText(
  value: string | null | undefined,
  maxChars = Infinity
): string | null {
  if (value === null || value === undefined) return null;
  const points = Array.from(value);
  const truncated =
    points.length > maxChars ? points.slice(0, maxChars).join('') : value;
  return truncated.replace(LONE_SURROGATE, '').replace(/\u0000/g, '');
}

/**
 * The stored license, or null when the API did not tell us.
 *
 * Null is NOT a default of convenience: a row whose reuse rights are unknown
 * must never be treated as embeddable-or-downloadable by guesswork. The
 * filter rejects it explicitly. Only the two exact API values are accepted —
 * an unrecognised string is treated as unknown rather than coerced.
 */
export function toStoredLicense(raw: string | undefined): StoredLicense | null {
  if (raw === 'creativeCommon') return 'creativeCommon';
  if (raw === 'youtube') return 'youtube';
  return null;
}

/** How a candidate reached us. Kept distinct so the two can be compared. */
export type DiscoverySource = 'query' | 'channel';

export type MapArgs = {
  video: YouTubeVideo;
  regionHint: string;
  topicTags: readonly string[];
  /** The search query that surfaced it (absent for channel-seeded rows). */
  sourceQuery?: string;
  source?: DiscoverySource;
};

/**
 * YouTube API video -> candidate row. Returns null when the video has no id,
 * which the API does occasionally return for deleted-mid-flight results.
 * Everything else degrades to null rather than throwing: the filter is what
 * decides whether a sparse row is usable, not the mapper.
 */
export function mapVideoToCandidate({
  video,
  regionHint,
  topicTags,
  sourceQuery,
  source = 'query',
}: MapArgs): CandidateInsert | null {
  const youtubeId = video.id;
  if (!youtubeId) return null;

  const snippet = video.snippet;

  return {
    youtube_id: youtubeId,
    title: sanitizeText(snippet?.title),
    description: sanitizeText(snippet?.description, MAX_DESCRIPTION_CHARS),
    channel_id: snippet?.channelId ?? null,
    channel_title: sanitizeText(snippet?.channelTitle),
    duration_seconds: parseIsoDuration(video.contentDetails?.duration),
    published_at: snippet?.publishedAt ?? null,
    view_count: parseCount(video.statistics?.viewCount),
    like_count: parseCount(video.statistics?.likeCount),
    license: toStoredLicense(video.status?.license),
    is_embeddable: video.status?.embeddable ?? null,
    default_audio_language:
      snippet?.defaultAudioLanguage ?? snippet?.defaultLanguage ?? null,
    category_id: snippet?.categoryId ?? null,
    region_hint: regionHint,
    topic_tags: [...topicTags],
    source_queries: sourceQuery ? [sourceQuery] : [],
    discovery_sources: [source],
    thumbnail_url: bestThumbnail(snippet?.thumbnails),
    status: 'discovered',
    reject_reason: null,
  };
}

export type UpsertResult = {
  inserted: number;
  updated: number;
  /** youtube_id -> row as it now exists, for reporting. */
  rows: Map<string, CandidateRow>;
};

/**
 * Upsert a batch on conflict (youtube_id).
 *
 * The invariant that makes re-harvesting safe: an EXISTING row keeps its
 * status, reject_reason, difficulty_level and detected_language. Those are
 * pipeline state — a video that was already transcribed and published must
 * not be knocked back to 'discovered' just because a later search rediscovered
 * it. Only the volatile facts (stats, title, thumbnail) are refreshed.
 *
 * PostgREST's upsert overwrites every column it is given, so this is done as
 * read-then-split rather than one blind upsert: brand-new ids are inserted
 * whole, known ids get a narrow UPDATE of the refreshable columns only.
 */
export async function upsertCandidates(
  supabase: SupabaseClient,
  candidates: readonly CandidateInsert[]
): Promise<UpsertResult> {
  const result: UpsertResult = {
    inserted: 0,
    updated: 0,
    rows: new Map<string, CandidateRow>(),
  };
  if (candidates.length === 0) return result;

  const ids = candidates.map((c) => c.youtube_id);
  const { data: existingData, error: selectError } = await supabase
    .from(CANDIDATES_TABLE)
    .select('*')
    .in('youtube_id', ids);
  if (selectError) throw new Error(`candidate lookup failed: ${selectError.message}`);

  const existing = new Map<string, CandidateRow>();
  for (const row of (existingData ?? []) as CandidateRow[]) {
    existing.set(row.youtube_id, row);
  }

  const fresh = candidates.filter((c) => !existing.has(c.youtube_id));
  const known = candidates.filter((c) => existing.has(c.youtube_id));

  if (fresh.length > 0) {
    const { data, error } = await supabase
      .from(CANDIDATES_TABLE)
      .upsert(fresh, { onConflict: 'youtube_id', ignoreDuplicates: false })
      .select('*');
    if (error) throw new Error(`candidate insert failed: ${error.message}`);
    for (const row of (data ?? []) as CandidateRow[]) {
      result.rows.set(row.youtube_id, row);
    }
    result.inserted = data?.length ?? 0;
  }

  for (const candidate of known) {
    const previous = existing.get(candidate.youtube_id);
    // Refreshable facts only. status / reject_reason / difficulty_level /
    // detected_language are absent from this patch by design — see above.
    const patch = {
      title: candidate.title,
      description: candidate.description,
      channel_title: candidate.channel_title,
      duration_seconds: candidate.duration_seconds,
      view_count: candidate.view_count,
      like_count: candidate.like_count,
      is_embeddable: candidate.is_embeddable,
      thumbnail_url: candidate.thumbnail_url,
      // A video's license CAN change (a creator re-licenses to CC), and the
      // whole legal posture depends on it being current — so it is refreshed.
      license: candidate.license,
      // Union the tags: a clip found under both 'nature' and 'travel' is
      // legitimately both, and later searches must not erase earlier ones.
      topic_tags: Array.from(
        new Set([...(previous?.topic_tags ?? []), ...candidate.topic_tags])
      ),
      // Same union rule: a video found by a second query really was found by
      // both, and per-query yield is only meaningful if every hit is recorded.
      source_queries: Array.from(
        new Set([...(previous?.source_queries ?? []), ...candidate.source_queries])
      ),
      discovery_sources: Array.from(
        new Set([
          ...(previous?.discovery_sources ?? []),
          ...candidate.discovery_sources,
        ])
      ),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from(CANDIDATES_TABLE)
      .update(patch)
      .eq('youtube_id', candidate.youtube_id)
      .select('*')
      .single();
    if (error) throw new Error(`candidate update failed: ${error.message}`);
    result.rows.set(candidate.youtube_id, data as CandidateRow);
    result.updated += 1;
  }

  return result;
}

/**
 * How many ELIGIBLE rows each channel already has. Feeds the source-diversity
 * filter, and is read once per run rather than per video.
 */
export async function fetchEligibleCountsByChannel(
  supabase: SupabaseClient
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(CANDIDATES_TABLE)
      .select('channel_id')
      .eq('status', 'eligible')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`channel count failed: ${error.message}`);
    const rows = (data ?? []) as { channel_id: string | null }[];
    for (const row of rows) {
      if (!row.channel_id) continue;
      counts.set(row.channel_id, (counts.get(row.channel_id) ?? 0) + 1);
    }
    if (rows.length < pageSize) break;
  }
  return counts;
}

/** Apply a filter verdict to a row. */
export async function applyVerdict(
  supabase: SupabaseClient,
  youtubeId: string,
  status: CandidateStatus,
  rejectReason: string | null
): Promise<void> {
  const { error } = await supabase
    .from(CANDIDATES_TABLE)
    .update({ status, reject_reason: rejectReason })
    .eq('youtube_id', youtubeId);
  if (error) throw new Error(`verdict write failed: ${error.message}`);
}
