import {
  MAX_RETRIES,
  QUOTA_COST,
  REQUEST_DELAY_MS,
  RETRY_BASE_MS,
  type LicenseBranch,
} from '../config/harvest-queries.mts';

/**
 * A minimal, strictly-typed YouTube Data API v3 client over fetch.
 *
 * Two endpoints (search.list, videos.list) do not justify the googleapis SDK
 * and its transitive dependency tree, so this is hand-rolled. Every field of
 * every response is optional in the type: the API omits likeCount when the
 * uploader hides likes, omits defaultAudioLanguage almost always, and can
 * return search hits whose videos.list entry has since disappeared. Treating
 * those as guaranteed is how a harvester crashes at 3am, so nothing here is
 * asserted — the caller narrows.
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3';

// ---------------------------------------------------------- response shapes

export type YouTubeThumbnail = {
  url?: string;
  width?: number;
  height?: number;
};

export type YouTubeSearchItem = {
  id?: { kind?: string; videoId?: string };
};

export type YouTubeSearchResponse = {
  nextPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  items?: YouTubeSearchItem[];
};

export type YouTubeVideo = {
  id?: string;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    categoryId?: string;
    /** Language the uploader declared for the metadata, not the audio. */
    defaultLanguage?: string;
    /** Language of the ORIGINAL audio track. Usually absent. */
    defaultAudioLanguage?: string;
    thumbnails?: Record<string, YouTubeThumbnail | undefined>;
    tags?: string[];
  };
  contentDetails?: {
    /** ISO 8601, e.g. "PT1M12S". */
    duration?: string;
    caption?: string;
    regionRestriction?: {
      allowed?: string[];
      blocked?: string[];
    };
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  /**
   * The `status` part. NOT in the original spec's part list, but license and
   * embeddable BOTH live here and nowhere else — without it the two columns
   * the legal posture depends on would be null forever. videos.list costs 1
   * unit regardless of how many parts are requested, so this is free.
   */
  status?: {
    /** 'youtube' | 'creativeCommon' */
    license?: string;
    embeddable?: boolean;
    privacyStatus?: string;
    uploadStatus?: string;
  };
};

export type YouTubeVideosResponse = {
  items?: YouTubeVideo[];
};

type YouTubeErrorResponse = {
  error?: {
    code?: number;
    message?: string;
    errors?: { reason?: string; message?: string }[];
  };
};

// ------------------------------------------------------------------- errors

/**
 * The daily quota is gone. Distinct from a transient rate limit because it is
 * NOT retryable — no amount of backoff brings quota back before midnight
 * Pacific. The script catches this and shuts down cleanly with its cursor
 * saved, exactly as if it had hit its own budget.
 */
export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class YouTubeApiError extends Error {
  readonly status: number;
  readonly reason: string | null;
  constructor(status: number, reason: string | null, message: string) {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
    this.reason = reason;
  }
}

/** Google's non-retryable 403 reasons: quota is spent for the day. */
const QUOTA_REASONS = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'dailyLimitExceededUnreg',
]);

// ------------------------------------------------------------------ helpers

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ISO 8601 duration -> seconds. YouTube returns "PT1M12S", "PT45S", "PT1H2M3S",
 * and (for the odd malformed upload) "P0D". Returns null when it cannot parse,
 * so the caller rejects the row rather than silently treating it as 0s.
 */
export function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  return Math.round(total);
}

/** Counts as an integer, or null when the uploader hides the statistic. */
export function parseCount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Largest available thumbnail, preferring the widest known rendition. */
export function bestThumbnail(
  thumbnails: Record<string, YouTubeThumbnail | undefined> | undefined
): string | null {
  if (!thumbnails) return null;
  for (const key of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = thumbnails[key]?.url;
    if (url) return url;
  }
  return null;
}

// -------------------------------------------------------------- quota meter

/**
 * Tracks units spent against the run's budget. The rule the whole design
 * hangs on: a call is only made if it is affordable BEFORE it starts, so the
 * script never stops halfway through a write.
 */
export class QuotaMeter {
  readonly budget: number;
  private used = 0;
  private readonly calls = { search: 0, videos: 0 };

  constructor(budget: number) {
    this.budget = budget;
  }

  get spent(): number {
    return this.used;
  }

  get remaining(): number {
    return Math.max(0, this.budget - this.used);
  }

  get searchCalls(): number {
    return this.calls.search;
  }

  get videoCalls(): number {
    return this.calls.videos;
  }

