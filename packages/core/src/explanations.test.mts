import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CatalogContentError,
  CatalogFetchError,
  type CatalogFetch,
} from './catalogLoader.ts';
import {
  fetchExplanationsBlob,
  fetchExplanationsPointer,
  type WordExplanation,
} from './explanations.ts';

const BASE = 'https://bucket.example';

const entry = (lemma: string, over: Partial<WordExplanation> = {}): WordExplanation => ({
  lemma,
  pos: 'noun',
  usage: { en: 'u', cs: 'u', de: 'u', fr: 'u' },
  grammar: null,
  register: 'neutral',
  examples: [{ videoId: 'v1', cueIndex: 0 }],
  ...over,
});

/** A fake fetch serving canned bodies by URL suffix. */
function serve(bodies: Record<string, unknown>): CatalogFetch {
  return async (url: string) => {
    for (const [suffix, body] of Object.entries(bodies)) {
      if (url.endsWith(suffix)) {
        return {
          ok: true,
          status: 200,
          text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
        };
      }
    }
    return { ok: false, status: 404, text: async () => '' };
  };
}

describe('fetchExplanationsPointer', () => {
  it('reads the sibling pointer path', async () => {
    const pointer = await fetchExplanationsPointer(
      serve({ 'explanations/latest.json': { hash: 'abc', count: 2, generatedAt: '' } }),
      BASE
    );
    assert.deepEqual([pointer.hash, pointer.count], ['abc', 2]);
  });

  it('a missing pointer is a transient fetch error', async () => {
    await assert.rejects(
      fetchExplanationsPointer(serve({}), BASE),
      CatalogFetchError
    );
  });
});

describe('fetchExplanationsBlob', () => {
  const blob = { perro: entry('perro'), casa: entry('casa') };

  it('returns a validated record on the happy path', async () => {
    const got = await fetchExplanationsBlob(
      serve({ 'explanations/abc.json': blob }),
      BASE,
      'abc',
      2
    );
    assert.equal(got.perro.lemma, 'perro');
  });

  it('rejects a count mismatch as truncation', async () => {
    await assert.rejects(
      fetchExplanationsBlob(serve({ 'explanations/abc.json': blob }), BASE, 'abc', 3),
      (e: Error) => e instanceof CatalogContentError && /truncated/.test(e.message)
    );
  });

  it('rejects a missing language', async () => {
    const bad = { perro: entry('perro', { usage: { en: 'u', cs: 'u', de: 'u' } as never }) };
    await assert.rejects(
      fetchExplanationsBlob(serve({ 'explanations/abc.json': bad }), BASE, 'abc', 1),
      (e: Error) => e instanceof CatalogContentError && /missing "fr"/.test(e.message)
    );
  });

  it('rejects a key/lemma mismatch and malformed examples', async () => {
    await assert.rejects(
      fetchExplanationsBlob(
        serve({ 'explanations/abc.json': { perro: entry('gato') } }),
        BASE,
        'abc',
        1
      ),
      /does not match its key/
    );
    const badExample = { perro: entry('perro', { examples: [{ videoId: 'v', cueIndex: -1 }] }) };
    await assert.rejects(
      fetchExplanationsBlob(serve({ 'explanations/abc.json': badExample }), BASE, 'abc', 1),
      /malformed example/
    );
  });

  it('rejects non-object and empty blobs', async () => {
    await assert.rejects(
      fetchExplanationsBlob(serve({ 'explanations/abc.json': [] }), BASE, 'abc', null),
      /not an object/
    );
    await assert.rejects(
      fetchExplanationsBlob(serve({ 'explanations/abc.json': {} }), BASE, 'abc', null),
      /empty/
    );
  });
});
