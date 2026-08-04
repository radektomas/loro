import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCatalog,
  initCatalog,
  isCatalogReady,
  onCatalogChanged,
} from './catalog.ts';
import { staticVideos } from './catalog/staticVideos.ts';
import type { Video } from './types.ts';

/**
 * The catalog seam. Unlike every other tested module in core this one holds
 * MODULE STATE, which shapes the whole file:
 *
 *  - The pristine reading is captured at module scope, below, before any test
 *    can call initCatalog. Asserting it inside a test would make the assertion
 *    depend on that test's position in the file.
 *  - The tests that need the un-initialised seam are grouped first and say so.
 *    node --test runs a file's tests in declaration order, and each file gets
 *    its own process, so nothing another test file does can reach this state.
 */

/** The seam as it is before any test touches it — the RN cold-boot reading. */
const RESTING = getCatalog();
const RESTING_READY = isCatalogReady();

const video = (id: string): Video => ({
  id,
  src: `${id}.mp4`,
  poster: '',
  creator: 'test',
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

/** Run `fn` with console.error captured, so a deliberate error path can be
    asserted on instead of just printed into the test output. */
function captureErrors(fn: () => void): string[] {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

describe('catalog seam — before any init', () => {
  it('answers from the bundled seed, not an empty list', () => {
    // THE INVARIANT THE WHOLE SEAM RESTS ON. An empty resting state makes
    // calibration.ts pickGuidedVideo return undefined through a signature that
    // promises a Video, and /welcome's guided intro dereferences it.
    assert.ok(RESTING.length > 0, 'resting catalog must never be empty');
    assert.equal(RESTING, staticVideos);
  });

  it('is not ready', () => {
    // "Ready" means a platform installed a catalog, not "there is something to
    // read" — those are different questions and the seed answers only the
    // second one.
    assert.equal(RESTING_READY, false);
  });
});

describe('initCatalog', () => {
  it('installs the platform catalog and marks the seam ready', () => {
    const list = [video('a'), video('b')];
    initCatalog(list);
    assert.equal(getCatalog(), list);
    assert.equal(isCatalogReady(), true);
  });

  it('replaces a previously installed catalog', () => {
    // The RN background refresh: a newer catalog lands mid-session.
    initCatalog([video('a')]);
    const next = [video('a'), video('b'), video('c')];
    initCatalog(next);
    assert.equal(getCatalog(), next);
  });

  it('hands back the list as given — no copy, no filter', () => {
    // Web behaviour is byte-identical only because the array reference the
    // boot installs is the one every consumer reads.
    const list = [video('a')];
    initCatalog(list);
    assert.equal(getCatalog(), list);
    assert.deepEqual(
      getCatalog().map((v) => v.id),
      ['a']
    );
  });
});

describe('onCatalogChanged', () => {
  it('notifies subscribers when a catalog is installed', () => {
    let fired = 0;
    const off = onCatalogChanged(() => {
      fired++;
    });
    initCatalog([video('a')]);
    assert.equal(fired, 1);
    off();
  });

  it('stops delivering after unsubscribe', () => {
    let fired = 0;
    const off = onCatalogChanged(() => {
      fired++;
    });
    initCatalog([video('a')]);
    off();
    initCatalog([video('b')]);
    assert.equal(fired, 1);
  });

  it('does not notify when the install was refused', () => {
    let fired = 0;
    const off = onCatalogChanged(() => {
      fired++;
    });
    captureErrors(() => initCatalog([]));
    assert.equal(fired, 0);
    off();
  });
});

describe('initCatalog refuses an empty catalog', () => {
  it('keeps the current list rather than installing nothing', () => {
    // A loader bug — a fetch resolving with nothing, a truncated cache file —
    // must not be able to empty the seam. This is the guard that keeps a
    // first-launch fetch failure degraded rather than fatal.
    const installed = [video('a')];
    initCatalog(installed);
    captureErrors(() => initCatalog([]));
    assert.equal(getCatalog(), installed);
    assert.ok(getCatalog().length > 0);
  });

  it('leaves the ready state untouched', () => {
    const before = isCatalogReady();
    captureErrors(() => initCatalog([]));
    assert.equal(isCatalogReady(), before);
  });

  it('reports the refusal instead of swallowing it', () => {
    // Loud, because a silently ignored install looks exactly like a successful
    // one from the caller's side.
    const errors = captureErrors(() => initCatalog([]));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /empty catalog/i);
  });
});

describe('getCatalog — the synchronous contract', () => {
  it('returns an array directly, never a promise', () => {
    // platform.ts states in capitals why this may not become async: the read
    // path runs inside render and inside storage.getSavedWords() on every
    // read. A thenable here would force an app-wide async rewrite.
    initCatalog([video('a')]);
    const result: unknown = getCatalog();
    assert.ok(Array.isArray(result));
    assert.ok(!(result instanceof Promise));
    assert.notEqual(typeof (result as { then?: unknown }).then, 'function');
  });

  it('reflects the latest install immediately, with no await', () => {
    initCatalog([video('a')]);
    assert.deepEqual(
      getCatalog().map((v) => v.id),
      ['a']
    );
    initCatalog([video('b'), video('c')]);
    assert.deepEqual(
      getCatalog().map((v) => v.id),
      ['b', 'c']
    );
  });
});
