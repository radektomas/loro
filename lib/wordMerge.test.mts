import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SavedWord } from '../types/index.ts';
import {
  foldDuplicateWords,
  localAhead,
  mergePrefer,
  mergeSum,
  mergeWordSets,
  wordKey,
} from './wordMerge.ts';

/** A saved word with sane defaults, overridable per test. */
function word(overrides: Partial<SavedWord> & Pick<SavedWord, 'text' | 'videoId'>): SavedWord {
  return {
    translation: 'x',
    cueIndex: 0,
    state: 'learning',
    box: 1,
    dueAt: 1_000,
    correct: 0,
    incorrect: 0,
    lastReviewedAt: null,
    savedAt: 500,
    ...overrides,
  };
}

describe('mergeWordSets — the anonymous -> signed-in merge', () => {
  it('all words land: local-only, remote-only and common all present, none duplicated', () => {
    const local = [
      word({ text: 'hola', videoId: 'v1', box: 2, correct: 3 }),
      word({ text: 'perro', videoId: 'v1' }), // local-only
    ];
    const remote = [
      word({ text: 'hola', videoId: 'v1', box: 4, correct: 5 }), // common
      word({ text: 'gato', videoId: 'v2' }), // remote-only (another device)
    ];
    const merged = mergeWordSets(local, remote);

    assert.equal(merged.length, 3);
    const keys = merged.map((w) => wordKey(w.text, w.videoId));
    assert.equal(new Set(keys).size, keys.length, 'one row per (text, video) key');
    // One entry per key is what makes the batched upsert (onConflict on the
    // table's unique constraint) unable to write duplicates.
  });

  it('review history is preserved and SUMMED for common words; higher box wins', () => {
    const local = [
      word({ text: 'hola', videoId: 'v1', box: 2, correct: 3, incorrect: 1, savedAt: 100, lastReviewedAt: 2_000 }),
    ];
    const remote = [
      word({ text: 'hola', videoId: 'v1', box: 4, correct: 5, incorrect: 2, savedAt: 900, lastReviewedAt: 1_500 }),
    ];
    const [m] = mergeWordSets(local, remote);
    assert.equal(m.box, 4, 'higher box keeps its schedule');
    assert.equal(m.correct, 8, 'independent histories sum');
    assert.equal(m.incorrect, 3);
    assert.equal(m.savedAt, 100, 'earliest save kept');
    assert.equal(m.lastReviewedAt, 2_000, 'latest review kept');
  });

  it('a fresh box-0 local save can never clobber a mastered remote word', () => {
    const [m] = mergeWordSets(
      [word({ text: 'hola', videoId: 'v1', box: 0 })],
      [word({ text: 'hola', videoId: 'v1', box: 6, state: 'known' })]
    );
    assert.equal(m.box, 6);
    assert.equal(m.state, 'known');
  });

  it('folds duplicate remote rows identically in both fetch orders', () => {
    const a = word({ text: 'hola', videoId: 'v1', cueIndex: 2, box: 3, correct: 5, incorrect: 1, savedAt: 100, lastReviewedAt: 2_000 });
    const b = word({ text: 'hola', videoId: 'v1', cueIndex: 7, box: 1, correct: 2, incorrect: 3, savedAt: 900, lastReviewedAt: 3_000 });
    const other = word({ text: 'gato', videoId: 'v2' });

    const fold1 = foldDuplicateWords([a, b, other]);
    const fold2 = foldDuplicateWords([other, b, a]);
    assert.deepEqual(
      fold1.sort((x, y) => x.text.localeCompare(y.text)),
      fold2.sort((x, y) => x.text.localeCompare(y.text))
    );

    const hola = fold1.find((w) => w.text === 'hola')!;
    assert.equal(hola.box, 3, 'higher box wins');
    assert.equal(hola.cueIndex, 2, "winner's cueIndex rides with its box");
    assert.equal(hola.correct, 5, 'counts maxed, never summed — same forked history');
    assert.equal(hola.incorrect, 3);
    assert.equal(hola.savedAt, 100, 'earliest save');
    assert.equal(hola.lastReviewedAt, 3_000, 'latest review');
    assert.equal(fold1.length, 2, 'non-duplicates untouched');
  });

  it('tie on box and counts: the LOWEST cueIndex survives, both orders', () => {
    const low = word({ text: 'sol', videoId: 'v1', cueIndex: 1, box: 2, correct: 4 });
    const high = word({ text: 'sol', videoId: 'v1', cueIndex: 9, box: 2, correct: 4 });
    for (const input of [[low, high], [high, low]]) {
      const [folded] = foldDuplicateWords(input);
      assert.equal(folded.cueIndex, 1, 'stable replay/blank target');
      assert.equal(folded.box, 2);
    }
  });

  it('hydrate cycles converge: fold -> merge -> "upsert" -> fold again drifts nothing and re-pushes nothing', () => {
    // Server holds a stale duplicate (cue 7) next to the live row (cue 2).
    const live = word({ text: 'hola', videoId: 'v1', cueIndex: 2, box: 3, correct: 5 });
    const stale = word({ text: 'hola', videoId: 'v1', cueIndex: 7, box: 1, correct: 2 });

    // Cycle 1 — hydrate: fold remote, merge with local (same word, cache).
    const [remote1] = foldDuplicateWords([stale, live]);
    const local1 = mergePrefer(remote1, remote1); // fresh cache of remote
    const merged1 = mergePrefer(local1, remote1);
    // The push (if any) upserts merged1 into the winner row; stale remains.
    const serverAfter = [merged1, stale];

    // Cycle 2 — next app open, stale row still present, either order.
    for (const rows of [serverAfter, [...serverAfter].reverse()]) {
      const [remote2] = foldDuplicateWords(rows);
      const merged2 = mergePrefer(merged1, remote2);
      assert.deepEqual(merged2, merged1, 'no drift in any field');
      assert.equal(merged2.cueIndex, 2, 'seek target never moves');
      assert.ok(!localAhead(merged2, remote2), 'no re-push: toPush stays empty');
    }
  });

  it('the pre-fold pathology is what localAhead would have kept re-firing on', () => {
    // Regression guard on the WHY: against the raw stale row (what the old
    // last-wins map could expose), the merged word reads as ahead — the
    // perpetual re-push. Against the folded remote it never does.
    const live = word({ text: 'hola', videoId: 'v1', cueIndex: 2, box: 3, correct: 5 });
    const stale = word({ text: 'hola', videoId: 'v1', cueIndex: 7, box: 1, correct: 2 });
    assert.ok(localAhead(live, stale), 'raw stale row would re-trigger forever');
    const [folded] = foldDuplicateWords([stale, live]);
    assert.ok(!localAhead(live, folded));
  });

  it('mergeSum output stays within the DB box constraint (0..6)', () => {
    // The old box <= 5 CHECK made exactly this row fail the whole batched
    // upsert. 20260725010000 raised it to 6 = MAX_BOX; merged rows can never
    // exceed what either side already had.
    const m = mergeSum(
      word({ text: 'a', videoId: 'v', box: 6 }),
      word({ text: 'a', videoId: 'v', box: 5 })
    );
    assert.ok(m.box >= 0 && m.box <= 6);
  });
});
