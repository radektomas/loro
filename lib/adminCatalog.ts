import { getSupabase } from '@loro/core/supabase';
import type { Loaded } from './analytics';

/**
 * Read side of the published catalog, for /admin/catalog.
 *
 * WHY THIS READS THE TABLE DIRECTLY AND analytics.ts DOES NOT. The two admin
 * dashboards look alike and have opposite security models. loro_analytics_events
 * has no SELECT policy at all, so every number there must come from a
 * SECURITY DEFINER RPC. loro_catalog_videos is the opposite: its policy is
 * `for select using (true)` because the catalog IS the public product — the
 * app fetches these rows with the anon key on every device. So a plain
 * .select() is correct here, and the admin gate on the page is about who
 * should be LOOKING at a management view, not about protecting the rows.
 *
 * CUES AND DICTIONARY ARE NEVER IN THE LIST QUERY. They are the whole weight
 * of the table — 382 rows come to 6.9MB, almost all of it transcript jsonb —
 * and a browser does not need one word of it to render a grid of cards. The
 * column list below is explicit for that reason; `select('*')` here would pull
 * the entire catalog into memory to show thumbnails. Transcript detail is
 * fetched one row at a time by loadTranscriptStats() when a card is opened.
 *
 * Rows arrive snake_case and are mapped to camelCase at this boundary, per
 * lib/creators.ts.
 */

/** Exactly the columns the grid needs. Kept as one string so the type below
    and the query cannot drift apart silently. */
const LIST_COLUMNS =
  'id,kind,creator,level,duration_seconds,thumbnail_url,poster,youtube_id,' +
  'attribution_channel_title,attribution_channel_url,attribution_video_url,' +
  'attribution_license,created_at,updated_at';

export type CatalogKind = 'embed' | 'seed';
export type CatalogLevel = 'A1' | 'A2' | 'B1' | 'B2';
export type CatalogLicense = 'creativeCommon' | 'youtube';

export type CatalogVideo = {
  id: string;
  /**
   * Is this row in the snapshot devices actually fetch?
   *
   * loro_catalog_videos is a SUPERSET of the shipped catalog: publish-catalog
   * leaves rows behind when content is removed, because loro_saved_words
   * .video_id still points at them and there is deliberately no FK. 446 rows
   * against 382 live, the day this was written. A management view that showed
   * all of them would be lying about the size and shape of the feed, so every
   * row carries the answer and the summary counts only live ones.
   */
  live: boolean;
  kind: CatalogKind;
  creator: string;
  level: CatalogLevel;
  /** null on seed rows that predate the duration column being populated. */
  durationSeconds: number | null;
  /** Embeds carry thumbnail_url; seed clips carry poster. posterOf() picks. */
  thumbnailUrl: string | null;
  poster: string | null;
  youtubeId: string | null;
  /** The four TASL fields. Null on every seed row, non-null on every embed —
      the table has a check constraint saying so, so the UI may rely on it. */
  channelTitle: string | null;
  channelUrl: string | null;
  videoUrl: string | null;
  license: CatalogLicense | null;
  createdAt: string;
  updatedAt: string;
};

type CatalogRowJson = {
  id: string;
  kind: CatalogKind;
  creator: string;
  level: CatalogLevel;
  duration_seconds: number | string | null;
  thumbnail_url: string | null;
  poster: string | null;
  youtube_id: string | null;
  attribution_channel_title: string | null;
  attribution_channel_url: string | null;
  attribution_video_url: string | null;
  attribution_license: CatalogLicense | null;
  created_at: string;
  updated_at: string;
};

/**
 * duration_seconds is `numeric` in Postgres, and PostgREST serialises numeric
 * as a STRING to preserve precision it cannot promise in a JS number. Reading
 * it as a number without this would make every duration NaN — and NaN sorts
 * and compares silently rather than throwing, so the bug would surface as a
 * grid that simply refuses to sort by length.
 */