  canAfford(kind: keyof typeof QUOTA_COST): boolean {
    return this.used + QUOTA_COST[kind] <= this.budget;
  }

  charge(kind: keyof typeof QUOTA_COST): void {
    this.used += QUOTA_COST[kind];
    this.calls[kind] += 1;
  }
}

// ------------------------------------------------------------- the requests

type Query = Record<string, string>;

/**
 * One API call with rate limiting and exponential backoff.
 *
 * Retries 429, 5xx and transient 403s (rateLimitExceeded / userRateLimit...),
 * with jittered exponential backoff. Does NOT retry a quota 403 — that is a
 * hard daily wall, so it becomes QuotaExceededError and the run ends cleanly.
 * 400/404 fail fast: a malformed request will be malformed on every retry.
 */
async function request<T>(
  endpoint: string,
  params: Query,
  apiKey: string
): Promise<T> {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('key', apiKey);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // 1s, 2s, 4s, 8s, 16s (+ up to 1s jitter so parallel runs desynchronise)
      const backoff = RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 1000;
      console.log(
        `      retry ${attempt}/${MAX_RETRIES} in ${(backoff / 1000).toFixed(1)}s — ${lastError?.message ?? 'unknown'}`
      );
      await sleep(backoff);
    } else {
      await sleep(REQUEST_DELAY_MS);
    }

    let response: Response;
    try {
      response = await fetch(url, { headers: { accept: 'application/json' } });
    } catch (cause) {
      // Network-level failure (DNS, socket) — always worth a retry.
      lastError = new Error(
        `network error: ${cause instanceof Error ? cause.message : String(cause)}`
      );
      continue;
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = (await response.json().catch(() => ({}))) as YouTubeErrorResponse;
    const reason = body.error?.errors?.[0]?.reason ?? null;
    const message = body.error?.message ?? response.statusText;

    if (response.status === 403 && reason && QUOTA_REASONS.has(reason)) {
      throw new QuotaExceededError(
        `YouTube daily quota exhausted (${reason}): ${message}`
      );
    }

    const retryable =
      response.status === 429 ||
      response.status === 403 ||
      response.status >= 500;

    if (!retryable) {
      throw new YouTubeApiError(
        response.status,
        reason,
        `${endpoint} failed (${response.status} ${reason ?? 'unknown'}): ${message}`
      );
    }

    lastError = new YouTubeApiError(
      response.status,
      reason,
      `${response.status} ${reason ?? 'unknown'}: ${message}`
    );
  }

  throw lastError ?? new Error(`${endpoint} failed after ${MAX_RETRIES} retries`);
}

export type SearchArgs = {
  query: string;
  region: string;
  license: LicenseBranch;
  pageToken?: string;
};

/**
 * search.list — 100 units. Fixed to short (<4 min), embeddable, Spanish-
 * relevant videos, ordered by relevance. `videoLicense` is the branch: the
 * 'creativeCommon' pass and the 'any' pass are separate calls on purpose and
 * their results are never pooled before the per-video license is known.
 */
export async function searchVideos(
  args: SearchArgs,
  apiKey: string
): Promise<YouTubeSearchResponse> {
  const params: Query = {
    part: 'snippet',
    type: 'video',
    q: args.query,
    regionCode: args.region,
    relevanceLanguage: 'es',
    videoDuration: 'short',
    videoEmbeddable: 'true',
    videoLicense: args.license,
    maxResults: '50',
    order: 'relevance',
  };
  if (args.pageToken) params.pageToken = args.pageToken;
  return request<YouTubeSearchResponse>('search', params, apiKey);
}

/**
 * videos.list — 1 unit per call regardless of how many ids or parts, which is
 * why ids are sent in batches of 50 rather than one at a time. Fifty separate
 * calls would cost 50x for identical data.
 */
export async function listVideos(
  ids: readonly string[],
  apiKey: string
): Promise<YouTubeVideo[]> {
  if (ids.length === 0) return [];
  if (ids.length > 50) {
    throw new Error(`listVideos takes at most 50 ids, got ${ids.length}`);
  }
  const response = await request<YouTubeVideosResponse>(
    'videos',
    {
      part: 'snippet,contentDetails,statistics,status',
      id: ids.join(','),
      maxResults: '50',
    },
    apiKey
  );
  return response.items ?? [];
}

/** Split ids into API-sized batches of 50. */
export function batchIds(ids: readonly string[], size = 50): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    batches.push(ids.slice(i, i + size));
  }
  return batches;
}
