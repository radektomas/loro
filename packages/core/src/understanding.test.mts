import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spokenCounts, understanding } from './understanding.ts';
import type { Video } from './types.ts';

/** What you understand now — run with `npm test`. */
const video = (lines: string[], dictionary: Video['dictionary'] = {}): Video =>
  ({
    id: 'v',
    creator: 'c',
    level: 'A1',
    src: '',
    cues: lines.map((l) => ({
      start: 0,
      end: 1,
      words: l.split(' ').map((text) => ({ text, start: 0, end: 1 })),
      translations: {},
    })),
    dictionary,
  }) as Video;

describe('spokenCounts', () => {
  it('counts real words across lines, skipping glue and names', () => {
    const counts = spokenCounts([
      video(['Mi esposa y Peppa.', 'La esposa de Juan'], {
        peppa: { lemma: 'peppa', pos: 'noun', note: 'proper noun', glosses: { en: 'Peppa' } },
      }),
    ]);
    assert.equal(counts.get('esposa'), 2);
    assert.equal(counts.has('de'), false);
    assert.equal(counts.has('y'), false);
    assert.equal(counts.has('peppa'), false);
  });
});

describe('understanding', () => {
  const counts = new Map([
    ['esposa', 40],
    ['tiempo', 25],
    ['raro', 3],
  ]);
  const MONDAY = 1_000;

  it('adds up the moments your words are spoken, and what this week added', () => {
    const known = new Map([
      ['tiempo', 500],
      ['esposa', 2_000],
      ['nunca-dicho', 2_000],
    ]);
    assert.deepEqual(understanding(counts, known, MONDAY), {
      moments: 65,
      momentsBefore: 25,
      bestNew: { key: 'esposa', count: 40 },
    });
  });

  it('nothing known: nothing to show', () => {
    assert.deepEqual(understanding(counts, new Map(), MONDAY), { moments: 0, momentsBefore: 0, bestNew: null });
  });
});
