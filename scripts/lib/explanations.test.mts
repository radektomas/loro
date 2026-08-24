import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WordExplanation } from '../../packages/core/src/explanations.ts';
import {
  batchSlices,
  findProblem,
  lemmaUniverse,
  mergeBatches,
  type CatalogEntryLike,
  type ExplanationBatch,
} from './explanations.mts';

/** Two tiny videos whose dictionaries yield the universe [casa, perro]. */
const videos: CatalogEntryLike[] = [
  {
    id: 'v1',
    cues: [
      { words: [{ text: 'el' }, { text: 'perro' }] },
      { words: [{ text: 'una' }, { text: 'casa' }] },
    ],
    dictionary: {
      perro: { lemma: 'perro', pos: 'noun' },
      casa: { lemma: 'casa', pos: 'noun' },
    },
  },
  {
    id: 'v2',
    cues: [{ words: [{ text: 'perros' }] }],
    dictionary: { perros: { lemma: 'perro', pos: 'noun' } },
  },
];

const entry = (lemma: string, over: Partial<WordExplanation> = {}): WordExplanation => ({
  lemma,
  pos: 'noun',
  usage: { en: 'u', cs: 'u', de: 'u', fr: 'u' },
  grammar: null,
  register: 'neutral',
  examples: [{ videoId: 'v1', cueIndex: lemma === 'perro' ? 0 : 1 }],
  ...over,
});

const goodBatch = (): ExplanationBatch => ({
  schemaVersion: 1,
  batch: 0,
  lemmas: ['casa', 'perro'],
  entries: { casa: entry('casa'), perro: entry('perro') },
});

const asMap = (...batches: ExplanationBatch[]) =>
  new Map(batches.map((b) => [b.batch, b]));

describe('lemmaUniverse / batchSlices', () => {
  it('is the sorted distinct lemma set across all dictionaries', () => {
    assert.deepEqual(lemmaUniverse(videos), ['casa', 'perro']);
  });
  it('slices deterministically', () => {
    const universe = Array.from({ length: 250 }, (_, i) => `w${String(i).padStart(3, '0')}`);
    const slices = batchSlices(universe);
    assert.deepEqual(slices.map((s) => s.length), [100, 100, 50]);
  });
});

describe('findProblem', () => {
  it('accepts a complete, correct batch set', () => {
    assert.equal(findProblem(asMap(goodBatch()), videos), null);
  });

  it('reports a missing batch by file name', () => {
    assert.match(findProblem(new Map(), videos)!, /batch-000\.json/);
  });

  it('rejects a slice that drifted from the universe', () => {
    const batch = goodBatch();
    batch.lemmas = ['casa', 'gato'];
    batch.entries = { casa: entry('casa'), gato: entry('gato') };
    assert.match(findProblem(asMap(batch), videos)!, /does not match the universe/);
  });

  it('rejects a missing language and an incomplete grammar record', () => {
    const missingLang = goodBatch();
    missingLang.entries.perro = entry('perro', {
      usage: { en: 'u', cs: 'u', de: 'u' } as never,
    });
    assert.match(findProblem(asMap(missingLang), videos)!, /usage\.fr/);

    const halfGrammar = goodBatch();
    halfGrammar.entries.perro = entry('perro', {
      grammar: { en: 'g', cs: 'g', de: 'g' } as never,
    });
    assert.match(findProblem(asMap(halfGrammar), videos)!, /grammar\.fr/);
  });

  it('rejects a dangling example and a cue that does not speak the lemma', () => {
    const dangling = goodBatch();
    dangling.entries.perro = entry('perro', {
      examples: [{ videoId: 'nope', cueIndex: 0 }],
    });
    assert.match(findProblem(asMap(dangling), videos)!, /unknown video/);

    const wrongCue = goodBatch();
    wrongCue.entries.perro = entry('perro', {
      examples: [{ videoId: 'v1', cueIndex: 1 }], // cue 1 speaks "casa"
    });
    assert.match(findProblem(asMap(wrongCue), videos)!, /does not speak/);
  });

  it('resolves surfaces through the dictionary — "perros" counts for perro', () => {
    const viaPlural = goodBatch();
    viaPlural.entries.perro = entry('perro', {
      examples: [{ videoId: 'v2', cueIndex: 0 }],
    });
    assert.equal(findProblem(asMap(viaPlural), videos), null);
  });
});

describe('mergeBatches', () => {
  it('merges to one sorted record', () => {
    const merged = mergeBatches(asMap(goodBatch()));
    assert.deepEqual(Object.keys(merged), ['casa', 'perro']);
    assert.equal(merged.perro.lemma, 'perro');
  });
});
