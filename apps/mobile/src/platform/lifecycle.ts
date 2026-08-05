import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { PlatformLifecycle } from '@loro/core/platform';

/**
 * The flush-signal seam: "the app may be about to lose execution, or has just
 * regained the network — drain the queues NOW".
 *
 * The web wires three events; RN has equivalents for two of them and none for
 * the third:
 *
 *   visibilitychange→hidden  →  AppState 'background' / 'inactive'
 *   online                   →  NetInfo, on a false→true transition
 *   beforeunload             →  NOTHING. iOS gives no reliable termination
 *                               callback, so a force-quit from the app switcher
 *                               runs no JS at all.
 *
 * That third gap is why the background signal carries more weight here than on
 * web: it is the LAST guaranteed moment to persist. core's queues live in MMKV
 * and survive the process either way, so the cost of missing it is a delayed
 * push, not lost data — but there is no second chance to flush on the way out.
 */
export const lifecycle: PlatformLifecycle = {
  onFlushSignal(callback) {
    const appStateSub = AppState.addEventListener('change', (next) => {
      // 'inactive' is iOS-only and fires on transient interruptions too — the
      // app switcher, notification centre, an incoming call. Included on
      // purpose: it is often the only warning before a termination that never
      // reaches 'background'. Flushing is idempotent and a no-op on an empty
      // queue, so over-firing costs nothing.
      if (next === 'background' || next === 'inactive') callback();
    });

    /**
     * Fire only on the false→true EDGE, not on every state event.
     *
     * NetInfo emits on any change — carrier, wifi ssid, cellular generation —
     * and re-flushing on each would hammer the sync engine while nothing about
     * reachability changed. `wasReachable` starts true so the listener's own
     * initial callback, delivered immediately on subscribe with the current
     * state, cannot be mistaken for a reconnection.
     *
     * isInternetReachable is tri-state: null means "not determined yet", which
     * must not count as offline or the first real event would look like a
     * reconnect. Only an explicit false is treated as unreachable.
     */
    let wasReachable = true;
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const reachable = state.isConnected === true && state.isInternetReachable !== false;
      if (reachable && !wasReachable) callback();
      wasReachable = reachable;
    });

    return () => {
      appStateSub.remove();
      unsubscribeNetInfo();
    };
  },
};
