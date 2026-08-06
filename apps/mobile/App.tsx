// FIRST IMPORT, DELIBERATELY. Installs the platform + catalog seams as a module
// side effect before anything below can read storage. index.js imports it too;
// a module body runs once, so this is free insurance against a reorder there.
import { finishBoot } from './src/platform/boot';

import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { FeedScreen } from './src/feed/FeedScreen';

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
  useEffect(() => {
    // Hides the splash and kicks the background catalog refresh, now that
    // something is actually on screen.
    finishBoot();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <BottomSheetModalProvider>
          <StatusBar style="light" />
          <FeedScreen />
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
