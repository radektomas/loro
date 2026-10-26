/**
 * The marketing dashboard's arithmetic, kept pure so it can be tested and so
 * the page and the API agree on it.
 *
 * THE ONE IDEA: raw views are not evidence. A reel's views mean something
 * only against that ACCOUNT'S usual reel, so every reel is scored as a
 * multiple of the account's median over its recent reels (the ig-viral
 * skill's outlier multiple, applied to Radek's own accounts). 3x and up is a
 * format worth repeating; under 1x is a quiet one.
 *
 * Plain relative imports only — this file is also imported by node --test.
 */

export type ReelMetrics = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  reposts: number | null;
  avgWatchMs: number | null;
};

export type MarketingAccount = {
  igUserId: string;
  username: string;
  connectedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  tokenExpiresAt: string | null;
  /** Oldest first, one point per synced day. */
  followers: { day: string; count: number }[];
};

export type MarketingPost = {
  mediaId: string;
  igUserId: string;
  caption: string | null;
  mediaType: string | null;
  productType: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  postedAt: string;
  /** The latest synced totals. */
  latest: ReelMetrics | null;
  /** Views by synced day, oldest first — how fast it grew. */
  viewsByDay: { day: string; views: number }[];
};

export type MarketingData = {
  accounts: MarketingAccount[];
  posts: MarketingPost[];
};

/** How many recent posts form an account's "usual" number. */
export const BASELINE_POSTS = 12;

export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * The account's usual views: the median of its most recent BASELINE_POSTS
 * posts that have a view count, EXCLUDING posts under 48 hours old — those
 * are still climbing (Instagram's own data can lag up to 48h), and counting
 * them would drag the baseline down and flatter every older reel.
 */
export function accountBaseline(posts: MarketingPost[], now: Date = new Date()): number | null {
  const settled = posts
    .filter((p) => p.latest?.views != null)
    .filter((p) => now.getTime() - new Date(p.postedAt).getTime() >= 48 * 3600 * 1000)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, BASELINE_POSTS)
    .map((p) => p.latest!.views!);
  return median(settled);
}

/** views / baseline, or null when either side is unknown or the baseline is 0. */
export function multipleOf(views: number | null | undefined, baseline: number | null): number | null {
  if (views == null || baseline == null || baseline <= 0) return null;
  return views / baseline;
}

/**
 * Engagement that predicts reach: shares and saves per 1,000 views. A share
 * sends the reel to someone new and a save says "worth coming back to" — both
 * weigh more in Instagram's distribution than a like.
 */
export function sharesSavesPer1k(m: ReelMetrics | null): number | null {
  if (!m || m.views == null || m.views <= 0) return null;
  return (((m.shares ?? 0) + (m.saved ?? 0)) / m.views) * 1000;
}

/** Followers gained per day, from consecutive daily snapshots (gaps skipped). */
export function followerGains(points: { day: string; count: number }[]): { day: string; gain: number }[] {
  const out: { day: string; gain: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    out.push({ day: points[i].day, gain: points[i].count - points[i - 1].count });
  }
  return out;
}

/** The first line of a caption — usually the hook as written. */
export function hookLine(caption: string | null, max = 90): string {
  const first = (caption ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
