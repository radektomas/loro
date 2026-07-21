import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estimateLevel, speechRate } from './estimateLevel.mts';
import type { CueOut } from './json3ToCues.mts';

/** A cue spanning `seconds` and containing `n` words. */
function cue(n: number, start: number, seconds: number): CueOut {
  return {
    start,
    end: start + seconds,
    text: 'x '.repeat(n).trim(),
    translation: '',
    words: Array.from({ length: n }, (_, i) => ({
      surface: 'x',
      start: start + (i * seconds) / n,
      end: start + ((i + 1) * seconds) / n,
    })),
  } as unknown as CueOut;
}

describe('speechRate', () => {
  it('measures over speech time, not wall-clock', () => {
    // 60 words in 20s of talking = 180 wpm, even if the clip is minutes long.
    assert.equal(speechRate([cue(30, 0, 10), cue(30, 100, 10)]), 180);
  });

  it('returns null when there are too few words to be meaningful', () => {
    assert.equal(speechRate([cue(5, 0, 2)]), null);
  });

  it('returns null rather than dividing by zero on degenerate cues', () => {
    assert.equal(speechRate([cue(20, 0, 0)]), null);
    assert.equal(speechRate([]), null);
  });
});

describe('estimateLevel', () => {
  const at = (wpm: number) => estimateLevel([cue(wpm, 0, 60)]);

  it('separates slow, normal and rapid delivery', () => {
    assert.equal(at(96), 'A1');
    assert.equal(at(139), 'A2');
    assert.equal(at(188), 'B1');
    assert.equal(at(237), 'B2');
  });

  it('places band edges on the lower band', () => {
    assert.equal(at(119), 'A1');
    assert.equal(at(120), 'A2');
    assert.equal(at(164), 'A2');
    assert.equal(at(165), 'B1');
    assert.equal(at(209), 'B1');
    assert.equal(at(210), 'B2');
  });

  it('falls back rather than guessing when unmeasurable', () => {
    // Was a hardcoded 'A2' for every video; the fallback is now the only
    // place that constant survives, and only when there is nothing to rate.
    assert.equal(estimateLevel([]), 'A2');
    assert.equal(estimateLevel([cue(3, 0, 1)]), 'A2');
  });
});
