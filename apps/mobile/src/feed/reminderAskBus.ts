import { storageDriver } from '../platform/storage';

/**
 * THE POST-PURCHASE REMINDER ASK'S TRIGGER (Radek, 2026-11-18: "yeah lets do
 * this"). ReminderAsk.tsx is the card; this is when it shows.
 *
 * WHY HERE AND NOT ONLY AFTER THE FIRST CORRECT ANSWER. The feed's explainer
 * (NotificationPrompt) waited for someone to have felt what a reminder is
 * for, and in practice almost nobody got there: from 2026-10-14 to 11-18,
 * 191 installs and 19 trials produced 10 permission answers, ONE of them a
 * trial user's. Meanwhile 11 of those 19 never opened the app after day 0,
 * and the paywall's "we remind you 2 days before" could reach none of them.
 * Right after paying is when someone is most committed, and they have just
 * told us their pace in onboarding, so the card asks with their own answer.
 *
 * The feed's explainer stays, as the second chance on a later launch.
 *
 * PERSISTED, NOT ONLY EMITTED, because of the handoff order. The CustomerInfo
 * listener flips the gate as Apple confirms, so Shell (and this card) can
 * mount BEFORE PaywallScreen's code after `await purchasePackage` runs. The
 * key covers "feed mounted after the mark"; the listeners cover "feed mounted
 * before it". Taken once: the card consumes it whether or not it can show.
 */
const DUE_KEY = 'loro.mobile.reminderAsk.afterPurchase';

const listeners = new Set<(preview: boolean) => void>();

export function subscribeToReminderAsk(listener: (preview: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by PaywallScreen when Apple confirms a purchase (not a restore). */
export function markReminderAskAfterPurchase(): void {
  try {
    storageDriver.local.setItem(DUE_KEY, String(Date.now()));
  } catch {}
  for (const listener of listeners) listener(false);
}

/** Is the ask waiting? Clears it: one purchase, one chance. */
export function takeReminderAskDue(): boolean {
  try {
    if (storageDriver.local.getItem(DUE_KEY) === null) return false;
    storageDriver.local.removeItem(DUE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** DEV: show the card now, permission state ignored (the Allow button still
    asks iOS for real, so on an already-answered phone it just closes). */
export function devRaiseReminderAsk(): void {
  for (const listener of listeners) listener(true);
}
