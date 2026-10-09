import { CATALOG_BASE_URL } from './config';
import { mmkv } from './storage';
import { getInstallId, track } from './analytics';

/**
 * REMOTE SWITCHES, flipped without a build (Radek, 2026-10-09: "add a remote
 * on/off switch for the Madrid pass … this could be really good for A/B").
 *
 * One small public JSON next to the catalog — config/flags.json in the same
 * public-read bucket, written by scripts/set-paywall-flag.mts with the
 * service key — fetched once per launch and cached. No anon key, no table,
 * no SDK: the same plain GET the catalog pointer already makes.
 *
 *   { "madridPassPercent": 100 }
 *
 * THE MADRID PASS AS AN A/B. madridPassPercent is the share of installs that
 * get "Madrid is free" (paywall/freePass.ts); the rest meet the wall straight
 * after onboarding, as before 1.9.0. 100 = everyone gets the pass (what
 * shipped), 0 = everyone gets the hard wall, 50 = a split.
 *
 * STICKY PER INSTALL. An install's bucket is a hash of its analytics
 * installId (0..99), and the variant it is given is stored the first time it
 * is decided — so a later change to the percent moves NEW installs only and
 * never yanks the pass from someone halfway through Madrid. The decision
 * waits for a real value (cached or fetched): the first launch's onboarding
 * takes minutes, the fetch takes a second, so in practice every install is
 * decided on the live percent. Offline with no cache, the shipped default
 * applies and nothing is stored, so it is decided properly on a later launch.
 *
 * Fails safe: any fetch or parse problem leaves the cache (or the default) in
 * force. A switch that can break the app is worse than no switch.
 */

const FLAGS_URL = `${CATALOG_BASE_URL}/config/flags.json`;
const CACHE_KEY = 'loro.remoteFlags';
const VARIANT_KEY = 'loro.paywallVariant';
/** DEV pin. Outside 'loro.' on purpose: the dev menu's "First run as a new
    user" wipes 'loro.*', and the pin must survive it in either order. */
const DEV_VARIANT_KEY = 'dev.paywallVariant';
const FETCH_TIMEOUT_MS = 6000;

/** What shipped before the switch existed: everyone gets the pass. */
const DEFAULT_MADRID_PASS_PERCENT = 100;

export type PaywallVariant = 'madrid' | 'hard';

type Flags = { madridPassPercent: number };

const listeners = new Set<() => void>();

function readCache(): Flags | null {
  try {
    const raw = mmkv.getString(CACHE_KEY);
    return raw ? parseFlags(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function parseFlags(raw: unknown): Flags | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = (raw as { madridPassPercent?: unknown }).madridPassPercent;
  if (typeof p !== 'number' || !Number.isFinite(p)) return null;
  return { madridPassPercent: Math.min(100, Math.max(0, Math.round(p))) };
}

/** Called once per launch from finishBoot. Never throws. */
export async function refreshRemoteFlags(): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(FLAGS_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const flags = parseFlags(await res.json());
    if (!flags) return;
    mmkv.set(CACHE_KEY, JSON.stringify(flags));
    for (const l of listeners) l();
  } catch {
    // Offline, timeout, bad JSON: keep whatever we had.
  }
}

export function subscribeToRemoteFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 0..99, stable for an install. FNV-1a over the install id. */
function bucketOf(installId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < installId.length; i++) {
    h ^= installId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

/**
 * This install's paywall variant. Decided once (on the first call that has a
 * real percent to decide with) and then fixed; the decision is logged as
 * `paywall_variant` so every install, not only the ones that reach a wall,
 * lands in one arm of the test.
 */
export function getPaywallVariant(): PaywallVariant {
  try {
    if (__DEV__) {
      const pinned = mmkv.getString(DEV_VARIANT_KEY);
      if (pinned === 'madrid' || pinned === 'hard') return pinned;
    }
    const stored = mmkv.getString(VARIANT_KEY);
    if (stored === 'madrid' || stored === 'hard') return stored;
    const flags = readCache();
    if (!flags) return DEFAULT_MADRID_PASS_PERCENT >= 100 ? 'madrid' : 'hard';
    const id = getInstallId();
    const bucket = id ? bucketOf(id) : 0;
    const variant: PaywallVariant = bucket < flags.madridPassPercent ? 'madrid' : 'hard';
    mmkv.set(VARIANT_KEY, variant);
    track('paywall_variant', { variant, percent: flags.madridPassPercent, bucket });
    return variant;
  } catch {
    return 'madrid';
  }
}

/** DEV: pin or clear this device's variant from the dev menu. */
export function setDevPaywallVariant(variant: PaywallVariant | null): void {
  if (variant) {
    mmkv.set(DEV_VARIANT_KEY, variant);
  } else {
    mmkv.remove(DEV_VARIANT_KEY);
    mmkv.remove(VARIANT_KEY);
  }
}
