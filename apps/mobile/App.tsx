// FIRST IMPORT, DELIBERATELY. Installs the platform + catalog seams as a module
// side effect before anything below can read storage. index.js imports it too;
// a module body runs once, so this is free insurance against a reorder there.
import { finishBoot } from './src/platform/boot';

import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { PlayerHost } from './src/player/PlayerHost';
import { Shell } from './src/shell/Shell';
import { Onboarding } from './src/onboarding/Onboarding';
import { shouldShowOnboarding } from './src/onboarding/flow';
import { onAuthDeepLink } from './src/auth/exchange';

/**
 * CHECKPOINT E — the feed, with sound and word-saving.
 *
 * GestureHandlerRootView must wrap the whole tree (gesture-handler's
 * requirement), and it was put here in D precisely so @gorhom/bottom-sheet
 * would need no root change when the save sheet landed. It didn't.
 *
 * BottomSheetModalProvider is that one addition: BottomSheetModal resolves its
 * host through this context, and without it the word sheet mounts but never
 * presents. It sits INSIDE GestureHandlerRootView because the sheet's pan-down
 * gesture is a gesture-handler consumer.
 *
 * SafeAreaProvider feeds useSafeAreaInsets, which the slide uses to reserve the
 * notch above the player. The web reserves the same space with
 * env(safe-area-inset-top); a fixed constant there once put the top chrome over
 * the player on every notched phone.
 *
 * initialMetrics IS NOT AN OPTIMISATION. Without it SafeAreaProvider renders
 * `{insets != null ? children : null}` — its ENTIRE subtree is null until the
 * first native onInsetsChange arrives (SafeAreaContext.tsx). That subtree
 * includes BottomSheetModalProvider's hosting container: the single empty
 * measuring view that publishes the container height every modal sheet's
 * geometry is derived from. A subtree that mounts a frame late mounts that
 * measurement a frame late too, and the sheet library treats an unmeasured
 * container by refusing to animate at all rather than by erroring —
 * useAnimatedDetents returns no detents and isLayoutCalculated stays false, so
 * the sheet parks one full window height below the fold, invisibly and
 * silently. initialWindowMetrics is read from the native side at startup, so
 * insets are non-null on the FIRST render and the subtree never has a
 * null phase. This is the library's own documented remedy for it.
 */
export default function App() {
  /**
   * CHECKPOINT H — the first-launch gate, decided ONCE at mount.
   *
   * Read in a lazy initialiser rather than an effect, so the very first frame
   * is already the right screen: a gate resolved after mount flashes the feed
   * behind onboarding, which is precisely the bug the web's `gate` state
   * exists to prevent (components/Feed.tsx:84-86). The read is safe this early
   * because the storage seam is installed as a module side effect of the
   * boot import at the top of this file — before any component renders.
   *
   * Held in state, not recomputed: onDone flips it, and re-reading storage on
   * every render would be a redundant MMKV hit for a decision that changes at
   * most once per launch.
   */
  const [onboarding, setOnboarding] = useState(shouldShowOnboarding);

  useEffect(() => {
    // Hides the splash and kicks the background catalog refresh, now that
    // something is actually on screen.
    finishBoot();
  }, []);

  /**
   * The magic-link callback, listened for at the ROOT and for the whole app
   * lifetime — deliberately not inside the sign-in card.
   *
   * The card that started the flow is routinely gone by the time the link is
   * tapped: the user leaves for Mail, and iOS may evict the app entirely, so
   * the URL frequently arrives as a COLD START with no card mounted and no
   * React state surviving. A listener owned by a screen would miss exactly the
   * case it exists for. App never unmounts, so this one cannot.
   *
   * There is nothing to do on success: the exchange establishes the session,
   * and the auth listener storage.initSync() registered at boot picks it up
   * and runs the merge. Screens re-render from their own useSession. Errors
   * are logged rather than surfaced — this fires with no UI context, and there
   * is no honest place to put a banner for a link tapped ten minutes ago.
   *
   * Google does NOT come through here: openAuthSessionAsync captures its own
   * redirect and returns it inline (see providers.ts).
   */
  useEffect(
    () =>
      onAuthDeepLink((result) => {
        if (result.status === 'error') {
          console.error('[loro] auth callback failed', result.message);
        }
      }),
    []
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <BottomSheetModalProvider>
          <StatusBar style="light" />
          {/* PLAYERHOST WRAPS THE TABS, and that placement is the whole reason
              the feed survives a tab switch. Its contract is one WebView for
              the session, never unmounted (PlayerHost.tsx) — a host rendered
              inside the feed tab would be torn down on every switch to Words,
              and each rebuild is a fresh iframe boot. Keeping it here also
              keeps the page's own sound and playback-rate state alive, since
              both are variables inside a document that is never reloaded. */}
          {/* PlayerHost wraps BOTH so the WebView is created once per launch
              and never re-parented — including across the onboarding -> feed
              handoff. Onboarding uses no player and never calls usePlayerBox,
              so the box stays at HIDDEN_BOX: 0x0 and invisible, with nothing
              drawn over these screens. Rendering Onboarding INSTEAD OF Shell
              is what keeps the tab bar and the feed's FlashList unmounted
              during the flow. */}
          <PlayerHost>
            {onboarding ? (
              <Onboarding onDone={() => setOnboarding(false)} />
            ) : (
              <Shell />
            )}
          </PlayerHost>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
