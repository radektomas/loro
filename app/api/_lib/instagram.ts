import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Radek's own Instagram accounts, read through Meta's official Instagram API
 * with Instagram Login (graph.instagram.com). SERVER-ONLY: the access tokens
 * pass through here and must never reach a browser.
 *
 * Metric names are from Meta's media-insights reference (v26.0, checked
 * 2026-10-26). Reels report views, reach, likes, comments, shares, saved,
 * reposts and ig_reels_avg_watch_time; `follows` is NOT available on reels,
 * which is why the account's follower count is snapshotted daily instead.
 * Insights data can lag up to 48 hours.
 */

if (typeof window !== 'undefined') {
  throw new Error('app/api/_lib/instagram.ts was imported in the browser. This module is server-only.');
}

const GRAPH = 'https://graph.instagram.com/v26.0';

/** Long-lived tokens last 60 days; refresh once fewer than this many remain. */
const REFRESH_WHEN_DAYS_LEFT = 20;
/** Only reels/posts this recent get their insights re-read each day. */
const INSIGHT_WINDOW_DAYS = 60;
/** The newest posts listed per account each sync. */
const MEDIA_PAGE = 50;

const T = {
  accounts: 'loro_marketing_ig_accounts',
  media: 'loro_marketing_ig_media',
  mediaDaily: 'loro_marketing_ig_media_daily',
  accountDaily: 'loro_marketing_ig_account_daily',
} as const;

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number } };

/** GET a Graph endpoint. Throws with Instagram's own message, never a guess. */
async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  const res = await fetch(url, { cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok || body.error) {
    const e = body.error;
    throw new Error(`Instagram ${res.status}${e?.code ? ` (code ${e.code})` : ''}: ${e?.message ?? res.statusText}`);
  }
  return body;
}

export type IgProfile = { igUserId: string; username: string; followersCount: number | null; mediaCount: number | null };

export async function fetchProfile(token: string): Promise<IgProfile> {
  const me = await graph<{ id: string; user_id?: string; username: string; followers_count?: number; media_count?: number }>(
    '/me',
    token,
    { fields: 'user_id,username,followers_count,media_count' }
  );
  return {
    // user_id is the professional account's id; id is app-scoped. Prefer the
    // stable one so reconnecting with a new token lands on the same row.
    igUserId: me.user_id ?? me.id,
    username: me.username,
    followersCount: me.followers_count ?? null,
    mediaCount: me.media_count ?? null,
  };
}

type IgMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp: string;
};

async function fetchMedia(token: string): Promise<IgMedia[]> {
  const page = await graph<{ data: IgMedia[] }>('/me/media', token, {
    fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp',
    limit: String(MEDIA_PAGE),
  });
  return page.data ?? [];
}

type Insight = { name: string; values?: { value: number }[]; total_value?: { value: number } };

const REEL_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'reposts', 'ig_reels_avg_watch_time'];
const FEED_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'reposts'];
/** The fallback when Instagram rejects the full list for one media item. */
const CORE_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved'];

export type InsightRow = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  reposts: number | null;
  avg_watch_ms: number | null;
};

async function fetchInsights(media: IgMedia, token: string): Promise<InsightRow> {
  const metrics = media.media_product_type === 'REELS' ? REEL_METRICS : FEED_METRICS;
  let data: Insight[];
  try {
    data = (await graph<{ data: Insight[] }>(`/${media.id}/insights`, token, { metric: metrics.join(',') })).data;
  } catch {
    // One unsupported metric fails the whole request (metrics marked "in
    // development" come and go). The core six are stable; if even they fail,
    // that error is the real one and propagates.
    data = (await graph<{ data: Insight[] }>(`/${media.id}/insights`, token, { metric: CORE_METRICS.join(',') })).data;
  }
  const read = (name: string): number | null => {
    const m = data.find((d) => d.name === name);
    const v = m?.total_value?.value ?? m?.values?.[0]?.value;
    return typeof v === 'number' ? v : null;
  };
  return {
    views: read('views'),
    reach: read('reach'),
    likes: read('likes'),
    comments: read('comments'),
    shares: read('shares'),
    saved: read('saved'),
    reposts: read('reposts'),
    avg_watch_ms: read('ig_reels_avg_watch_time'),
  };
}

