import * as SplashScreen from 'expo-splash-screen';
import { initPlatform } from '@loro/core/platform';
import { storage } from '@loro/core/storage';
import { API_BASE_URL } from './config';
import { platformCrypto } from './crypto';
import { lifecycle } from './lifecycle';
import { storageDriver } from './storage';
import { initAuth } from './supabaseInit';
import { initNotifications } from './notifications';
import { captureCampaignAttribution, initPurchases } from './purchases';
import { initAnalytics } from './analytics';
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
 * The auth seam, and then the sync engine — in that order, at module scope,
 * for the same reason everything else here is.
 *
 * WHY THE ORDER IS NOT NEGOTIABLE. storage.initSync() reads both seams and
 * bails if either is missing — and the two bails are not equally forgiving.
 * No storage driver returns BEFORE setting syncStarted, so a later call could
 * still recover; no client sets syncStarted and only then returns, which makes
 * that one PERMANENT for the process. Calling initSync before initAuth would
 * therefore not merely delay sync, it would disable it for the whole launch,
 * silently and with the app looking entirely healthy.
 *
 * WHAT initSync ACTUALLY DOES, and why it belongs at module scope rather than
 * in App's first effect. It subscribes to auth changes and kicks a getSession()
 * — that listener is what runs the anonymous → signed-in merge. The web gets
 * this from SyncInit in the root layout, which mounts before anything that can
 * offer a sign-in button. Here, module scope is strictly earlier still: the
 * subscription is live before React renders a frame, so a session restored
 * from MMKV on a cold start is merged without a UI event to trigger it, and no
 * sign-in can ever fire before something is listening.
 *
 * Nothing is awaited. initSync's own work is async and self-healing (a merge
 * that fails is repeated at the next auth event), so boot does not wait on the
 * network — the feed is interactive on the local cache exactly as before.
 *
 * A no-op when Supabase is unconfigured: initAuth skips, getSupabase() stays
 * null, initSync returns at its own guard, and the app is anonymous-only.
 */
initAuth();
storage.initSync();

/**
 * RevenueCat, immediately after the auth seam for the same reason initSync
 * sits there: it subscribes to the SAME onAuthChange bus (its logIn is how a
 * purchase follows the anonymous → signed-in merge), so it must be listening
 * before any UI event can produce a session. Also fills the entitlement gate
 * App.tsx renders on — a no-op with the gate OPEN when the SDK key is unset
 * (see purchases.ts / config.ts on failing open).
 */
initPurchases();

/**
 * Product analytics, last of the seams and deliberately after the auth one:
 * it mirrors onAuthChange to stamp a user_id on events, and a subscription
 * registered before initAuth would hold a dead bus for the whole launch — the
 * same trap initSync sits above.
 *
 * At module scope rather than in finishBoot() because the launch pair
 * (app_install / app_open) must be recorded even for a launch that never
 * reaches a rendered frame: a crash on the way to first paint is exactly the
 * kind of thing worth having a row for. Nothing here reaches the network
 * synchronously — track() writes to MMKV and returns.
 */
initAnalytics();

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
 *
 * NOTIFICATIONS INITIALISE HERE FOR THE SAME REASON, and specifically NOT at
 * module scope beside initPlatform. Its listeners read learning data through
 * core, so they need the storage seam already filled; and its first reconcile
 * is async native work that nothing on screen waits for. The one part that
 * genuinely cannot wait — the foreground presentation handler — is registered
 * at module scope inside notifications.ts, so importing this file is enough to
 * install it. See the note there on the split.
 */
export function finishBoot(): void {
  void SplashScreen.hideAsync();
  void refreshCatalog();
  initNotifications();
  // First-launch campaign capture + subscriber attribute. Here and not at
  // module scope because getInitialURL is async native work nothing waits on,
  // and the token can only matter once purchases are configured anyway.
  void captureCampaignAttribution();
}
