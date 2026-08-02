'use client';

import { getSupabase, TABLES } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { PAYWALL_ENABLED } from '@loro/core/entitlements/config';
import { shouldGrandfather, type Tier } from '@loro/core/entitlements/limit';

/**
 * The impure half of the entitlement seam: who this user is, what tier they are
 * on, and whether the paywall is live right now.
 *
 * ONE-WAY DEPENDENCY, deliberately. This module must never import
 * lib/storage.ts. storage.ts owns the single verdict on whose data localStorage
 * holds (its KEYS.syncedUser cache-owner read) and drives this module's
 * transitions from handleSession, exactly as it drives lib/follows.ts. A second
 * auth observer here would be a second opinion about which account the cache
 * belongs to, and the two could disagree.
 *
 * SYNCHRONOUS BY DESIGN. The save gate runs inside storage.saveWord(), which is
 * promise-free and must stay that way — every caller in the app treats saving
 * as an immediate, verified operation. So the tier lives in localStorage and is
 * read synchronously; the network is only ever the thing that updates it.
 */

const KEY = 'loro.tier';
/** Fired on window whenever the cached tier changes (same-tab updates). */
const TIER_CHANGED = 'loro:tier-changed';

const isBrowser = typeof window !== 'undefined';

/**
 * NODE_ENV is inlined at build time, so every dev-only branch below folds to
 * `false` in a production build and the override cannot be reached there — the
 * same guarantee /dev/autoplay-lab relies on.
 */
const IS_DEV = process.env.NODE_ENV !== 'production';

/** sessionStorage, not localStorage: a forced paywall is a thing you are doing
    right now while testing, not a preference that should outlive the tab. */
const DEV_FORCE_KEY = 'loro.dev.paywall';
const DEV_TIER_KEY = 'loro.dev.tier';

export type TierState = {
  /** Whose tier this is. null = anonymous. */
  userId: string | null;
  /** Has the tier actually been READ for this user, or is it still the
      default? See paywallIdentity() for why the difference matters. */
  known: boolean;
  tier: Tier;
  /** epoch ms, or null for free (which was never granted). */
  tierGrantedAt: number | null;
  isGrandfathered: boolean;
};

const ANONYMOUS: TierState = {
  userId: null,
  known: false,
  tier: 'free',
  tierGrantedAt: null,
  isGrandfathered: false,
};

// ------------------------------------------------------------------ cache

function write(state: TierState): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    // Surface it. A tier that silently failed to cache means the next read
    // falls back to free, and a paying user gets gated.
    console.error('[loro] tier cache write failed', err);
  }
  window.dispatchEvent(new Event(TIER_CHANGED));
}

/** The cached tier. Anonymous whenever there is nothing trustworthy to read. */
export function readTierState(): TierState {
  if (!isBrowser) return ANONYMOUS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return ANONYMOUS;
    const parsed = JSON.parse(raw) as Partial<TierState>;
    if (typeof parsed.userId !== 'string') return ANONYMOUS;
    return {
      userId: parsed.userId,
      known: parsed.known === true,
      tier: parsed.tier === 'plus' ? 'plus' : 'free',
      tierGrantedAt:
        typeof parsed.tierGrantedAt === 'number' ? parsed.tierGrantedAt : null,
      isGrandfathered: parsed.isGrandfathered === true,
    };
  } catch {
    return ANONYMOUS;
  }
}

/** Subscribe to tier changes: same-tab (custom event) and cross-tab (storage).
    Returns an unsubscribe function. Mirrors storage.onWordsChanged. */
export function onTierChanged(callback: () => void): () => void {
  if (!isBrowser) return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) callback();
  };
  window.addEventListener(TIER_CHANGED, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(TIER_CHANGED, callback);
    window.removeEventListener('storage', onStorage);
  };
}

// -------------------------------------------------------- dev-only preview

/** Is the paywall forced on for this dev session? Always false in production. */
export function devPaywallForced(): boolean {
  if (!IS_DEV || !isBrowser) return false;
  return window.sessionStorage.getItem(DEV_FORCE_KEY) === '1';
}

/** Dev-only tier override, so both sides of every gate are reachable without
    a real subscription to buy. Null = use the real cached tier. */
export function devTierOverride(): Tier | null {
  if (!IS_DEV || !isBrowser) return null;
  const v = window.sessionStorage.getItem(DEV_TIER_KEY);
  return v === 'free' || v === 'plus' ? v : null;
}

/** Set (or clear) the dev preview. No-op in production. */
export function setDevPaywall(opts: {
  forced?: boolean;
  tier?: Tier | null;
}): void {
  if (!IS_DEV || !isBrowser) return;
  if (opts.forced !== undefined) {
    window.sessionStorage.setItem(DEV_FORCE_KEY, opts.forced ? '1' : '0');
  }
  if (opts.tier !== undefined) {
    if (opts.tier === null) window.sessionStorage.removeItem(DEV_TIER_KEY);
    else window.sessionStorage.setItem(DEV_TIER_KEY, opts.tier);
  }
  window.dispatchEvent(new Event(TIER_CHANGED));
}

// --------------------------------------------------------- runtime verdict

