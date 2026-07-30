import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FREE_TIER_SAVED_WORDS_LIMIT,
  SAVED_WORDS_MILESTONES,
  SAVE_PROMPT_THRESHOLD,
} from './config.ts';
import {
  canSaveMore,
  countedSaved,
  countsTowardLimit,
  effectiveLimit,
  milestoneFor,
  remainingSaves,
  shouldGrandfather,
} from './limit.ts';

/**
 * The rules a paywall is judged on are the ones that decide whether a real
 * person can keep using the product. Every case below is a way to get that
 * wrong, and most of them fail SILENTLY in a running app — a paying user gated
 * because a fetch was slow looks like a bug in saving, not a bug in tiering.
 */

const ON = { paywallActive: true };

describe('effectiveLimit — who is unlimited', () => {
  it('is unlimited for everyone while the paywall is off', () => {
    // The production default today. If this ever fails, the flag has stopped
    // being the whole switch.
    for (const tier of ['free', 'plus', null] as const) {
      assert.equal(
        effectiveLimit({ paywallActive: false, tier, isGrandfathered: false }),
        Infinity
      );
    }
  });

  it('never gates an anonymous user', () => {
    // They get the account prompt instead. Stacking a purchase on top of a
    // sign-in ask, on data held in the user's own localStorage, is both rude
    // and unenforceable.
    assert.equal(
      effectiveLimit({ ...ON, tier: null, isGrandfathered: false }),
      Infinity
    );
  });

  it('never gates a plus user', () => {
    assert.equal(
      effectiveLimit({ ...ON, tier: 'plus', isGrandfathered: false }),
      Infinity
    );
  });

  it('never gates a grandfathered user, whatever their tier says', () => {
    assert.equal(
      effectiveLimit({ ...ON, tier: 'free', isGrandfathered: true }),
      Infinity
    );
  });

  it('gates a signed-in free user at the configured limit', () => {
    assert.equal(
      effectiveLimit({ ...ON, tier: 'free', isGrandfathered: false }),
      FREE_TIER_SAVED_WORDS_LIMIT
    );
  });
});

describe('remaining / canSaveMore', () => {
  it('is Infinity-safe rather than NaN or negative', () => {
    assert.equal(remainingSaves(1000, Infinity), Infinity);
    assert.equal(remainingSaves(0, Infinity), Infinity);
  });

  it('floors at zero when already over the limit', () => {
    // Reachable for real: a merge-on-signin can land a user above a ceiling
    // they never crossed one save at a time.
    assert.equal(remainingSaves(60, 50), 0);
  });

  it('blocks AT the limit, not one past it', () => {
    // The classic off-by-one. At 50 of 50 the 51st save must be refused.
    assert.equal(canSaveMore(49, 50), true);
    assert.equal(canSaveMore(50, 50), false);
    assert.equal(canSaveMore(51, 50), false);
  });

  it('always allows another save when unlimited', () => {
    assert.equal(canSaveMore(10_000, Infinity), true);
  });
});

describe('countsTowardLimit — granted words are not growth', () => {
  it('counts what the user chose', () => {
    assert.equal(countsTowardLimit({ source: 'user' }), true);
  });

  it('does not count what we granted', () => {
    assert.equal(countsTowardLimit({ source: 'deck' }), false);
  });

  it('counts only the user saves in a mixed set', () => {
    const words = [
      { source: 'deck' as const },
      { source: 'user' as const },
      { source: 'deck' as const },
      { source: 'user' as const },
    ];
    assert.equal(countedSaved(words), 2);
  });

  it('leaves the account prompt reachable after a full deck run', () => {
    // The reason this rule exists. A from-zero user finishes the starter deck
    // with 9 granted words; if those counted, their FIRST real save would trip
    // the prompt at 10 and (later) burn a fifth of the free ceiling.
    const deck = Array.from({ length: 9 }, () => ({ source: 'deck' as const }));
    assert.equal(countedSaved([...deck, { source: 'user' }]), 1);
    assert.ok(1 < SAVE_PROMPT_THRESHOLD);
  });
});

describe('shouldGrandfather', () => {
  const base = {
    paywallActive: true,
    tier: 'free' as const,
    isGrandfathered: false,
    savedCount: FREE_TIER_SAVED_WORDS_LIMIT + 1,
  };

  it('grants to a free user already over the limit', () => {
    assert.equal(shouldGrandfather(base), true);
  });

  it('does not grant to a user exactly at the limit', () => {
    // "Already above the line when the line appeared." At exactly the limit
    // they are a normal free user who has spent their allowance.
    assert.equal(
      shouldGrandfather({ ...base, savedCount: FREE_TIER_SAVED_WORDS_LIMIT }),
      false
    );
  });

  it('does not grant while the paywall is off', () => {
    // Nothing to be grandfathered against yet. Stamping rows early would make
    // the flag stop being the single switch.
    assert.equal(shouldGrandfather({ ...base, paywallActive: false }), false);
  });

  it('does not grant to anonymous or plus', () => {
    assert.equal(shouldGrandfather({ ...base, tier: null }), false);
    assert.equal(shouldGrandfather({ ...base, tier: 'plus' }), false);
  });

  it('KEEPS an existing grant even when the count no longer qualifies', () => {
    // The whole reason the flag is persisted. A user who earned unlimited saves
    // and then tidied their vocab list must not silently lose the entitlement.
    assert.equal(
      shouldGrandfather({ ...base, isGrandfathered: true, savedCount: 3 }),
      true
    );
  });
});

describe('milestoneFor', () => {
  it('fires on exact equality only', () => {
    for (const m of SAVED_WORDS_MILESTONES) {
      assert.equal(milestoneFor(m), m);
      assert.equal(milestoneFor(m - 1), null);
    }
  });

  it('reports at most one milestone for one count', () => {
    // A save changes the count by one, so a single save can only ever cross a
    // single milestone. A jump (merge-on-signin) skips them rather than firing
    // all four at once, which keeps the log a record of saves, not of syncs.
    const hits = [7, 10, 11, 25, 33, 40, 50, 51].filter(
      (n) => milestoneFor(n) !== null
    );
    assert.deepEqual(hits, [10, 25, 40, 50]);
  });

  it('ends at the limit and starts at the account prompt', () => {
    // The endpoints are derived, not typed twice — this is the tripwire if
    // someone re-hardcodes them.
    assert.equal(SAVED_WORDS_MILESTONES[0], SAVE_PROMPT_THRESHOLD);
    assert.equal(
      SAVED_WORDS_MILESTONES[SAVED_WORDS_MILESTONES.length - 1],
      FREE_TIER_SAVED_WORDS_LIMIT
    );
  });
});
