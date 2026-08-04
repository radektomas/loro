import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CatalogContentError,
  CatalogFetchError,
  CatalogLoadError,
  fetchCatalogBlob,
  fetchPointer,
  POINTER_PATH,
  resolveCatalog,
  snapshotPath,
  type CatalogFetch,
  type CatalogResponse,
} from './catalogLoader.ts';
import type { Video } from './types.ts';

const BASE = 'https://example.supabase.co/storage/v1/object/public/loro-catalog';
const HASH = '635c07cc2b4d5364';

const video = (id: string): Video => ({
  id,
  src: '',
  poster: '',
  creator: 'Canal',
  author: { kind: 'none' },
  level: 'A1',
  cues: [
    {
      start: 0,
      end: 1,
      words: [{ text: 'hola', start: 0, end: 0.5 }],
      translations: { en: 'hi' },
    },
  ],
  dictionary: {},
});

const pointer = (over: Record<string, unknown> = {}) => ({
  hash: HASH,
  count: 2,
  generatedAt: '2026-08-04T10:00:00.000Z',
  ...over,
});

const ok = (body: unknown): CatalogResponse => ({
  ok: true,
  status: 200,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/**
 * A fetch that answers from a URL -> response map and RECORDS every call, so a
 * test can prove a request was not made — which is the only way to check the
 * "unchanged means no blob download" contract.
 */
function fakeFetch(routes: Record<string, CatalogResponse | (() => never)>) {
  const calls: string[] = [];
  const fetchFn: CatalogFetch = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unrouted fetch: ${url}`);
    if (typeof route === 'function') route();
    return route as CatalogResponse;
  };
  return { fetchFn, calls };
}

const pointerUrl = `${BASE}/${POINTER_PATH}`;
const blobUrl = (hash = HASH) => `${BASE}/${snapshotPath(hash)}`;

/** The standard two-object bucket: a valid pointer and a matching 2-video blob. */
function healthyRoutes(videos: Video[] = [video('a'), video('b')]) {
  return {
    [pointerUrl]: ok(pointer({ count: videos.length })),
    [blobUrl()]: ok(videos),
  };
}

describe('resolveCatalog — happy path', () => {
  it('returns the validated videos and the hash on a cold start', async () => {
    const { fetchFn, calls } = fakeFetch(healthyRoutes());
    const result = await resolveCatalog(fetchFn, BASE, null);

    assert.equal(result.unchanged, false);
    assert.ok(!result.unchanged);
    assert.equal(result.hash, HASH);
    assert.equal(result.videos.length, 2);
    assert.deepEqual(
      result.videos.map((v) => v.id),
      ['a', 'b']
    );
    assert.deepEqual(calls, [pointerUrl, blobUrl()]);
  });

  it('tolerates a trailing slash on the base URL', async () => {
    const { fetchFn } = fakeFetch(healthyRoutes());
    const result = await resolveCatalog(fetchFn, `${BASE}/`, null);
    assert.equal(result.unchanged, false);
  });
});

describe('resolveCatalog — the unchanged path', () => {
  it('returns unchanged and DOES NOT FETCH THE BLOB', async () => {
    // The contract that makes the whole immutable-URL model worth having: a
    // no-op check must cost one small pointer request, never ~0.9MB.
    const { fetchFn, calls } = fakeFetch(healthyRoutes());
    const result = await resolveCatalog(fetchFn, BASE, HASH);

    assert.deepEqual(result, { unchanged: true });
    assert.deepEqual(calls, [pointerUrl]);
    assert.ok(!calls.includes(blobUrl()), 'blob must not be requested');
  });

  it('re-downloads when the cached hash differs', async () => {
    const { fetchFn, calls } = fakeFetch(healthyRoutes());
    const result = await resolveCatalog(fetchFn, BASE, 'an-older-hash');

    assert.ok(!result.unchanged);
    assert.equal(result.hash, HASH);
    assert.deepEqual(calls, [pointerUrl, blobUrl()]);
  });

  it('ignores generatedAt entirely — only the hash decides', async () => {
    // generatedAt is rewritten on every publish even when nothing changed.
    // A client keying on the pointer's BYTES would re-download every time.
    const { fetchFn, calls } = fakeFetch({
      ...healthyRoutes(),
      [pointerUrl]: ok(pointer({ generatedAt: '2099-01-01T00:00:00.000Z' })),
    });
    const result = await resolveCatalog(fetchFn, BASE, HASH);

    assert.deepEqual(result, { unchanged: true });
    assert.deepEqual(calls, [pointerUrl]);
  });

  it('still works when the pointer omits generatedAt', async () => {
    const routes = healthyRoutes();
    routes[pointerUrl] = ok({ hash: HASH, count: 2 });
    const { fetchFn } = fakeFetch(routes);
    assert.deepEqual(await resolveCatalog(fetchFn, BASE, HASH), { unchanged: true });
  });
});

describe('truncation', () => {
  it('throws when the blob is shorter than the pointer says', async () => {
    // The failure the loader exists to catch: a body cut short that still
    // parses as a valid array of valid videos.
    const routes = healthyRoutes();
    routes[pointerUrl] = ok(pointer({ count: 216 }));
    const { fetchFn } = fakeFetch(routes);

    await assert.rejects(
      () => resolveCatalog(fetchFn, BASE, null),
      (error: unknown) => {
        assert.ok(error instanceof CatalogContentError);
        assert.match(error.message, /holds 2 videos, pointer says 216/);
        return true;
      }
    );
  });

  it('throws when the blob is LONGER than the pointer says', async () => {
    const routes = healthyRoutes([video('a'), video('b'), video('c')]);
    routes[pointerUrl] = ok(pointer({ count: 2 }));
    const { fetchFn } = fakeFetch(routes);
    await assert.rejects(() => resolveCatalog(fetchFn, BASE, null), CatalogContentError);
  });

  it('throws on a body cut mid-array, which does not even parse', async () => {
    const routes = healthyRoutes();
    routes[blobUrl()] = ok('[{"id":"a","cues":[],"author":{"kind":"non');
    const { fetchFn } = fakeFetch(routes);
    await assert.rejects(
      () => resolveCatalog(fetchFn, BASE, null),
      (error: unknown) => {
        assert.ok(error instanceof CatalogContentError);
        assert.match(error.message, /not valid JSON/);
        return true;
      }
    );
  });

  it('never returns a partial catalog as success', async () => {
    const routes = healthyRoutes();
    routes[pointerUrl] = ok(pointer({ count: 216 }));
    const { fetchFn } = fakeFetch(routes);
    let resolved: unknown = 'did not resolve';
    try {
      resolved = await resolveCatalog(fetchFn, BASE, null);
    } catch {
      /* expected */
    }
    assert.equal(resolved, 'did not resolve');
  });
});

describe('malformed pointer', () => {
  const rejects = async (body: unknown, pattern: RegExp) => {
    const { fetchFn } = fakeFetch({ [pointerUrl]: ok(body) });
    await assert.rejects(
      () => fetchPointer(fetchFn, BASE),
      (error: unknown) => {
        assert.ok(error instanceof CatalogContentError);
        assert.match(error.message, pattern);
        assert.equal(error.url, pointerUrl);
        return true;
      }
    );
  };

  it('rejects a pointer with no hash', () => rejects({ count: 2 }, /no hash/));
  it('rejects an empty hash', () => rejects(pointer({ hash: '   ' }), /no hash/));
  it('rejects a non-string hash', () => rejects(pointer({ hash: 42 }), /no hash/));
  it('rejects a missing count', () => rejects({ hash: HASH }, /count/));
  it('rejects a non-integer count', () => rejects(pointer({ count: 2.5 }), /count/));
  it('rejects a negative count', () => rejects(pointer({ count: -1 }), /count/));
  it('rejects an array', () => rejects([], /not an object/));
  it('rejects null', () => rejects(null, /not an object/));
  it('rejects unparseable JSON', async () => {
    const { fetchFn } = fakeFetch({ [pointerUrl]: ok('{not json') });
    await assert.rejects(() => fetchPointer(fetchFn, BASE), CatalogContentError);
  });
});

describe('malformed blob', () => {
  const rejects = async (body: unknown, pattern: RegExp) => {
    const { fetchFn } = fakeFetch({ [blobUrl()]: ok(body) });
    await assert.rejects(
      () => fetchCatalogBlob(fetchFn, BASE, HASH, null),
      (error: unknown) => {
        assert.ok(error instanceof CatalogContentError);
        assert.match(error.message, pattern);
        return true;
      }
    );
  };

  it('rejects a non-array snapshot', () => rejects({ videos: [] }, /not an array/));
  it('rejects an empty snapshot', () => rejects([], /empty/));
  it('rejects an entry that is not an object', () => rejects(['nope'], /entry 0 is not an object/));
  it('rejects an entry with no id', () =>
    rejects([{ cues: [], author: { kind: 'none' } }], /entry 0 has no id/));
  it('rejects an entry with an empty id', () =>
    rejects([{ id: ' ', cues: [], author: { kind: 'none' } }], /has no id/));
  it('rejects an entry whose cues are not an array', () =>
    rejects([{ id: 'a', cues: {}, author: { kind: 'none' } }], /"a"\) has no cues array/));
  it('rejects an entry with no author — the AuthorLine crash', () =>
    rejects([{ id: 'a', cues: [] }], /"a"\) has no author\.kind/));
  it('names the offending index in a long list', () =>
    rejects([video('a'), video('b'), { id: 'c', cues: [] }], /entry 2 \("c"\)/));
});

describe('network failures are typed separately from content failures', () => {
  it('throws CatalogFetchError with the status on a non-200', async () => {
    const { fetchFn } = fakeFetch({
      [pointerUrl]: { ok: false, status: 503, text: async () => '' },
    });
    await assert.rejects(
      () => resolveCatalog(fetchFn, BASE, null),
      (error: unknown) => {
        assert.ok(error instanceof CatalogFetchError);
        assert.equal(error.kind, 'fetch');
        assert.equal(error.status, 503);
        assert.equal(error.url, pointerUrl);
        return true;
      }
    );
  });

  it('throws CatalogFetchError with no status when fetch itself throws', async () => {
    const { fetchFn } = fakeFetch({
      [pointerUrl]: () => {
        throw new Error('network down');
      },
    });
    await assert.rejects(
      () => resolveCatalog(fetchFn, BASE, null),
      (error: unknown) => {
        assert.ok(error instanceof CatalogFetchError);
        assert.equal(error.status, undefined);
        assert.equal((error.cause as Error)?.message, 'network down');
        return true;
      }
    );
  });

  it('reports a 404 on the BLOB as a fetch error, not a content one', async () => {
    // The pointer-written-first failure mode: latest.json names a hash whose
    // object is not up yet. Transient by nature — the platform should keep its
    // cache and retry, not treat the publish as corrupt.
    const routes = healthyRoutes();
    routes[blobUrl()] = { ok: false, status: 404, text: async () => '' };
    const { fetchFn } = fakeFetch(routes);
    await assert.rejects(
      () => resolveCatalog(fetchFn, BASE, null),
      (error: unknown) => {
        assert.ok(error instanceof CatalogFetchError);
        assert.equal(error.status, 404);
        assert.equal(error.url, blobUrl());
        return true;
      }
    );
  });

  it('throws a fetch error when the body dies mid-read', async () => {
    const { fetchFn } = fakeFetch({
      [pointerUrl]: {
        ok: true,
        status: 200,
        text: async () => {
          throw new Error('connection reset');
        },
      },
    });
    await assert.rejects(() => resolveCatalog(fetchFn, BASE, null), CatalogFetchError);
  });

  it('lets a caller catch both kinds with one base class', async () => {
    const both = [
      fakeFetch({ [pointerUrl]: { ok: false, status: 500, text: async () => '' } }),
      fakeFetch({ [pointerUrl]: ok({ count: 1 }) }),
    ];
    for (const { fetchFn } of both) {
      await assert.rejects(() => resolveCatalog(fetchFn, BASE, null), CatalogLoadError);
    }
  });

  it('distinguishes the two kinds by a field, not by class alone', async () => {
    // Step 5 branches on this: 'fetch' retries quietly, 'content' must not.
    const net = fakeFetch({ [pointerUrl]: { ok: false, status: 500, text: async () => '' } });
    const bad = fakeFetch({ [pointerUrl]: ok({ hash: HASH }) });

    await assert.rejects(
      () => resolveCatalog(net.fetchFn, BASE, null),
      (e: unknown) => (e as CatalogLoadError).kind === 'fetch'
    );
    await assert.rejects(
      () => resolveCatalog(bad.fetchFn, BASE, null),
      (e: unknown) => (e as CatalogLoadError).kind === 'content'
    );
  });
});
