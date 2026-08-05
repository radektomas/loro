import * as SplashScreen from 'expo-splash-screen';
import { initPlatform } from '@loro/core/platform';
import { API_BASE_URL } from './config';
import { platformCrypto } from './crypto';
import { lifecycle } from './lifecycle';
import { storageDriver } from './storage';
import { installCachedCatalog, refreshCatalog, type CatalogSource } from './catalog';

/**
 * RN boot. The sibling of the web's lib/platformInit.ts + lib/catalogInit.ts,
 * and it follows the same rule for the same reason: EVERYTHING HERE RUNS AS AN
 * IMPORT SIDE EFFECT AT MODULE SCOPE, not in an effect or an async function.
 *
 * WHY THE ORDERING IS ENFORCED RATHER THAN DOCUMENTED. core's reads have a
 * resting state, so reading too early does not crash — it silently answers with
 * defaults. An empty word list and `isOnboarded() === false` are what a
 * returning user would get, which shows up as being marched back through
 * onboarding rather than as an error anyone could debug. The port map flags a
 * sharper version of the same trap: storage.onWordsChanged captures
 * `getStorageDriver()?.onExternalChange?.(…)` ONCE, at subscribe time, so a
 * subscriber registered before initPlatform silently holds a dead channel for
 * its whole lifetime. (That specific one cannot bite RN — this driver omits
 * onExternalChange entirely — but the early-read family it belongs to can.)
 *
 * The guarantee comes from index.js importing THIS module before it imports
 * App: ES modules evaluate in source order, so initPlatform has run before
 * App's module body is even evaluated, let alone rendered. App.tsx imports it
 * again at its own top so the guarantee survives someone reordering index.js —
 * a module body runs at most once, so the second import is free.
 *
 * Nothing here is async. MMKV opens synchronously and expo-file-system exposes
 * textSync(), so RN reproduces the web's "seam filled before first read"
 * property exactly, with no async boot phase to sequence around.
 */

// Hold the splash over the synchronous catalog parse below (~0.9MB). Fired
// before any work so there is no frame between launch and the held splash.
// Returns a promise only to report whether it succeeded; nothing waits on it.
void SplashScreen.preventAutoHideAsync();

initPlatform({
  storage: storageDriver,
  apiBaseUrl: API_BASE_URL,
  lifecycle,
  crypto: platformCrypto,
});

/**
 * The catalog seam, filled immediately after the platform seam and before any
 * render. 'seed' means the bundled 8 are installed and a refresh will replace
 * them; 'cache' means the full snapshot was already on disk.
 */
export const catalogSource: CatalogSource = installCachedCatalog();

/**
 * Called from App's first effect — i.e. once there is something on screen.
 *
 * Hiding the splash here rather than at module scope is what prevents a blank
 * frame: module evaluation finishes before React has mounted anything, so
 * hiding at that point would reveal an empty root view for a frame or two.
 *
 * The refresh is kicked from the same place because it is genuinely background
 * work — the app is already interactive and running on either the cache or the
 * seed, and onCatalogChanged updates whatever is mounted when it lands.
 */
export function finishBoot(): void {
  void SplashScreen.hideAsync();
  void refreshCatalog();
}