function toSeconds(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function mapRow(row: CatalogRowJson, live: (id: string) => boolean): CatalogVideo {
  return {
    id: row.id,
    live: live(row.id),
    kind: row.kind,
    creator: row.creator,
    level: row.level,
    durationSeconds: toSeconds(row.duration_seconds),
    thumbnailUrl: row.thumbnail_url,
    poster: row.poster,
    youtubeId: row.youtube_id,
    channelTitle: row.attribution_channel_title,
    channelUrl: row.attribution_channel_url,
    videoUrl: row.attribution_video_url,
    license: row.attribution_license,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** PostgREST caps a response at 1000 rows regardless of what you ask for, and
    the catalog only grows. Paging is not premature here: the run that crosses
    1000 would otherwise silently render a truncated catalog, which is the one
    failure mode a management view must never have. */
const PAGE = 1000;

/**
 * The ids in the published snapshot, from MANIFEST_PATH.
 *
 * Written by publish-catalog from the same list the snapshot bytes are built
 * from, so it cannot disagree with what shipped. Returns null when the object
 * is missing — a catalog published before the manifest existed — and the
 * caller then declines to guess which rows are live rather than inventing an
 * answer from timestamps.
 */
async function fetchLiveIds(
  supabase: NonNullable<ReturnType<typeof getSupabase>>
): Promise<Set<string> | null> {
  const { data } = supabase.storage
    .from('loro-catalog')
    .getPublicUrl('catalog/manifest.json');
  try {
    // cache: 'no-store' because the manifest changes on every publish and a
    // stale one would mark freshly published videos as orphans — the single
    // most confusing thing this screen could get wrong.
    const response = await fetch(data.publicUrl, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { ids?: unknown };
    if (!Array.isArray(body.ids)) return null;
    return new Set(body.ids.filter((id): id is string => typeof id === 'string'));
  } catch {
    return null;
  }
}

export type CatalogLoad = {
  videos: CatalogVideo[];
  /** False when the manifest was unreachable: every row is then reported live,
      and the page says so rather than quietly overstating the feed. */
  liveKnown: boolean;
};

export async function loadCatalog(): Promise<Loaded<CatalogLoad>> {
  const supabase = getSupabase();
  if (!supabase) {
    return {
      ok: false,
      error:
        'Supabase is not configured in this browser — NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are missing from this environment.',
    };
  }
  const liveIds = await fetchLiveIds(supabase);
  const isLive = liveIds ? (id: string) => liveIds.has(id) : () => true;

  const all: CatalogVideo[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('loro_catalog_videos')
      .select(LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: `loro_catalog_videos: ${error.message}` };
    const rows = (data ?? []) as unknown as CatalogRowJson[];
    all.push(...rows.map((row) => mapRow(row, isLive)));
    if (rows.length < PAGE) break;
  }
  return { ok: true, data: { videos: all, liveKnown: liveIds !== null } };
}

// --------------------------------------------------------------- transcript

export type TranscriptStats = {
  cues: number;
  words: number;
  dictionaryEntries: number;
  /** Share of "word" tokens that actually contain whitespace, i.e. a whole
      line stamped as one word. The karaoke layout, word taps and blank
      planning all break on these — publish-embeds rejects the shape at ingest
      now (captions_no_word_timing), but rows published BEFORE that guard
      existed are still in the catalog and this is how you find them. */
  multiWordShare: number;
};

type CueJson = { words?: { text?: string }[] };

/** Fetched per row, on demand, because this is the 18KB half of the table. */
export async function loadTranscriptStats(
  id: string
): Promise<Loaded<TranscriptStats>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { data, error } = await supabase
    .from('loro_catalog_videos')
    .select('cues,dictionary')
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `no catalog row "${id}"` };

  const cues = (data.cues ?? []) as CueJson[];
  let words = 0;
  let multiWord = 0;
  for (const cue of cues) {
    for (const word of cue.words ?? []) {
      words += 1;
      if (/\s/.test((word.text ?? '').trim())) multiWord += 1;
    }
  }
  return {
    ok: true,
    data: {
      cues: cues.length,
      words,
      dictionaryEntries: Object.keys(
        (data.dictionary ?? {}) as Record<string, unknown>
      ).length,
      multiWordShare: words === 0 ? 0 : multiWord / words,
    },
  };
}

// ------------------------------------------------------------------ summary

export type ChannelCount = { channel: string; count: number };

export type CatalogSummary = {
  total: number;
  embeds: number;
  seeds: number;
  channels: number;
  byLevel: Record<CatalogLevel, number>;
  byLicense: Record<CatalogLicense, number>;
  medianSeconds: number | null;
  /** Descending. The feed's concentration problem, made visible: this is the
      number that decides whether the next content run should buy new faces or
      more of a channel that already works. */
  topChannels: ChannelCount[];
};

/** The label a row is grouped by. Embeds carry a channel; seed clips have no
    author at all (kind 'seed' → FeedAuthor {kind:'none'}), so they are named
    rather than left blank or folded into a real channel's count. */
/** The still to show on a card. Embeds have a YouTube thumbnail, seed clips
    have their own poster frame; neither kind has both. */
export function posterOf(video: CatalogVideo): string | null {
  return video.thumbnailUrl ?? video.poster;
}

export function channelOf(video: CatalogVideo): string {
  return video.channelTitle?.trim() || (video.kind === 'seed' ? 'Seed clips' : video.creator);
}

/** Counts describe the LIVE feed only. An orphan is not in the app, so
    including one would misstate every figure on the page. */
export function summarise(all: readonly CatalogVideo[]): CatalogSummary {
  const videos = all.filter((v) => v.live);
  const byLevel: Record<CatalogLevel, number> = { A1: 0, A2: 0, B1: 0, B2: 0 };
  const byLicense: Record<CatalogLicense, number> = {
    creativeCommon: 0,
    youtube: 0,
  };
  const channels = new Map<string, number>();
  const durations: number[] = [];
  let embeds = 0;

  for (const v of videos) {
    byLevel[v.level] = (byLevel[v.level] ?? 0) + 1;
    if (v.license) byLicense[v.license] += 1;
    if (v.kind === 'embed') embeds += 1;
    const ch = channelOf(v);
    channels.set(ch, (channels.get(ch) ?? 0) + 1);
    if (v.durationSeconds !== null) durations.push(v.durationSeconds);
  }
  durations.sort((a, b) => a - b);

  return {
    total: videos.length,
    embeds,
    seeds: videos.length - embeds,
    channels: channels.size,
    byLevel,
    byLicense,
    medianSeconds:
      durations.length === 0 ? null : durations[Math.floor(durations.length / 2)],
    topChannels: [...channels.entries()]
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel)),
  };
}

