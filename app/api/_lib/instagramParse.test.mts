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

test('unsupportedMetrics names exactly what Instagram refused', async () => {
  const { unsupportedMetrics } = await import('./instagram.ts');
  assert.deepEqual(
    unsupportedMetrics('Instagram 400 (code 100): Instagram Insights Media API endpoint does not support the metrics: reposts. Please refer to https://developers.facebook.com/docs'),
    ['reposts']
  );
  assert.deepEqual(unsupportedMetrics('… does not support the metrics: reposts, reels_skip_rate. Please refer'), ['reposts', 'reels_skip_rate']);
  assert.deepEqual(unsupportedMetrics('Instagram 500: something else'), []);
});

test('a refused new metric costs only itself: watch time survives a skip-rate rejection', async () => {
  const { nextMetrics } = await import('./instagram.ts');
  const all = ['views', 'comments', 'ig_reels_avg_watch_time', 'reels_skip_rate', 'ig_reels_video_view_total_time'];
  assert.deepEqual(nextMetrics(all, 'Instagram 400 (code 100): … does not support the metrics: reels_skip_rate. Please refer'), [
    'views',
    'comments',
    'ig_reels_avg_watch_time',
    'ig_reels_video_view_total_time',
  ]);
});

test('an unnamed metric error drops the in-development metrics; anything else is not retried', async () => {
  const { nextMetrics } = await import('./instagram.ts');
  const all = ['views', 'comments', 'ig_reels_avg_watch_time', 'reels_skip_rate'];
  assert.deepEqual(nextMetrics(all, 'Instagram 400 (code 100): (#100) metric[3] must be one of the following values'), ['views', 'comments']);
  assert.equal(nextMetrics(all, 'Instagram 400 (code 4): Application request limit reached'), null);
  assert.equal(nextMetrics(all, 'Instagram 400 (code 17): User request limit reached'), null);
  assert.equal(nextMetrics(['views', 'comments'], 'does not support the metrics: nope.'), null);
});
