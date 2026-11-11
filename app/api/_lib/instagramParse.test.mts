import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInsights } from './instagram.ts';

test('readInsights reads total_value and values[0], and leaves missing metrics null', () => {
  const row = readInsights([
    { name: 'views', total_value: { value: 1361 } },
    { name: 'comments', values: [{ value: 12 }] },
    { name: 'ig_reels_video_view_total_time', total_value: { value: 4_200_000 } },
    { name: 'ig_reels_avg_watch_time', total_value: { value: 3100 } },
  ]);
  assert.deepEqual(row, {
    views: 1361,
    reach: null,
    likes: null,
    comments: 12,
    shares: null,
    saved: null,
    reposts: null,
    avg_watch_ms: 3100,
    skip_rate: null,
    view_total_ms: 4_200_000,
  });
});

test('readInsights reads the skip rate when Meta sends it', () => {
  assert.equal(readInsights([{ name: 'reels_skip_rate', total_value: { value: 41.5 } }]).skip_rate, 41.5);
});
