'use client';

import { useCallback, useEffect, useState } from 'react';
import { storage } from '@/lib/storage';
import {
  canSaveMore as canSaveMoreRule,
  effectiveLimit,
  remainingSaves,
  type Tier,
} from './limit.ts';
import {
  entitlementInput,
  onTierChanged,
  paywallActive,
  readTierState,
} from './state.ts';

/**
 * THE entitlement hook. The only way a component may ask what a user is
 * allowed to do.
 *
 * Nothing else in the UI imports config.ts, limit.ts or state.ts. That is the
 * point of the seam: when the limit changes, when a third tier appears, or when
 * grandfathering is retired, the components do not move — because they never
 * knew the rules in the first place, only the answers.
 *
 * Reactive to both inputs the answer depends on: the saved-word cache
 * (storage.onWordsChanged, same-tab and cross-tab) and the cached tier
 * (onTierChanged, which fires when the profile fetch lands or a dev override
 * flips). A save in one tab therefore updates the capacity meter in another.
 *
 * ANONYMOUS USERS ARE FULLY SUPPORTED. savedCount comes from the same
 * localStorage-first cache the whole app reads, so this works before any
 * account exists and stays correct across merge-on-signin: the merge rewrites
 * that cache and emits words-changed, which re-runs the read here. There is no
 * separate anonymous path to drift.
 */

export type Entitlements = {
  tier: Tier;
  /** Counted saved words — starter-deck words excluded (limit.ts). */
  savedCount: number;
  /** Infinity when the paywall is off, the user is plus, or grandfathered. */
  limit: number;
  canSaveMore: boolean;
  /** Infinity-safe: Infinity when unlimited, never negative. */
  remaining: number;
  isGrandfathered: boolean;

  // ---- context the UI needs, so no component has to reach around the hook ----

  /** No account. Anonymous users get the account prompt, never the paywall. */
  isAnonymous: boolean;
  /** Is the paywall live? False in production while the flag is off, which is
      what makes the paywall UI invisible there without any component knowing
      about the flag. */
  paywallActive: boolean;
  /** False until the localStorage read has happened. Components that render
      counts must wait for this or they will flash a 0 on hydration. */
  ready: boolean;
};

function read(): Omit<Entitlements, 'ready'> {
  const state = readTierState();
  const input = entitlementInput(state);
  const savedCount = storage.getCountedSavedWords();
  const limit = effectiveLimit(input);
  return {
    // The user's real tier, not the gate's resolved identity: a signed-in user
    // whose fetch has not landed is 'free' here (the honest default) while the
    // LIMIT above is still Infinity. Reporting them as anything else would make
    // the profile UI claim a tier nobody has.
    tier: input.tier ?? state.tier,
    savedCount,
    limit,
    canSaveMore: canSaveMoreRule(savedCount, limit),
    remaining: remainingSaves(savedCount, limit),
    isGrandfathered: state.isGrandfathered,
    isAnonymous: state.userId === null,
    paywallActive: paywallActive(),
  };
}

const EMPTY: Omit<Entitlements, 'ready'> = {
  tier: 'free',
  savedCount: 0,
  limit: Infinity,
  canSaveMore: true,
  remaining: Infinity,
  isGrandfathered: false,
  isAnonymous: true,
  paywallActive: false,
};

export function useEntitlements(): Entitlements {
  // Not read during render: localStorage is unavailable on the server and a
  // first client render must match the server's HTML or React discards it.
  const [value, setValue] = useState(EMPTY);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => setValue(read()), []);

  useEffect(() => {
    refresh();
    setReady(true);
    const offWords = storage.onWordsChanged(refresh);
    const offTier = onTierChanged(refresh);
    return () => {
      offWords();
      offTier();
    };
  }, [refresh]);

  return { ...value, ready };
}
