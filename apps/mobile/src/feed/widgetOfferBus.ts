import { storage } from '@loro/core/storage';
import { cleanWord } from '@loro/core/dictionary';
import { lockWidgetAvailable, nextPathWord } from '../platform/lockWidget';
import { storageDriver } from '../platform/storage';
import { track } from '../platform/analytics';

/**
 * THE ONE-TIME WIDGET CARD'S DECISION (Radek, 2026-11-05: "one time card ...
 * super smooth and aesthetic"). Most people never find widgets on their
 * own, so after the THIRD word they save, once their save chip has landed,
 * the feed shows how to put Loro on the lock screen, with their own word in
 * the picture (WidgetOffer.tsx).
 *
 * Third, not first: by then saving is a habit they have, and the widget has
 * something worth showing. Once per install, persisted; never on a phone
 * that cannot add it (lockWidgetAvailable).
 */
const SHOWN_KEY = 'loro.mobile.widgetOffer.shown';
const AFTER_SAVES = 3;

export type WidgetOffer = { word: string; meaning: string };

const listeners = new Set<(offer: WidgetOffer) => void>();

export function subscribeToWidgetOffer(listener: (offer: WidgetOffer) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function latestSave(): WidgetOffer | null {
  let latest: { text: string; translation: string; savedAt: number } | null = null;
  for (const w of storage.getSavedWords()) {
    if (w.source !== 'user') continue;
    if (!latest || w.savedAt > latest.savedAt) latest = w;
  }
  return latest ? { word: cleanWord(latest.text), meaning: latest.translation } : null;
}

/** Called when a save chip has landed in the Words tab (WordSheet). */
export function maybeOfferWidget(): void {
  if (!lockWidgetAvailable()) return;
  try {
    if (storageDriver.local.getItem(SHOWN_KEY) !== null) return;
  } catch {
    return;
  }
  const saves = new Set(
    storage
      .getSavedWords()
      .filter((w) => w.source === 'user')
      .map((w) => cleanWord(w.text).toLowerCase())
  ).size;
  if (saves < AFTER_SAVES) return;
  // The card shows what the real widget will: the path's next word.
  const offer = nextPathWord() ?? latestSave();
  if (!offer || listeners.size === 0) return;
  try {
    storageDriver.local.setItem(SHOWN_KEY, String(Date.now()));
  } catch {}
  track('widget_offer_shown', { words: saves });
  for (const l of listeners) l(offer);
}

/** DEV: the card with the latest save, or a sample; no latch, no device check. */
export function devRaiseWidgetOffer(): void {
  const offer = nextPathWord() ?? latestSave() ?? { word: 'playa', meaning: 'beach' };
  for (const l of listeners) l(offer);
}
