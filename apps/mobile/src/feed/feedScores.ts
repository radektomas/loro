import { EMPTY_SCORES, parseFeedScores, type FeedScores } from '@loro/core/feedRank';
import { VIDEO_SCORES } from '@loro/core/catalog/videoScores';
import { CATALOG_BASE_URL } from '../platform/config';
import { storageDriver } from '../platform/storage';

/**
 * THE FEED'S VIDEO SCORES, for core/feedRank. Three layers, best first:
 *   1. the last scores fetched from the bucket (scripts/score-videos.mts
 *      --publish), kept in MMKV so they work offline and at cold start;
 *   2. the scores bundled in this build (catalog/videoScores.ts);
 *   3. none — every video at the prior, which is a plain shuffle.
 * A fetch runs once per launch in the background and only ever affects the
 * NEXT ordering, so a slow network never delays the feed.
 */
const KEY = 'loro.mobile.feedScores';
const URL = `${CATALOG_BASE_URL}/feed/scores.json`;

let cached: FeedScores | null = null;

export function getFeedScores(): FeedScores {
  if (cached) return cached;
  try {
    const raw = storageDriver.local.getItem(KEY);
    if (raw) cached = parseFeedScores(JSON.parse(raw));
  } catch {
    cached = null;
  }
  cached ??= parseFeedScores(VIDEO_SCORES) ?? EMPTY_SCORES;
  return cached;
}

let fetched = false;

/** Refresh from the bucket, once per launch. Failures keep what we have. */
export function refreshFeedScores(): void {
  if (fetched) return;
  fetched = true;
  void fetch(URL, { headers: { 'Cache-Control': 'no-cache' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      const parsed = parseFeedScores(json);
      if (!parsed) return;
      cached = parsed;
      try {
        storageDriver.local.setItem(KEY, JSON.stringify(json));
      } catch {}
    })
    .catch(() => {});
}
