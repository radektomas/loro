import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderVideosForLevel } from './feedOrder.ts';
import type { Level, Video } from '@/types';

const video = (id: string, level: Level) => ({ id, level, cues: [] }) as unknown as Video;

/** Deterministic stand-in for Math.random, cycling through fixed values. */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const LIBRARY = [
  video('a1-1', 'A1'),
  video('a2-1', 'A2'),
  video('a2-2', 'A2'),
  video('b1-1', 'B1'),
  video('b2-1', 'B2'),
];

describe('orderVideosForLevel — level proximity', () => {
  it('opens on the user’s own level', () => {
    const out = orderVideosForLevel(LIBRARY, 'A2', { random: seeded([0.5]) });
    assert.ok(out[0].level === 'A2' && out[1].level === 'A2');
  });

  it('puts the furthest level last', () => {
    const out = orderVideosForLevel(LIBRARY, 'A1', { random: seeded([0.5]) });
    assert.equal(out[out.length - 1].level, 'B2');
  });

  it('treats an unknown level as far away, not as the user’s own', () => {
    // indexOf returns -1 for an unrecognised level; for an A1 user that is
    // distance 0 unless handled, which would open the feed on junk data.
    const withJunk = [...LIBRARY, video('junk', 'C9' as Level)];
    const out = orderVideosForLevel(withJunk, 'A1', { random: seeded([0.5]) });
    assert.notEqual(out[0].id, 'junk');
    assert.equal(out[out.length - 1].id, 'junk');
  });
});

describe('orderVideosForLevel — freshness', () => {
  it('puts unseen videos before watched ones', () => {
    const watchedIds = new Set(['a2-1']);
    const out = orderVideosForLevel(LIBRARY, 'A2', {
      watchedIds,
      random: seeded([0.5]),
    });
    assert.equal(out[out.length - 1].id, 'a2-1');
  });

  it('ranks an unseen far-level video above a watched on-level one', () => {
    // Freshness outranks level: a video already watched teaches less than one
    // never seen, whatever its level.
    const out = orderVideosForLevel([video('a2-1', 'A2'), video('b2-1', 'B2')], 'A2', {
      watchedIds: new Set(['a2-1']),
      random: seeded([0.5]),
    });
    assert.equal(out[0].id, 'b2-1');
  });

  it('still orders by level when nothing has been watched', () => {
    const out = orderVideosForLevel(LIBRARY, 'B2', {
      watchedIds: new Set(),
      random: seeded([0.5]),
    });
    assert.equal(out[0].level, 'B2');
  });
});

describe('orderVideosForLevel — randomness', () => {
  it('varies the order between sessions', () => {
    // The actual complaint: the feed opened identically every time because
    // ties kept source order and Array.sort is stable.
    const many = Array.from({ length: 12 }, (_, i) => video(`v${i}`, 'A2'));
    const first = orderVideosForLevel(many, 'A2', { random: seeded([0.1, 0.9, 0.4, 0.7]) });
    const second = orderVideosForLevel(many, 'A2', { random: seeded([0.8, 0.2, 0.6, 0.3]) });
    assert.notDeepEqual(
      first.map((v) => v.id),
      second.map((v) => v.id)
    );
  });

  it('keeps every video exactly once', () => {
    const out = orderVideosForLevel(LIBRARY, 'A2', { random: seeded([0.3, 0.7, 0.1]) });
    assert.equal(out.length, LIBRARY.length);
    assert.equal(new Set(out.map((v) => v.id)).size, LIBRARY.length);
  });

  it('does not mutate the input array', () => {
    const input = [...LIBRARY];
    orderVideosForLevel(input, 'B1', { random: seeded([0.9, 0.1]) });
    assert.deepEqual(
      input.map((v) => v.id),
      LIBRARY.map((v) => v.id)
    );
  });

  it('handles an empty library', () => {
    assert.deepEqual(orderVideosForLevel([], 'A1', { random: seeded([0.5]) }), []);
  });
});
