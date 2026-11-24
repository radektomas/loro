import { Linking, Platform } from 'react-native';
import { ExtensionStorage } from '@bacons/apple-targets';
import { storage } from '@loro/core/storage';
import { cleanWord } from '@loro/core/dictionary';
import { buildRoadmap, withLevelKnown } from '@loro/core/roadmap';
import { track } from './analytics';

/**
 * THE LOCK SCREEN WIDGET'S FEED (Radek, 2026-11-05: "the last saved word ...
 * would show decently on the lock screen"). The widget itself is SwiftUI
 * (targets/widget/LoroWidget.swift) and only reads; this writes.
 *
 * WHICH WORD: the NEXT WORD ON THE PATH in Words (the open node Loro points
 * at, "Tap playa to train it!"), not the last word saved. Radek wanted the
 * widget to be a door into Words ("nobody uses the Words page"), and the last
 * save usually sits locked at the end of the path, where a tap could not
 * train it. Tapping the widget opens Words scrolled to this word
 * (loro://words → subscribeToWidgetTap → Shell). With nothing open on the
 * path, nothing is written and the widget asks for a save.
 *
 * Written on launch and on every change to the words, and only when the word
 * actually changed, so a graded answer does not make WidgetKit redraw for
 * nothing. ExtensionStorage falls back to no-ops when its native module is
 * absent (a development build from before the widget, Android).
 */
const APP_GROUP = 'group.app.getloro';
const KIND = 'LoroWidget';

let shared: ExtensionStorage | null = null;
let lastKey: string | null = null;

/** The path's open word, the one Words asks you to train next. */
export function nextPathWord(): { word: string; meaning: string } | null {
  const trip = withLevelKnown(storage.getSavedWords(), storage.getLevelKnownWords());
  const here = buildRoadmap(trip.words).find((n) => n.status === 'open');
  return here ? { word: cleanWord(here.word.text), meaning: here.word.translation } : null;
}

function sync(): void {
  if (!shared) return;
  const next = nextPathWord();
  const key = next ? `${next.word}|${next.meaning}` : '';
  if (key === lastKey) return;
  lastKey = key;
  try {
    shared.set('lastWord', next?.word);
    shared.set('lastMeaning', next?.meaning);
    ExtensionStorage.reloadWidget(KIND);
  } catch (err) {
    console.warn('[loro:widget] write failed', err);
  }
}

/**
 * THE WIDGET'S TAP. Its link is loro://words; Shell subscribes and opens the
 * Words tab on the current word. A tap that cold-starts the app arrives
 * before Shell exists (or during onboarding), so it is parked and the first
 * subscriber drains it, the notification route's own pattern.
 */
const tapListeners = new Set<() => void>();
let tapPending = false;

function onLink(url: string | null): void {
  if (!url || !/^loro:\/\/words/.test(url)) return;
  track('widget_opened', {});
  if (tapListeners.size === 0) {
    tapPending = true;
    return;
  }
  for (const l of tapListeners) l();
}

export function subscribeToWidgetTap(listener: () => void): () => void {
  tapListeners.add(listener);
  if (tapPending) {
    tapPending = false;
    listener();
  }
  return () => tapListeners.delete(listener);
}

/**
 * Can this phone show the widget? iOS 16+ (lock screen widgets) and a binary
 * that carries it: a development build from before the widget has no
 * ExtensionStorage module, and offering a widget it cannot add would be a lie.
 */
export function lockWidgetAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  if (parseInt(String(Platform.Version), 10) < 16) return false;
  return Boolean((globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules?.ExtensionStorage);
}

/** Once, from finishBoot (boot.ts): the storage seam is filled by then. */
export function installLockWidget(): void {
  if (Platform.OS !== 'ios' || shared) return;
  shared = new ExtensionStorage(APP_GROUP);
  sync();
  storage.onWordsChanged(sync);
  void Linking.getInitialURL().then(onLink);
  Linking.addEventListener('url', ({ url }) => onLink(url));
}
