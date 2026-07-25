import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_PROGRESS,
  mergeProgress,
  rowToSnapshot,
  sameProgress,
  type ProgressSnapshot,
} from './progressSync.ts';

const snap = (p: Partial<ProgressSnapshot>): ProgressSnapshot => ({
  ...EMPTY_PROGRESS,
  ...p,
});

describe('mergeProgress', () => {
  test('day and video sets union; days stay sorted', () => {
    const merged = mergeProgress(
      snap({ recallDays: ['2026-07-20', '2026-07-24'], watchedIds: ['a', 'b'] }),
      snap({ recallDays: ['2026-07-22', '2026-07-20'], watchedIds: ['b', 'c'] })
    );
    assert.deepEqual(merged.recallDays, ['2026-07-20', '2026-07-22', '2026-07-24']);
    assert.deepEqual([...merged.watchedIds].sort(), ['a', 'b', 'c']);
  });

  test('level: further-along side wins; a fresh device cannot regress it', () => {
    const remote = snap({ levelState: { level: 3, meter: 40 } });
    // Fresh device: levelState null (never touched) — remote must win.
    assert.deepEqual(
      mergeProgress(EMPTY_PROGRESS, remote).levelState,
      { level: 3, meter: 40 }
    );
    // Lower local level loses; higher meter at the same level wins.
    assert.deepEqual(
      mergeProgress(snap({ levelState: { level: 2, meter: 90 } }), remote).levelState,
      { level: 3, meter: 40 }
    );
    assert.deepEqual(
      mergeProgress(snap({ levelState: { level: 3, meter: 70 } }), remote).levelState,
      { level: 3, meter: 70 }
    );
  });

  test('merging with empty is identity', () => {
    const s = snap({
      recallDays: ['2026-07-24'],
      watchedIds: ['x'],
      levelState: { level: 2, meter: 10 },
    });
    assert.ok(sameProgress(mergeProgress(s, EMPTY_PROGRESS), s));
    assert.ok(sameProgress(mergeProgress(EMPTY_PROGRESS, s), s));
  });
});

describe('rowToSnapshot', () => {
  test('null row and malformed jsonb degrade to empty, never throw', () => {
    assert.deepEqual(rowToSnapshot(null), EMPTY_PROGRESS);
    const mangled = rowToSnapshot({
      user_id: 'u',
      recall_days: 'not-an-array',
      watched_ids: [1, 'ok', null],
      level_state: { level: 'high' },
    });
    assert.deepEqual(mangled.recallDays, []);
    assert.deepEqual(mangled.watchedIds, ['ok']);
    assert.equal(mangled.levelState, null);
  });

  test('dedupes and sorts what the row carries', () => {
    const s = rowToSnapshot({
      user_id: 'u',
      recall_days: ['2026-07-24', '2026-07-20', '2026-07-24'],
      watched_ids: ['a', 'a'],
      level_state: { level: 2, meter: 55 },
    });
    assert.deepEqual(s.recallDays, ['2026-07-20', '2026-07-24']);
    assert.deepEqual(s.watchedIds, ['a']);
    assert.deepEqual(s.levelState, { level: 2, meter: 55 });
  });
});

describe('sameProgress', () => {
  test('detects the no-new-local case that skips the push', () => {
    const a = snap({ recallDays: ['2026-07-24'], watchedIds: ['a'] });
    assert.ok(sameProgress(a, snap({ recallDays: ['2026-07-24'], watchedIds: ['a'] })));
    assert.ok(!sameProgress(a, snap({ recallDays: ['2026-07-24'], watchedIds: ['a', 'b'] })));
    assert.ok(!sameProgress(a, snap({ recallDays: [], watchedIds: ['a'] })));
    assert.ok(
      !sameProgress(a, snap({ ...a, levelState: { level: 1, meter: 0 } }))
    );
  });
});
