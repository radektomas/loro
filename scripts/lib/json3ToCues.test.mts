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

/**
 * THE LATE TAIL — YouTube's recogniser stamps an utterance's last word at
 * the end of the silence after it (see snapLateTails). Timings below mirror
 * "El loro Polly" 55–60s: "Venid a" at pace, "verlo" three seconds late.
 */
describe('snapLateTails', () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end });

  it('moves a late sentence tail to right after its predecessor, and keeps it in the cue', async () => {
    const { snapLateTails, groupIntoCues } = await import('./json3ToCues.mts');
    const words = [w('Venid', 55.4, 55.88), w('a', 55.88, 56.1), w('verlo.', 58.92, 59.52), w('Hola.', 60.76, 61.2)];
    const { words: out, snapped } = snapLateTails(words);
    assert.equal(snapped, 1);
    assert.equal(out[2].start, 56.15);
    assert.ok(out[2].end <= 56.75);
    assert.equal(out[3].start, 60.76, 'a word after a full stop is a new utterance');
    const cues = groupIntoCues(words);
    const tail = cues.find((c) => c.words.some((x) => x.text === 'verlo.'))!;
    assert.ok(tail.words.some((x) => x.text === 'Venid'), 'the tail stays with its sentence');
    assert.notEqual(tail.words[0].text, 'verlo.', 'no cue opens on a sentence tail');
  });

  it('leaves a pause after a comma alone — a repeated call is real', async () => {
    const { snapLateTails } = await import('./json3ToCues.mts');
    const words = [w('George,', 295.28, 295.88), w('George,', 298.92, 299.4), w('¿qué', 299.44, 299.6), w('pasa?', 299.8, 300.2)];
    assert.equal(snapLateTails(words).snapped, 0);
  });

  it('does nothing on a bare track — without punctuation no gap is provably inside a sentence', async () => {
    const { snapLateTails } = await import('./json3ToCues.mts');
    const words = [w('venid', 55.4, 55.88), w('a', 55.88, 56.1), w('verlo', 58.92, 59.52)];
    assert.equal(snapLateTails(words).snapped, 0);
  });
});
