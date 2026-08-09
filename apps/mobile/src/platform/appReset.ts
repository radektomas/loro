/**
 * A one-signal emitter for "the app's local state is gone — start over".
 *
 * WHY THIS EXISTS. Account deletion wipes every 'loro.' key out from under a
 * running app. Core's storage reads straight through to the driver on every
 * call (storage.ts: getSavedWords re-reads the key, it does not memoise), so
 * the DATA is genuinely gone the moment the wipe returns — but React state in
 * the mounted screens is not. VocabScreen is holding the word list it read at
 * mount, ProgressScreen the streak it computed. Without a remount the user
 * deletes their account and keeps looking at their saved words, which reads as
 * a deletion that did not work.
 *
 * WHY NOT DevSettings.reload(). It is dev-only — the exact opposite of this
 * path's lifetime. Nor expo-updates' reloadAsync: a whole native module for one
 * remount, and it is not a dependency today.
 *
 * WHAT REMOUNTS. App subscribes and re-keys the Onboarding/Shell subtree only,
 * deliberately NOT PlayerHost — its documented contract is one WebView per
 * launch, and the onboarding -> Shell handoff already swaps that subtree under
 * a persistent host, so this reuses a transition the tree is built for.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to reset requests. Returns an unsubscribe function. */
export function onAppReset(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ask the app to remount from scratch. Call AFTER the storage wipe, never
 * before: subscribers re-read storage as they mount, so firing first would
 * rebuild them from the data that is about to disappear.
 */
export function requestAppReset(): void {
  for (const listener of listeners) listener();
}
