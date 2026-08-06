import { storage } from '@loro/core/storage';
import { storageDriver } from '../platform/storage';

/**
 * CHECKPOINT H — onboarding: flags, keys, and the gate.
 *
 * WHAT IS PORTED AND WHAT IS NEW. Calibration is the web's, exactly: the same
 * seed list, the same deriveLevel, the same four writes (app/welcome/page.tsx).
 * The eleven conversational screens around it are new design and have no web
 * counterpart. Everything core-owned is imported; nothing in packages/core is
 * modified, and NO new key is added to core's KEYS map — the two mobile-only
 * answers below are written straight through the driver instead.
 */

// ------------------------------------------------------------------- flags

/**
 * FORCE THE FLOW, WHATEVER STORAGE SAYS. Flip to true, save, reload: onboarding
 * runs from screen 1 again.
 *
 * This is the testing lever rather than the reset, and deliberately so — it
 * destroys nothing, so a run under it leaves your saved words, watch log and
 * schedule exactly where they were. It also RE-WRITES the calibration keys on
 * completion, which is the point: you can re-derive a level without wiping the
 * device.
 *
 * What it does NOT test is the gate itself. For that, use the dev reset row at
 * the bottom of Progress — see resetForColdStart.
 */
export const DEV_FORCE_ONBOARDING = false;

/**
 * The paywall seam. Dark, and the screen behind it renders NOTHING while it is
 * false — the step is filtered out of the flow entirely, so there is no empty
 * frame to slide through. Same dark-ship pattern as RECALL_ENABLED
 * (recall.ts) and LEVELS_ENABLED (levelBlanks.ts).
 *
 * TURNING THIS ON IS NOT ENOUGH TO CHARGE ANYONE. A real paywall needs IAP,
 * which is a native module and therefore an EAS rebuild; core's
 * entitlements/plans.ts and paywallEvents.ts are also unwired on mobile. The
 * step is a placeholder surface so the flow has the right shape, nothing more.
 */
export const PAYWALL_ENABLED = false;

/** Slide duration between screens. Short enough to feel like a swipe rather
    than a page load; zeroed when Reduce Motion is on. */
export const SLIDE_MS = 260;

// -------------------------------------------------------------- mobile keys

/**
 * MOBILE-ONLY MMKV KEYS, and named to say so.
 *
 * These two answers have no web counterpart and nothing reads them YET. They
 * are recorded now because they are cheap to collect during onboarding and
 * impossible to collect afterwards — not because anything is waiting on them.
 *
 * The 'loro.mobile.' prefix is doing real work:
 *   - 'loro.' keeps them inside the account-deletion and switch-user sweeps
 *     (storage.ts clearByPrefix callers). They are user data and should die
 *     with the user's other data.
 *   - '.mobile.' says at a glance that core does not know about them, so
 *     nobody goes looking for them in KEYS and concludes they are missing.
 *
 * Written through the driver rather than through `storage` on purpose: adding
 * a setter to core would mean editing core for a value core does not consume.
 */
export const MOBILE_KEYS = {
  motivation: 'loro.mobile.motivation',
  frequency: 'loro.mobile.frequency',
} as const;

export function setMotivation(value: string): void {
  storageDriver.local.setItem(MOBILE_KEYS.motivation, value);
  olog(`motivation=${value} -> ${MOBILE_KEYS.motivation}`);
}

export function getMotivation(): string | null {
  return storageDriver.local.getItem(MOBILE_KEYS.motivation);
}

export function setFrequency(value: string): void {
  storageDriver.local.setItem(MOBILE_KEYS.frequency, value);
  olog(`frequency=${value} -> ${MOBILE_KEYS.frequency}`);
}

export function getFrequency(): string | null {
  return storageDriver.local.getItem(MOBILE_KEYS.frequency);
}

// -------------------------------------------------------------- the gate

/**
 * Should the flow run?
 *
 * storage.isOnboarded() is core's, unchanged, and it is NOT just the flag:
 * it also returns true for anyone with saved words or watched videos
 * (storage.ts:1369-1376). That grandfathering is correct — an existing user
 * must never be dropped back into onboarding because the flag postdates their
 * data — and it is also why a device that has been used for testing will never
 * show this flow until it is wiped.
 */
export function shouldShowOnboarding(): boolean {
  if (DEV_FORCE_ONBOARDING) return true;
  return !storage.isOnboarded();
}

/**
 * The real reset: wipe every 'loro.' key from both storage layers.
 *
 * NOT setOnboarded(false), and that is the whole reason this exists.
 * isOnboarded() falls back to "has saved words" and "has watched videos", so on
 * any device that has run the feed, clearing the flag alone leaves the gate
 * shut and looks like a bug in the gate. A cold start has to be a cold start.
 *
 * The catalog survives: its keys are deliberately outside the 'loro.'
 * namespace (platform/catalog.ts:42-52), so this costs no re-download.
 *
 * Caller reloads afterwards — module-level caches and React state hold the old
 * values, so wiping without reloading leaves the app running on data that no
 * longer exists.
 */
export function resetForColdStart(): void {
  storageDriver.clearByPrefix('loro.');
  olog('WIPED all loro.* keys — reloading for a cold start');
}

/** Tagged like the other checkpoints' logs so one filter finds the run. */
export function olog(message: string): void {
  console.log(`[loro:H] ${message}`);
}
