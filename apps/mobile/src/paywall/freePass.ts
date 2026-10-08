import { useEffect, useState } from 'react';
import { storage } from '@loro/core/storage';
import { tripPosition, withLevelKnown } from '@loro/core/roadmap';
import { storageDriver } from '../platform/storage';
import { track } from '../platform/analytics';
import { getPurchaseGate } from '../platform/purchases';

/**
 * MADRID IS FREE (Radek, 2026-10-08: "we have nothing to lose, let's make it
 * free till they reach the first city, which is 5 words").
 *
 * Why: the wall came straight after onboarding, and the event trails showed
 * people tapping "Start Loro for free", closing Apple's sheet, trying
 * Restore, relaunching — looking for a way to try Loro without subscribing
 * to an app they had not seen yet (two had skipped onboarding entirely).
 *
 * The rule: a user who is not subscribed uses the whole app until Madrid is
 * done. The wall then comes at the happiest moment — after "¡Llegaste a
 * Sevilla!" and the postcard, when they press ¡Vamos! (VocabScreen
 * closeArrival). A user who reaches Sevilla but never opens Words to see
 * the arrival meets the wall on their next launch instead.
 *
 * One flag, set once, never cleared: the pass is a first taste, not a
 * renewable one. A lapsed subscriber already past Madrid meets the wall at
 * launch exactly as before.
 */
const KEY = 'loro.mobile.freePassEnded';

export type FreePassEnd = 'arrival' | 'launch';

const listeners = new Set<() => void>();

function readEnd(): FreePassEnd | null {
  try {
    const v = storageDriver.local.getItem(KEY);
    return v === 'arrival' || v === 'launch' ? v : v ? 'launch' : null;
  } catch {
    // Unreadable storage: behave as before the pass existed.
    return 'launch';
  }
}

function pastMadrid(): boolean {
  const words = withLevelKnown(storage.getSavedWords(), storage.getLevelKnownWords()).words;
  return tripPosition(words).stage >= 1;
}

export function endFreePass(how: FreePassEnd): void {
  if (readEnd() !== null) return;
  try {
    storageDriver.local.setItem(KEY, how);
  } catch {}
  // Subscribers pass through Sevilla too; only a real end is an event.
  if (!getPurchaseGate().entitled) track('free_pass_ended', { how });
  for (const l of listeners) l();
}

/** Is Madrid still free for this device? Re-checked when the pass ends. */
export function useFreePass(): { active: boolean; endedBy: FreePassEnd | null } {
  const [endedBy, setEndedBy] = useState<FreePassEnd | null>(() => {
    const now = readEnd();
    if (now !== null) return now;
    // Past Madrid already (a relaunch after arriving, or an install from
    // before the pass existed): the taste is over.
    if (pastMadrid()) {
      try {
        storageDriver.local.setItem(KEY, 'launch');
      } catch {}
      return 'launch';
    }
    return null;
  });
  useEffect(() => {
    const l = () => setEndedBy(readEnd());
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { active: endedBy === null, endedBy };
}
