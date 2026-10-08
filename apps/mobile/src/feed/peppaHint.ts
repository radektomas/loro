import { storageDriver } from '../platform/storage';
import { track } from '../platform/analytics';

/**
 * "PEPPA PIG IS HERE", ONCE (Radek, 2026-10-08: "I would just tell the user
 * it's there, by the little pill — only once"). Seven in ten users never
 * opened the Peppa shelf behind the Reels pill (2026-10-07), while Peppa is
 * what the marketing sells. So on a user's second reel the pill itself says
 * so for a few seconds — inside the top strip, never over the player — and
 * never again on this device.
 */
const KEY = 'loro.mobile.peppaHintShown';

/** How long the pill reads "Peppa Pig is here". */
export const PEPPA_HINT_MS = 3800;

export function peppaHintDue(): boolean {
  try {
    return storageDriver.local.getItem(KEY) === null;
  } catch {
    return false;
  }
}

export function markPeppaHintShown(): void {
  try {
    storageDriver.local.setItem(KEY, '1');
  } catch {}
  track('peppa_hint_shown');
}

const listeners = new Set<() => void>();

/** DEV: show it now, ignoring the once-ever flag. */
export function devShowPeppaHint(): void {
  for (const l of listeners) l();
}

export function subscribeToDevPeppaHint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
