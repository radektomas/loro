import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookKey, hookStats, shortcodeOf, fmtTime, workerView } from '../../../lib/cutReels.ts';

test('hookKey ignores emoji, case and punctuation', () => {
  assert.equal(hookKey('How did you learn Spanish SO FAST? 😭'), hookKey('how did you learn spanish so fast??'));
  assert.notEqual(hookKey('How did you learn Spanish SO FAST?'), hookKey('How did you learn Spanish in ONE month?'));
});

test('shortcodeOf reads reel and post links, with or without a username', () => {
  assert.equal(shortcodeOf('https://www.instagram.com/reel/DQx1_ab-9Z/?igsh=abc'), 'DQx1_ab-9Z');
  assert.equal(shortcodeOf('https://www.instagram.com/loro.app/reel/DQx1/'), 'DQx1');
  assert.equal(shortcodeOf('https://instagram.com/p/C0ff33/'), 'C0ff33');
  assert.equal(shortcodeOf('not a link'), null);
  assert.equal(shortcodeOf(null), null);
});

test('hookStats judges a hook against its own account, not raw views', () => {
  const reels = [
    // big account: median 10k; "A" got 10k (1x)
    { account: 'loro.app', hook: 'A', views: 10000, status: 'posted' },
    { account: 'loro.app', hook: 'C', views: 10000, status: 'posted' },
    { account: 'loro.app', hook: 'C', views: 10000, status: 'posted' },
    // small account: median 1k; "B" got 3k (3x of its account) — fewer views, better hook
    { account: 'radek.spanish', hook: 'B 😭', views: 3000, status: 'posted' },
    { account: 'radek.spanish', hook: 'D', views: 1000, status: 'posted' },
    { account: 'radek.spanish', hook: 'D', views: 500, status: 'posted' },
    // cut but not posted yet, and a dropped one that must not count
    { account: 'radek.spanish', hook: 'E', views: null, status: 'review' },
    { account: 'radek.spanish', hook: 'F', views: null, status: 'dropped' },
  ] as const;
  const s = hookStats(reels.map((r) => ({ ...r })));
  assert.equal(s[0].hook, 'B 😭');
  assert.equal(s[0].avgMultiple, 3);
  assert.deepEqual(s[0].best, { views: 3000, account: 'radek.spanish' });
  assert.equal(s.find((x) => x.hook === 'A')!.avgMultiple, 1);
  const e = s.find((x) => x.hook === 'E')!;
  assert.equal(e.used, 1);
  assert.equal(e.measured, 0);
  assert.equal(e.avgMultiple, null);
  assert.equal(s[s.length - 1].hook, 'E');
  assert.equal(s.find((x) => x.hook === 'F'), undefined);
});

test('fmtTime', () => {
  assert.equal(fmtTime(4.25), '0:04.3');
  assert.equal(fmtTime(0), '0:00.0');
  assert.equal(fmtTime(61), '1:01.0');
});

test('workerView: a chat is watching only while its heartbeat is fresh', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  assert.equal(workerView(null, now), 'offline');
  assert.equal(workerView({ state: 'watching', noteIds: [], at: at(1) }, now), 'watching');
  assert.equal(workerView({ state: 'watching', noteIds: [], at: at(5) }, now), 'offline');
  assert.equal(workerView({ state: 'working', noteIds: ['a'], at: at(10) }, now), 'working');
  assert.equal(workerView({ state: 'working', noteIds: ['a'], at: at(60) }, now), 'offline'); // chat closed mid-recut
});