/**
 * Is the paywall live?
 *
 * PAYWALL_ENABLED is the answer in production — one line in config.ts, and
 * flipping it is the whole launch. The dev branch exists so the modal, the
 * blocked-save path and the locked statistics are all reachable and testable
 * before that line changes; it compiles away in a production build.
 */
export function paywallActive(): boolean {
  return PAYWALL_ENABLED || devPaywallForced();
}

/**
 * The identity the limit rules should be applied to, or null for "not a gated
 * identity". Two very different situations collapse to null here, and both
 * must resolve to unlimited:
 *
 *  - ANONYMOUS. Paywalling a stranger's own localStorage asks for money before
 *    the product has proven anything, and they already have the account prompt.
 *  - TIER NOT YET READ. On a first sign-in on a new device the profile fetch
 *    has not landed. Erring permissive costs a free user one or two extra
 *    words; erring strict blocks a PAYING user mid-save because the network was
 *    slow, which is unforgivable in a way the other direction isn't.
 */
export function paywallIdentity(state: TierState = readTierState()): Tier | null {
  const override = devTierOverride();
  if (override) return override;
  if (state.userId === null) return null;
  if (!state.known) return null;
  return state.tier;
}

/** Everything limit.ts needs, resolved from the live browser state. */
export function entitlementInput(state: TierState = readTierState()) {
  return {
    paywallActive: paywallActive(),
    tier: paywallIdentity(state),
    isGrandfathered: state.isGrandfathered,
  };
}

// ------------------------------------------------------------ transitions
//
// Called by lib/storage.ts handleSession — never self-driven. `mode` mirrors
// the follows engine's FollowsAuthMode and comes from the same cache-owner
// verdict.

export type EntitlementsAuthMode = 'hydrate' | 'merge-up' | 'switch-user';

/** Signed out: stop claiming a tier. The cache is dropped rather than kept as
    a "working copy" (which is what saved words do) because an entitlement is
    not the user's data — a stale 'plus' would grant a signed-out browser
    unlimited saves, and a stale 'free' would gate the next account. */
export function handleEntitlementsSignOut(): void {
  if (!isBrowser) return;
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(TIER_CHANGED));
}

/**
 * Read the user's tier from their profile row and cache it, then evaluate
 * grandfathering.
 *
 * `savedCount` is passed IN (the counted total — countsTowardLimit) rather
 * than read, because this module must not import storage.ts. It is only ever
 * used as a trigger; the server recounts before granting anything.
 *
 * A read failure leaves the cache alone and returns quietly: with the columns
 * missing (an unmigrated database) or the network down, `known` stays false and
 * paywallIdentity() resolves to null, so the app behaves as if there were no
 * paywall. That is the correct failure direction and the reason the migration
 * had to land first.
 */
export async function handleEntitlementsAuth(
  userId: string,
  mode: EntitlementsAuthMode,
  savedCount: number
): Promise<void> {
  if (!isBrowser) return;

  // A different account owned the cache — drop it before anything can read a
  // tier belonging to someone else.
  if (mode === 'switch-user') handleEntitlementsSignOut();

  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from(TABLES.profiles)
    .select('tier, tier_granted_at, is_grandfathered')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[loro] tier fetch failed', error.message);
    return; // stay unknown -> unlimited. Retried at the next auth event.
  }

  const row = (data ?? {}) as {
    tier?: string | null;
    tier_granted_at?: string | null;
    is_grandfathered?: boolean | null;
  };

  const state: TierState = {
    userId,
    known: true,
    tier: row.tier === 'plus' ? 'plus' : 'free',
    tierGrantedAt: row.tier_granted_at
      ? Date.parse(row.tier_granted_at) || null
      : null,
    isGrandfathered: row.is_grandfathered === true,
  };
  write(state);

  await maybeGrandfather(state, savedCount);
}

/**
 * Grant the grandfather flag if this user was already over the limit when the
 * paywall turned on.
 *
 * The client only decides whether to ASK. The write itself needs the service
 * role (users cannot write their own tier — see the migration's trigger), and
 * the route recounts the user's words server-side before granting, so a
 * tampered savedCount buys nothing.
 *
 * Failures are swallowed after logging and retried at the next auth event, the
 * same contract as every other profile-row mirror in lib/storage.ts. The cost
 * of a missed grant is one app open, and the flag is checked before every
 * grant so a retry cannot double-apply.
 */
async function maybeGrandfather(
  state: TierState,
  savedCount: number
): Promise<void> {
  if (state.isGrandfathered) return; // already granted — never re-decided
  if (
    !shouldGrandfather({
      paywallActive: paywallActive(),
      tier: paywallIdentity(state),
      isGrandfathered: state.isGrandfathered,
      savedCount,
    })
  ) {
    return;
  }

  const session = await getSession();
  const token = session?.access_token;
  if (!token) return;

  try {
    const res = await fetch('/api/entitlements/grandfather', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error('[loro] grandfather request failed', res.status);
      return;
    }
    const body = (await res.json()) as { grandfathered?: boolean };
    if (body.grandfathered === true) {
      write({ ...state, isGrandfathered: true });
    }
  } catch (err) {
    console.error('[loro] grandfather request failed', err);
  }
}

export type { Tier };
