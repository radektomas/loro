import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOX_INTERVALS_MS,
  demoteLegacyLevelFill,
  grade,
  KNOWN_BOX,
  LEVEL_FILL_BOX,
  stateForBox,
} from './srs.ts';
import type { SavedWord } from './types.ts';

/**
 * The level-fill entry box and the legacy demotion — run with `npm test`.
 *
 * Both exist because of one measured fact (2026-09-07): 43 of a real user's
 * 58 "learned" words were blue blanks typed once and filed straight into
 * known. These pin the two halves of the fix — new fills enter as learning,
 * and old fills are read back as learning — and, just as importantly, pin
 * every shape the demotion must NOT touch.
 */

const NOW = 1_700_000_000_000;

function word(over: Partial<SavedWord> = {}): SavedWord {
  return {
    text: 'de',
    translation: 'of',
    videoId: 'vid',
    cueIndex: 3,
    source: 'user',
    savedAt: NOW,
    state: 'known',
    box: 4,
    dueAt: NOW + BOX_INTERVALS_MS[4],
    correct: 1,
    incorrect: 0,
    lastReviewedAt: NOW,
    learnedAt: null,
    ...over,
  };
}

describe('LEVEL_FILL_BOX', () => {
  it('enters as learning, one correct answer below known', () => {
    assert.equal(stateForBox(LEVEL_FILL_BOX), 'learning');
    assert.equal(LEVEL_FILL_BOX, KNOWN_BOX - 1);
  });

  it('comes due tomorrow, not in a week', () => {
    assert.equal(BOX_INTERVALS_MS[LEVEL_FILL_BOX], 24 * 60 * 60_000);
  });

  it('one correct recall from there crosses into known and stamps learnedAt', () => {
    const fill = word({ box: LEVEL_FILL_BOX, state: 'learning', dueAt: NOW - 1 });
    const graded = grade(fill, true, NOW + 1);
    assert.equal(graded.state, 'known');
    assert.equal(graded.box, KNOWN_BOX);
    assert.equal(graded.learnedAt, NOW + 1);
    assert.equal(graded.correct, 2);
  });
});

describe('demoteLegacyLevelFill', () => {
  it('reads a legacy one-shot fill back as learning at LEVEL_FILL_BOX', () => {
    const out = demoteLegacyLevelFill(word());
    assert.equal(out.box, LEVEL_FILL_BOX);
    assert.equal(out.state, 'learning');
  });

  it('leaves the schedule alone — no flood on update day', () => {
    const legacy = word();
    const out = demoteLegacyLevelFill(legacy);
    assert.equal(out.dueAt, legacy.dueAt);
    assert.equal(out.correct, 1);
    assert.equal(out.lastReviewedAt, legacy.lastReviewedAt);
  });

  it('is idempotent', () => {
    const once = demoteLegacyLevelFill(word());
    assert.deepEqual(demoteLegacyLevelFill(once), once);
  });

  it('never touches a word graded up the ladder from a tap', () => {
    // Box 0 -> 4 takes four correct answers; the count is the difference.
    const earned = word({ correct: 4, savedAt: NOW - 30 * 24 * 60 * 60_000 });
    assert.equal(demoteLegacyLevelFill(earned), earned);
  });

  it('never touches a starter-deck grant', () => {
    const deck = word({ source: 'deck', box: 3, correct: 0, lastReviewedAt: null });
    assert.equal(demoteLegacyLevelFill(deck), deck);
    // ...nor one reviewed once since: box 4, correct 1, but source 'deck'.
    const deckReviewed = word({ source: 'deck', lastReviewedAt: NOW + 5 });
    assert.equal(demoteLegacyLevelFill(deckReviewed), deckReviewed);
  });

  it('never touches a word whose stamp says it was earned', () => {
    const stamped = word({ learnedAt: NOW });
    assert.equal(demoteLegacyLevelFill(stamped), stamped);
  });

  it('never touches a fill that has since been reviewed', () => {
    // A legacy fill answered right a week later moved to box 5 with two
    // corrects — it earned its place, and isLearned counts it. A fill
    // answered WRONG lapsed to box 0, which is not the legacy shape either.
    const reviewed = word({ box: 5, correct: 2, lastReviewedAt: NOW + 7 * 24 * 60 * 60_000 });
    assert.equal(demoteLegacyLevelFill(reviewed), reviewed);
    const lapsed = word({ box: 0, state: 'lapsed', incorrect: 1, lastReviewedAt: NOW + 10 });
    assert.equal(demoteLegacyLevelFill(lapsed), lapsed);
  });

  it('requires the fill-time tell: lastReviewedAt equal to savedAt', () => {
    const later = word({ lastReviewedAt: NOW + 1 });
    assert.equal(demoteLegacyLevelFill(later), later);
  });
});