/** Swap a long-lived token for a fresh 60-day one (token must be ≥24h old). */
async function refreshToken(token: string): Promise<{ token: string; expiresAt: string }> {
  const r = await graph<{ access_token: string; expires_in: number }>(
    'https://graph.instagram.com/refresh_access_token',
    token,
    { grant_type: 'ig_refresh_token' }
  );
  return { token: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000).toISOString() };
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Run `fn` over `items` with at most `n` in flight. */
async function pool<A, B>(items: A[], n: number, fn: (a: A) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/**
 * Store a token pasted into the dashboard. The token is checked against
 * Instagram first — a typo or a token for the wrong app fails here, loudly,
 * instead of failing silently at 6am. Then the account is synced once so the
 * dashboard has numbers straight away.
 */
export async function connectAccount(db: SupabaseClient, token: string): Promise<{ username: string; sync: SyncResult }> {
  const profile = await fetchProfile(token);
  const { error } = await db.from(T.accounts).upsert(
    {
      ig_user_id: profile.igUserId,
      username: profile.username,
      access_token: token,
      // Tokens from Meta's dashboard are long-lived (60 days). The exact expiry
      // is learned on the first refresh; until then assume the full 60 days
      // from now, which the refresh margin comfortably covers.
      token_expires_at: new Date(Date.now() + 60 * 86400 * 1000).toISOString(),
      connected_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: 'ig_user_id' }
  );
  if (error) throw new Error(`${T.accounts}: ${error.message}`);
  const sync = await syncAccount(db, { ig_user_id: profile.igUserId, username: profile.username, access_token: token, token_expires_at: null, connected_at: new Date().toISOString() });
  return { username: profile.username, sync };
}

type AccountRow = {
  ig_user_id: string;
  username: string;
  access_token: string;
  token_expires_at: string | null;
  connected_at: string;
};

export type SyncResult = { username: string; ok: boolean; posts: number; insights: number; error?: string; refreshed?: boolean };

export async function syncAccount(db: SupabaseClient, account: AccountRow): Promise<SyncResult> {
  let token = account.access_token;
  let refreshed = false;
  try {
    // 1. Keep the token alive. Refreshing needs a token at least 24h old.
    const expires = account.token_expires_at ? new Date(account.token_expires_at).getTime() : null;
    const ageMs = Date.now() - new Date(account.connected_at).getTime();
    if (expires !== null && expires - Date.now() < REFRESH_WHEN_DAYS_LEFT * 86400 * 1000 && ageMs > 25 * 3600 * 1000) {
      const r = await refreshToken(token);
      token = r.token;
      refreshed = true;
      const { error } = await db
        .from(T.accounts)
        .update({ access_token: r.token, token_expires_at: r.expiresAt, connected_at: new Date().toISOString() })
        .eq('ig_user_id', account.ig_user_id);
      if (error) throw new Error(`${T.accounts} (token refresh): ${error.message}`);
    }

    // 2. The account's own numbers for today.
    const profile = await fetchProfile(token);
    const day = today();
    {
      const { error } = await db.from(T.accountDaily).upsert(
        { ig_user_id: account.ig_user_id, day, followers_count: profile.followersCount, media_count: profile.mediaCount },
        { onConflict: 'ig_user_id,day' }
      );
      if (error) throw new Error(`${T.accountDaily}: ${error.message}`);
    }

    // 3. The newest posts, and today's totals for the recent ones.
    const media = await fetchMedia(token);
    if (media.length > 0) {
      const { error } = await db.from(T.media).upsert(
        media.map((m) => ({
          media_id: m.id,
          ig_user_id: account.ig_user_id,
          caption: m.caption ?? null,
          media_type: m.media_type ?? null,
          media_product_type: m.media_product_type ?? null,
          permalink: m.permalink ?? null,
          // Videos have thumbnail_url; images only have media_url.
          thumbnail_url: m.thumbnail_url ?? (m.media_type === 'IMAGE' ? m.media_url ?? null : null),
          posted_at: m.timestamp,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'media_id' }
      );
      if (error) throw new Error(`${T.media}: ${error.message}`);
    }

    const cutoff = Date.now() - INSIGHT_WINDOW_DAYS * 86400 * 1000;
    const recent = media.filter((m) => new Date(m.timestamp).getTime() >= cutoff && m.media_product_type !== 'STORY');
    const failures: string[] = [];
    const rows = (
      await pool(recent, 5, async (m) => {
        try {
          return { media_id: m.id, day, ...(await fetchInsights(m, token)) };
        } catch (e) {
          failures.push(`${m.id}: ${(e as Error).message}`);
          return null;
        }
      })
    ).filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) {
      const { error } = await db.from(T.mediaDaily).upsert(rows, { onConflict: 'media_id,day' });
      if (error) throw new Error(`${T.mediaDaily}: ${error.message}`);
    }

    const lastError = failures.length ? `insights failed for ${failures.length} post(s): ${failures[0]}` : null;
    await db
      .from(T.accounts)
      .update({ username: profile.username, last_synced_at: new Date().toISOString(), last_error: lastError })
      .eq('ig_user_id', account.ig_user_id);
    return { username: profile.username, ok: true, posts: media.length, insights: rows.length, refreshed, ...(lastError ? { error: lastError } : {}) };
  } catch (e) {
    const message = (e as Error).message;
    await db.from(T.accounts).update({ last_error: message }).eq('ig_user_id', account.ig_user_id);
    return { username: account.username, ok: false, posts: 0, insights: 0, error: message, refreshed };
  }
}

export async function syncAll(db: SupabaseClient): Promise<SyncResult[]> {
  const { data, error } = await db
    .from(T.accounts)
    .select('ig_user_id, username, access_token, token_expires_at, connected_at');
  if (error) throw new Error(`${T.accounts}: ${error.message}`);
  const results: SyncResult[] = [];
  for (const account of (data ?? []) as AccountRow[]) results.push(await syncAccount(db, account));
  return results;
}

/** Everything the dashboard shows. Tokens are never selected. */
export async function loadMarketingData(db: SupabaseClient) {
  const since = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);
  const [accounts, media, mediaDaily, accountDaily] = await Promise.all([
    db.from(T.accounts).select('ig_user_id, username, connected_at, last_synced_at, last_error, token_expires_at').order('username'),
    db.from(T.media).select('*').order('posted_at', { ascending: false }).limit(300),
    db.from(T.mediaDaily).select('*').gte('day', since).order('day'),
    db.from(T.accountDaily).select('*').gte('day', since).order('day'),
  ]);
  for (const [name, r] of [
    [T.accounts, accounts],
    [T.media, media],
    [T.mediaDaily, mediaDaily],
    [T.accountDaily, accountDaily],
  ] as const) {
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
  }
  return {
    accounts: accounts.data ?? [],
    media: media.data ?? [],
    mediaDaily: mediaDaily.data ?? [],
    accountDaily: accountDaily.data ?? [],
  };
}
