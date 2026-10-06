import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFeedScores, rankFeed, type FeedScores } from './feedRank.ts';

/** The ranked feed — run with `npm test`. */
const vids = (ids: string[]) => ids.map((id) => ({ id }));

/** A seeded generator, so a thousand shuffles are repeatable. */
function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe('rankFeed', () => {
  const scores: FeedScores = { scores: { good: 0.7, mid: 0.4, bad: 0.05 }, benched: ['awful'], prior: 0.4 };

  it('never shows a seen video while an unseen one is left', () => {
    const order = rankFeed(vids(['good', 'mid', 'bad', 'new']), { watchedIds: new Set(['good']), scores, random: seeded(3) });
    assert.equal(order[order.length - 1].id, 'good');
  });

  it('puts benched videos after everything, even after seen ones', () => {
    const order = rankFeed(vids(['awful', 'good', 'mid']), { watchedIds: new Set(['good', 'mid']), scores, random: seeded(5) });
    assert.equal(order[order.length - 1].id, 'awful');
  });

  it('leads with good videos far more often than bad ones, but not always', () => {
    const random = seeded(11);
    let goodFirst = 0;
    let badFirst = 0;
    for (let i = 0; i < 1000; i++) {
      const first = rankFeed(vids(['good', 'bad']), { scores, random })[0].id;
      if (first === 'good') goodFirst++;
      else badFirst++;
    }
    assert.ok(goodFirst > 800, `good first ${goodFirst}/1000`);
    assert.ok(badFirst > 0, 'the order is still a shuffle');
  });

  it('gives a video with no data the average, so new content gets shown', () => {
    const random = seeded(7);
    let newBeforeBad = 0;
    for (let i = 0; i < 500; i++) {
      const order = rankFeed(vids(['bad', 'fresh']), { scores, random }).map((v) => v.id);
      if (order[0] === 'fresh') newBeforeBad++;
    }
    assert.ok(newBeforeBad > 300);
  });
});

describe('parseFeedScores', () => {
  it('reads a published file and drops junk', () => {
    const parsed = parseFeedScores({
      scores: { a: 0.5, b: 'x' },
      benched: ['c', 3],
      prior: 0.3,
      topics: { a: ['food', 7], b: 'travel' },
    });
    assert.deepEqual(parsed, { scores: { a: 0.5 }, benched: ['c'], prior: 0.3, topics: { a: ['food'] } });
  });

  it('treats anything malformed as no scores', () => {
    assert.equal(parseFeedScores(null), null);
    assert.equal(parseFeedScores({ nope: 1 }), null);
  });
});

describe('rankFeed — for you', () => {
  it('leans toward the liked topics without dropping the rest', () => {
    const videos = Array.from({ length: 40 }, (_, i) => ({ id: `v${i}` }));
    const scores = {
      scores: {},
      benched: [],
      prior: 0.5,
      topics: Object.fromEntries(videos.slice(0, 20).map((v) => [v.id, ['food']])),
    };
    let foodFirst = 0;
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let run = 0; run < 200; run++) {
      const top = rankFeed(videos, { scores, liked: new Set(['food']), random }).slice(0, 10);
      foodFirst += top.filter((v) => Number(v.id.slice(1)) < 20).length;
    }
    const share = foodFirst / 2000;
    assert.ok(share > 0.6 && share < 0.9, `food share in the top 10 was ${share}`);
    assert.equal(rankFeed(videos, { scores, liked: new Set(['food']), random }).length, 40);
  });
});
