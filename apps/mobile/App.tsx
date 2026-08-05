// FIRST IMPORT, DELIBERATELY. Installs the platform + catalog seams as a module
// side effect before anything below can read storage. index.js imports it too;
// a module body runs once, so this is free insurance against a reorder there.
import { finishBoot } from './src/platform/boot';

import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { FeedScreen } from './src/feed/FeedScreen';

/**
 * CHECKPOINT D — the feed.
 *
 * GestureHandlerRootView must wrap the whole tree (gesture-handler's
 * requirement), and it is here rather than later because @gorhom/bottom-sheet
 * needs it when the save sheet lands in checkpoint E — and adding it then would
 * be a change to the app root, not to the sheet.
 *
 * SafeAreaProvider feeds useSafeAreaInsets, which the slide uses to reserve the
 * notch above the player. The web reserves the same space with
 * env(safe-area-inset-top); a fixed constant there once put the top chrome over
 * the player on every notched phone.
 */
export default function App() {
  useEffect(() => {
    // Hides the splash and kicks the background catalog refresh, now that
    // something is actually on screen.
    finishBoot();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <FeedScreen />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