// ------------------------------------------------------------------ filters

export type CatalogFilters = {
  /** Matched against creator, channel and id — the three things you actually
      have when you want to find one video you just saw in the app. */
  query: string;
  level: CatalogLevel | 'all';
  license: CatalogLicense | 'all';
  kind: CatalogKind | 'all';
  channel: string | 'all';
  /** Inclusive seconds bounds; null means unbounded on that side. */
  maxSeconds: number | null;
  /** Show the rows the table kept after a removal. Off by default: the
      question this page answers is "what is in the feed". */
  includeOrphans: boolean;
};

export const EMPTY_FILTERS: CatalogFilters = {
  query: '',
  level: 'all',
  license: 'all',
  kind: 'all',
  channel: 'all',
  maxSeconds: null,
  includeOrphans: false,
};

export type CatalogSort = 'newest' | 'oldest' | 'longest' | 'shortest' | 'channel';

export function applyFilters(
  videos: readonly CatalogVideo[],
  filters: CatalogFilters,
  sort: CatalogSort
): CatalogVideo[] {
  const needle = filters.query.trim().toLowerCase();
  const out = videos.filter((v) => {
    if (!filters.includeOrphans && !v.live) return false;
    if (filters.level !== 'all' && v.level !== filters.level) return false;
    if (filters.license !== 'all' && v.license !== filters.license) return false;
    if (filters.kind !== 'all' && v.kind !== filters.kind) return false;
    if (filters.channel !== 'all' && channelOf(v) !== filters.channel) return false;
    if (
      filters.maxSeconds !== null &&
      // A row with no duration is not silently kept by a length filter: "under
      // 30s" must not include rows whose length nobody knows.
      (v.durationSeconds === null || v.durationSeconds > filters.maxSeconds)
    ) {
      return false;
    }
    if (needle) {
      const hay = `${v.creator} ${v.channelTitle ?? ''} ${v.id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const sorted = [...out];
  switch (sort) {
    case 'newest':
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case 'oldest':
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case 'longest':
      sorted.sort((a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1));
      break;
    case 'shortest':
      sorted.sort((a, b) => (a.durationSeconds ?? 1e9) - (b.durationSeconds ?? 1e9));
      break;
    case 'channel':
      sorted.sort(
        (a, b) =>
          channelOf(a).localeCompare(channelOf(b)) ||
          (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0)
      );
      break;
  }
  return sorted;
}

/**
 * The command that turns a selection into a takedown.
 *
 * The dashboard cannot perform the removal itself and this is not a
 * limitation to route around: data/embedVideos.json in the repo is canonical
 * and this table is derived from it (see the header of migration
 * 20260804000000). A web write here would be overwritten by the next
 * publish-catalog, so the only honest "remove" a browser can offer is the
 * exact command to run on the machine that owns the repo.
 */
export function blockCommand(ids: readonly string[], reason: string): string {
  const safeReason = reason.trim().replace(/"/g, "'") || 'removed from /admin/catalog';
  return `npm run block -- --ids ${ids.join(',')} --reason "${safeReason}"`;
}
