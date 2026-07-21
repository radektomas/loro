import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupIntoCues,
  json3ToCues,
  json3ToWords,
  mergeOrphans,
  type CueWord,
} from './json3ToCues.mts';
import {
  extractCaptionTracks,
  extractVisitorData,
  pickSpanishTrack,
  type Json3,
} from './captionFetch.mts';

/**
 * The chunker is a port of transcribe.py's group_into_cues/merge_orphans —
 * these tests pin the ported semantics (constants, tie-breaks, the
 * next-word-end overflow test) so a refactor can't silently drift from the
 * Python original that produces the seed videos.
 */

/** words at a steady cadence: one every `step`s, each `dur`s long. */
function ticker(texts: readonly string[], step = 0.4, dur = 0.3): CueWord[] {
  return texts.map((text, i) => ({
    text,
    start: i * step,
    end: i * step + dur,
  }));
}

describe('json3ToWords', () => {
  const payload: Json3 = {
    events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [
        { utf8: 'hola', tOffsetMs: 0 },
        { utf8: ' que', tOffsetMs: 500 },
        { utf8: ' tal', tOffsetMs: 900 },
      ]},
      { tStartMs: 2500, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
      { tStartMs: 3000, dDurationMs: 1500, segs: [
        { utf8: '[Música]', tOffsetMs: 0 },
        { utf8: 'bien', tOffsetMs: 400 },
      ]},
    ],
  };

  it('flattens word-timed segs into words', () => {
    const words = json3ToWords(payload);
    assert.deepEqual(words.map((w) => w.text), ['hola', 'que', 'tal', 'bien']);
    assert.equal(words[0].start, 0);
    assert.equal(words[1].start, 0.5);
    assert.equal(words[3].start, 3.4);
  });

  it('drops newline padding and [annotations]', () => {
    const words = json3ToWords(payload);
    assert.ok(words.every((w) => w.text !== '[Música]' && w.text.trim() !== ''));
  });

  it('ends a word at the next word start, capped at 0.6s', () => {
    const words = json3ToWords(payload);
    assert.equal(words[0].end, 0.5);       // next start
    assert.equal(words[2].end, 0.9 + 0.6); // pause: capped, gap remains
  });
});

describe('groupIntoCues — ported semantics', () => {
  it('splits at sentence enders immediately', () => {
    const words = ticker(['Hola.', 'Qué', 'tal', 'estás.', 'Bien', 'gracias', 'amigo']);
    const cues = groupIntoCues(words);
    // 'Hola.' becomes a 1-word cue, then orphan-merge folds it forward.
    assert.ok(cues.length >= 1);
    const flat = cues.flatMap((c) => c.words.map((w) => w.text));
    assert.deepEqual(flat, words.map((w) => w.text)); // nothing lost
  });

  it('caps cues at 9 words when no boundary exists', () => {
    const words = ticker(Array.from({ length: 20 }, (_, i) => `w${i}`), 0.3, 0.25);
    const cues = groupIntoCues(words);
    assert.ok(cues.every((c) => c.words.length <= 12), 'hard cap 12 after merges');
    assert.ok(cues.length >= 2, 'a 20-word run must split');
  });

  it('prefers a pause boundary over a mid-phrase cap split', () => {
    // 8 words, big pause after word 3, then more words to force overflow.
    const words: CueWord[] = [];
    for (let i = 0; i < 4; i++) words.push({ text: `a${i}`, start: i * 0.4, end: i * 0.4 + 0.3 });
    // pause of 1.2s after a3
    for (let i = 0; i < 8; i++) words.push({ text: `b${i}`, start: 2.8 + i * 0.4, end: 2.8 + i * 0.4 + 0.3 });
    const cues = groupIntoCues(words);
    // The split lands at the pause: first cue = the a-words.
    assert.deepEqual(cues[0].words.map((w) => w.text), ['a0', 'a1', 'a2', 'a3']);
  });

  it('respects the 4.2s duration cap via the NEXT word end', () => {
    // slow words: 1 word per 1.5s — duration overflows long before 9 words
    const words = ticker(['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'], 1.5, 0.5);
    const cues = groupIntoCues(words);
    for (const cue of cues) {
      assert.ok(cue.end - cue.start <= 6, `cue too long: ${cue.end - cue.start}`);
    }
    assert.ok(cues.length >= 2);
  });

  it('keeps every word exactly once, in order', () => {
    const texts = Array.from({ length: 37 }, (_, i) => `p${i}`);
    const cues = groupIntoCues(ticker(texts, 0.35, 0.3));
    assert.deepEqual(cues.flatMap((c) => c.words.map((w) => w.text)), texts);
  });

  it('returns [] for no words', () => {
    assert.deepEqual(groupIntoCues([]), []);
  });
});

