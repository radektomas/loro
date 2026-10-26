import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountBaseline,
  followerGains,
  hookLine,
  median,
  multipleOf,
  sharesSavesPer1k,
  type MarketingPost,
} from '../../../lib/marketingStats.ts';

const NOW = new Date('2026-10-26T12:00:00Z');

function post(id: string, postedAt: string, views: number | null): MarketingPost {
  return {
    mediaId: id,
    igUserId: 'acct',
    caption: null,
    mediaType: 'VIDEO',
    productType: 'REELS',
    permalink: null,
    thumbnailUrl: null,
    postedAt,
    latest:
      views === null
        ? null
        : { views, reach: null, likes: null, comments: null, shares: null, saved: null, reposts: null, avgWatchMs: null },
    viewsByDay: [],
  };
}

test('median of odd, even and empty lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test('baseline ignores posts under 48h old and posts without views', () => {
  const posts = [
    post('fresh', '2026-10-26T06:00:00Z', 50), // 6h old — still climbing
    post('a', '2026-10-20T10:00:00Z', 1000),
    post('b', '2026-10-18T10:00:00Z', 3000),
    post('c', '2026-10-15T10:00:00Z', 2000),
    post('none', '2026-10-14T10:00:00Z', null),
  ];
  assert.equal(accountBaseline(posts, NOW), 2000);
});

test('baseline uses only the most recent 12 settled posts', () => {
  const old = Array.from({ length: 12 }, (_, i) => post(`old${i}`, `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`, 10));
  const recent = Array.from({ length: 12 }, (_, i) => post(`new${i}`, `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00Z`, 500));
  assert.equal(accountBaseline([...old, ...recent], NOW), 500);
});

test('multiple is null when the baseline is unknown or zero', () => {
  assert.equal(multipleOf(6000, 2000), 3);
  assert.equal(multipleOf(6000, null), null);
  assert.equal(multipleOf(6000, 0), null);
  assert.equal(multipleOf(null, 2000), null);
});

test('shares and saves per 1k views', () => {
  const m = { views: 2000, reach: null, likes: null, comments: null, shares: 6, saved: 4, reposts: null, avgWatchMs: null };
  assert.equal(sharesSavesPer1k(m), 5);
  assert.equal(sharesSavesPer1k({ ...m, views: 0 }), null);
  assert.equal(sharesSavesPer1k(null), null);
});

test('follower gains between consecutive snapshots', () => {
  assert.deepEqual(
    followerGains([
      { day: '2026-10-24', count: 100 },
      { day: '2026-10-25', count: 140 },
      { day: '2026-10-26', count: 138 },
    ]),
    [
      { day: '2026-10-25', gain: 40 },
      { day: '2026-10-26', gain: -2 },
    ]
  );
});

test('hook line is the first non-empty caption line, trimmed to length', () => {
  assert.equal(hookLine('\n  Things to say when you are late \nmore'), 'Things to say when you are late');
  assert.equal(hookLine(null), '');
  assert.equal(hookLine('x'.repeat(100), 10), `${'x'.repeat(9)}…`);
});
