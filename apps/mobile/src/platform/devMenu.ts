import { DevSettings } from 'react-native';
import { isDevPaywallForced, setDevPaywallForced } from './purchases';
import { storageDriver } from './storage';

/**
 * THE DEV MENU — the closest thing this app has to a command palette.
 *
 * Shake the device, press m in the Metro terminal, or ⌃⌘Z in the simulator.
 *
 * ⚠️ IT IS REGISTERED TWICE, AND THAT IS NOT BELT AND BRACES — IT IS THE BUG
 * THIS MODULE SHIPPED WITH.
 *
 * `DevSettings.addMenuItem` adds to React Native's OWN dev menu. This app is
 * built with expo-dev-client, whose menu is a different screen written in
 * Swift: expo-dev-menu reads RCTDevSettings for the toggle states it mirrors
 * (EXDevMenuDevSettings.swift) and NEVER reads the custom item list. There is
 * no reference to addMenuItem anywhere in that package. So for four releases
 * every entry below existed, ran, logged, and was impossible to see or tap.
 *
 * expo-dev-menu's own channel is registerDevMenuItems, re-exported by
 * expo-dev-client. Both are called with the same four items, because a build
 * without expo-dev-client still wants the React Native menu. Requiring it
 * lazily inside the __DEV__ guard keeps a package that only exists in a
 * development build from being reached for in a release one, and the catch
 * means a rename in a future SDK degrades to the RN menu rather than taking
 * the boot with it.
 *
 * WHY IT EXISTS. Onboarding and the paywall are the two screens that are
 * hardest to look at on a device that has already been used, and they are also
 * the two that every conversion change lands on:
 *
 *   - `storage.isOnboarded()` is not just a flag. It returns true for anyone
 *     with saved words or watched videos, so clearing the flag on a device that
 *     has run the feed leaves the gate shut and the flow unreachable. The only
 *     honest reset is a real wipe.
 *   - The wall needs the gate to say "not entitled", and on a dev device it
 *     usually says the opposite: the local .env carries the RevenueCat key so
 *     nothing fails open, and a promotional entitlement granted for support
 *     rides on the account. Signing out drops it and everything else with it.
 *
 * Both were previously fixed by editing a constant and reloading, or by
 * deleting and reinstalling the app. These are the same operations, one tap
 * away, on the device where the problem is.
 *
 * WHY IT IS SAFE. `DevSettings.addMenuItem` is React Native core and exists
 * only in development builds — there is no menu to add to in a release binary.
 * Every entry point here is additionally guarded by `__DEV__`, which the bundler
 * inlines, so the whole module's body is dead code eliminated from production
 * rather than merely unreachable.
 *
 * THE LABELS ARE STATIC. addMenuItem takes a title once, so the paywall
 * override is two entries (set and clear) rather than one that reports its own
 * state. Reading the current value into a label would only be right until
 * somebody changed it.
 */

/** Guards against a double registration across a Fast Refresh of this module. */
let installed = false;

type MenuItem = { name: string; run: () => void };

/**
 * Publish to whichever dev menu this build actually has. See the header note:
 * neither mechanism reaches the other's menu.
 */
function publish(items: MenuItem[]): void {
  for (const item of items) DevSettings.addMenuItem(item.name, item.run);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const devClient = require('expo-dev-client');
    // Async, and nothing waits on it — but an unhandled rejection here would
    // surface as a red box at boot, which is a loud failure for a dev
    // convenience that is allowed to be absent.
    devClient
      .registerDevMenuItems?.(
        items.map((item) => ({
          name: item.name,
          callback: item.run,
          // The menu must get out of the way: every one of these reloads.
          shouldCollapse: true,
        }))
      )
      ?.catch((error: unknown) => {
        console.log('[loro:dev] could not register expo dev menu items', error);
      });
  } catch (error) {
    console.log('[loro:dev] expo dev menu unavailable', error);
  }
}

export function installDevMenu(): void {
  if (!__DEV__ || installed) return;
  installed = true;

  /**
   * SAY WHETHER THE OVERRIDE IS ON, once, at boot.
   *
   * The failure it prevents is a confusing one: finishing onboarding on an
   * entitled device lands in the feed, which looks like the handover is broken
   * when it is the gate correctly reporting a real subscription. The absence of
   * this line in the log is the answer.
   */
  if (isDevPaywallForced()) {
    console.log(
      '[loro:dev] paywall override ACTIVE — the gate will report NOT entitled'
    );
  } else {
    console.log(
      '[loro:dev] paywall override off — finishing onboarding lands wherever ' +
        'your real entitlement says. Press m in Metro → "Loro · First run ' +
        '(ends on the paywall)", or set DEV_FORCE_PAYWALL in purchases.ts.'
    );
  }

  /**
   * A COLD DEVICE MEANS WIPING 'loro.', AND THE CATALOG SURVIVES IT.
   *
   * The snapshot's keys sit outside that namespace on purpose (see
   * platform/catalog.ts), so the video list on disk is untouched, the taste
   * reel resolves on the first render, and there is no download to wait
   * through before reaching the walkthrough.
   *
   * The reload is not a nicety either: module-level caches and React state
   * still hold the wiped values, so without it the app keeps running on data
   * that no longer exists.
   */
  publish([
    /**
     * THE DEFAULT FIRST RUN, AND IT ENDS AT THE WALL.
     *
     * Every onboarding entry sets the override now, and there used to be one
     * that did not. That difference cost several runs: wiping the flow's
     * storage does not touch the ENTITLEMENT, which lives on the RevenueCat
     * account rather than on the device, so finishing the taste reel on a
     * subscribed machine handed over to the feed. It looked like the handoff
     * was broken; it was the gate correctly reporting a real subscription.
     *
     * Wiping and forcing are one operation because they are one INTENTION:
     * nobody resets onboarding in order to watch it end somewhere other than
     * where a new install ends. The entitled path is the next entry down.
     */
    {
      name: 'Loro · First run (ends on the paywall)',
      run: () => {
        setDevPaywallForced(true);
        storageDriver.clearByPrefix('loro.');
        console.log('[loro:dev] wiped loro.* + forcing the paywall — restarting');
        DevSettings.reload();
      },
    },
    /**
     * The other half, named rather than implied: onboarding again, ending
     * wherever the real entitlement says — the feed, on a subscribed device.
     * It CLEARS the override rather than leaving it alone, so the previous
     * run's choice cannot leak into this one.
     */
    {
      name: 'Loro · First run (keep my entitlement)',
      run: () => {
        setDevPaywallForced(false);
        storageDriver.clearByPrefix('loro.');
        console.log(
          '[loro:dev] wiped loro.*, override cleared — this run ends wherever ' +
            'your real entitlement says'
        );
        DevSettings.reload();
      },
    },
    /** Just the wall, on the device as it stands. No wipe, nothing destroyed. */
    {
      name: 'Loro · Show paywall now',
      run: () => {
        setDevPaywallForced(true);
        console.log('[loro:dev] forcing the paywall');
        DevSettings.reload();
      },
    },
    /** Back to the real verdict from RevenueCat. */
    {
      name: 'Loro · Clear paywall override',
      run: () => {
        setDevPaywallForced(false);
        console.log('[loro:dev] paywall override cleared — real entitlement again');
        DevSettings.reload();
      },
    },
  ]);
}