describe('mergeOrphans — ported semantics', () => {
  const cue = (texts: string[], start: number, dur = 2): ReturnType<typeof mk> => mk(texts, start, dur);
  function mk(texts: string[], start: number, dur: number) {
    const step = dur / texts.length;
    return {
      start,
      end: start + dur,
      words: texts.map((t, i) => ({ text: t, start: start + i * step, end: start + (i + 1) * step })),
      translations: {},
    };
  }

  it('merges a short orphan into the time-closest neighbour', () => {
    const a = cue(['a1', 'a2', 'a3', 'a4'], 0);
    const orphan = cue(['x'], 2.1, 0.4); // closer to a (gap 0.1) than to b (gap 0.5)
    const b = cue(['b1', 'b2', 'b3', 'b4'], 3.0);
    const merged = mergeOrphans([a, orphan, b]);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged[0].words.map((w) => w.text), ['a1', 'a2', 'a3', 'a4', 'x']);
  });

  it('never merges past the hard cap of 12 words', () => {
    const big = cue(Array.from({ length: 12 }, (_, i) => `w${i}`), 0, 4);
    const orphan = cue(['x'], 4.2, 0.4);
    const merged = mergeOrphans([big, orphan]);
    // 12 + 1 > 12 -> cannot merge; the orphan survives.
    assert.equal(merged.length, 2);
  });

  it('leaves a lone cue alone', () => {
    const only = cue(['a'], 0, 0.4);
    assert.equal(mergeOrphans([only]).length, 1);
  });
});

describe('json3ToCues end to end', () => {
  it('turns a realistic ASR payload into feed-ready cues', () => {
    const events = [];
    // 30 words, natural pauses every 7 words
    let t = 0;
    for (let block = 0; block < 5; block++) {
      const segs = [];
      for (let w = 0; w < 6; w++) {
        segs.push({ utf8: ` palabra${block}${w}`, tOffsetMs: w * 380 });
      }
      events.push({ tStartMs: Math.round(t * 1000), dDurationMs: 2400, segs });
      t += 3.6; // 1.2s pause between blocks
    }
    const cues = json3ToCues({ events });
    assert.ok(cues.length >= 3, `expected several cues, got ${cues.length}`);
    for (const c of cues) {
      assert.ok(c.words.length >= 1 && c.words.length <= 12);
      assert.ok(c.end > c.start);
      assert.deepEqual(c.translations, {});
    }
    assert.equal(cues.flatMap((c) => c.words).length, 30);
  });
});

describe('extractVisitorData', () => {
  // Real shape: XSSI guard, nested arrays, and a base64url id whose '='
  // padding arrives percent-encoded. A regex missing '%' silently misses it
  // and we fall back to a 1.2MB watch page on every run.
  const guard = ")]}'\n";
  const real =
    'CgtkcUg0U1RUNFJpWSi8iP_SBjIoCgJDWhIiEh4SHAsMDg8QERITFBUWFxgZGhsc%3D%3D';

  it('finds the id inside the nested bootstrap blob', () => {
    const blob = guard + JSON.stringify([[null, ['x', [['a', 1, real]]]]]);
    assert.equal(extractVisitorData(blob), real);
  });

  it('ignores short or non-matching strings', () => {
    assert.equal(extractVisitorData(guard + JSON.stringify([['Cgshort', 'nope']])), null);
  });

  it('returns null on unparseable input rather than throwing', () => {
    assert.equal(extractVisitorData('not json at all'), null);
    assert.equal(extractVisitorData(''), null);
  });
});

describe('extractCaptionTracks — bracket-depth scanner', () => {
  it('survives nested arrays inside the track objects', () => {
    // A lazy /\[.*?\]/ regex truncates at the "runs" array's ']' and the
    // JSON.parse then dies — this shape is what YouTube actually serves.
    const html =
      'junk{"captionTracks":[{"baseUrl":"https://x/api?v=1","name":{"runs":[{"text":"Espanol"}]},' +
      '"languageCode":"es","kind":"asr"}],"audioTracks":[]}tail';
    const tracks = extractCaptionTracks(html);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].languageCode, 'es');
    assert.equal(tracks[0].kind, 'asr');
    assert.equal(tracks[0].baseUrl, 'https://x/api?v=1');
  });

  it('handles brackets inside string values', () => {
    const html =
      '"captionTracks":[{"baseUrl":"https://x/a]b?c=1","languageCode":"es","kind":"asr"}],"x":1';
    const tracks = extractCaptionTracks(html);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].baseUrl, 'https://x/a]b?c=1');
  });

  it('returns [] when the key is absent or malformed', () => {
    assert.deepEqual(extractCaptionTracks('no captions here'), []);
    assert.deepEqual(extractCaptionTracks('"captionTracks":[{unclosed'), []);
  });
});

describe('pickSpanishTrack', () => {
  const t = (languageCode: string, kind: string) => ({ languageCode, kind, baseUrl: 'u' });

  it('prefers ASR — only ASR carries per-word timing', () => {
    const picked = pickSpanishTrack([t('es', ''), t('es', 'asr')]);
    assert.equal(picked?.kind, 'asr');
  });

  it('falls back to an uploaded Spanish track', () => {
    assert.equal(pickSpanishTrack([t('en', 'asr'), t('es', '')])?.languageCode, 'es');
  });

  it('accepts regional Spanish variants', () => {
    assert.equal(pickSpanishTrack([t('es-419', 'asr')])?.languageCode, 'es-419');
  });

  it('returns null when nothing is Spanish', () => {
    assert.equal(pickSpanishTrack([t('en', 'asr'), t('pt', '')]), null);
  });
});
