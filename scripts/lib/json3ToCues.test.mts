import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { multiWordTokenShare, type CueOut } from './json3ToCues.mts';

/**
 * The word-timing guard — run with `npm test`.
 *
 * multiWordTokenShare is what publish-embeds thresholds on (>0.1 rejects as
 * captions_no_word_timing). The fixtures mirror the two shapes found live:
 * an ASR track whose segs are words with the occasional glued pair, and the
 * Mi Coreana track (1qrp5PogzhU) whose segs were whole subtitle lines.
 */

function cue(...texts: string[]): CueOut {
  return {
    start: 0,
    end: texts.length,
    words: texts.map((text, i) => ({ text, start: i, end: i + 1 })),
    translations: {},
  };
}

describe('multiWordTokenShare', () => {
  it('is 0 for a word-timed track', () => {
    assert.equal(
      multiWordTokenShare([cue('perdió', 'la', 'salida'), cue('en', 'buceo')]),
      0
    );
  });

  it('counts the stray glued pair without condemning the video', () => {
    // One "el continente" in 10 tokens — the healthy-ASR shape, which the
    // publish threshold (>0.1) must let through.
    const share = multiWordTokenShare([
      cue('cruzó', 'el continente', 'entero', 'sin', 'parar'),
      cue('y', 'nadie', 'lo', 'vio', 'llegar'),
    ]);
    assert.equal(share, 0.1);
  });

  it('flags a line-timed track well past the threshold', () => {
    // The Mi Coreana shape: every seg a whole sentence.
    const share = multiWordTokenShare([
      cue('Un día en Corea salí de fiesta con una amiga', 'Después ella volvió a su casa'),
      cue('Pero...', 'Alguien me despertó'),
    ]);
    assert.equal(share, 0.75);
  });

  it('ignores surrounding whitespace when deciding what is a line', () => {
    assert.equal(multiWordTokenShare([cue(' hola ', 'amigo')]), 0);
  });

  it('is 0 for no cues at all', () => {
    assert.equal(multiWordTokenShare([]), 0);
  });
});
