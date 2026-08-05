import { createMMKV } from 'react-native-mmkv';
import type { StorageDriver } from '@loro/core/platform';

/**
 * The RN StorageDriver: MMKV for the persistent layer, an in-memory Map for
 * the session layer.
 *
 * EVERY READ HERE IS SYNCHRONOUS AND RETURNS A VALUE, NOT A PROMISE. That is
 * not a style choice — platform.ts states it in capitals, and it is the entire
 * reason MMKV was chosen over AsyncStorage. core's save gate, the blank
 * planners and every render-time read assume it. Do not introduce a promise
 * into this file.
 */

/**
 * A named instance rather than the default 'mmkv.default'.
 *
 * The id IS the on-disk filename. Changing it later does not migrate anything
 * — it silently opens an empty store, which presents as "the user lost all
 * their words" and not as an error. Treat this string as permanent.
 */
export const mmkv = createMMKV({ id: 'loro' });

/**
 * The session layer.
 *
 * Web uses sessionStorage; RN has no equivalent, so a session is the process
 * lifetime. Its only production consumers are the two-layer sound state and
 * the dev-only paywall overrides.
 *
 * ⚠️ THE SEMANTICS ARE NOT IDENTICAL TO WEB, and that is inherent rather than
 * a shortcut. A browser tab closes in hours; iOS suspends rather than kills, so
 * this Map routinely survives for days and dies only on force-quit or an OS
 * eviction. See getSessionUnmuted in core's storage.ts: it reads session first
 * and only falls through to the standing choice when session is unset, so on RN
 * the standing layer is consulted roughly once and then shadowed for the life
 * of the process. Nothing breaks; the fallback simply stops being reached.
 * Whether a mute should outlive a day is a product decision, not a driver one —
 * if it should not, this is where the reset goes.
 */
const session = new Map<string, string>();

export const storageDriver: StorageDriver = {
  local: {
    /**
     * MMKV returns `undefined` for a missing key; core's contract is `string |
     * null`. The `?? null` is load-bearing, not tidying: getSessionUnmuted
     * branches on `session !== null`, and `undefined` would take the
     * has-a-value branch for a key that was never written.
     */
    getItem: (key) => mmkv.getString(key) ?? null,
    /**
     * MMKV throws on an empty key and on a failed write. That matches
     * StorageLayer's documented contract exactly — "may throw… callers own the
     * try/catch and the verified-read-back contract" — so this deliberately
     * does NOT swallow. core's writeJSON already wraps its writes and verifies
     * by reading back; catching here would hide a full disk from the one layer
     * equipped to report it.
     */
    setItem: (key, value) => {
      mmkv.set(key, value);
    },
    /** v4 renamed delete() to remove(); it returns a boolean core does not
        use, so the block body keeps the signature void. */
    removeItem: (key) => {
      mmkv.remove(key);
    },
  },

  session: {
    getItem: (key) => session.get(key) ?? null,
    setItem: (key, value) => {
      session.set(key, value);
    },
    removeItem: (key) => {
      session.delete(key);
    },
  },

  /**
   * Remove every key with this prefix from BOTH layers.
   *
   * Two callers, both destructive and both required to be complete: the
   * account-deletion sweep (loro. / loro: / sb-) and, indirectly, the
   * switch-user wipe that drops the previous owner's level, starter and
   * paywall state before hydrating a new account.
   *
   * getAllKeys() returns a plain snapshot array, so removal during iteration is
   * safe — the web driver's backwards index loop exists only because
   * localStorage.key(i) re-indexes live, and copying that here would be
   * cargo-culting. The Map is spread for the same reason: deleting from a live
   * Map iterator is legal but reads as a bug.
   */
  clearByPrefix(prefix) {
    for (const key of mmkv.getAllKeys()) {
      if (key.startsWith(prefix)) mmkv.remove(key);
    }
    for (const key of [...session.keys()]) {
      if (key.startsWith(prefix)) session.delete(key);
    }
  },

  /**
   * onExternalChange is DELIBERATELY ABSENT.
   *
   * It is optional in the interface and core guards every use
   * (`getStorageDriver()?.onExternalChange?.(…)`), so omitting it is a
   * supported configuration rather than a gap. The web event it mirrors is
   * cross-TAB: one process here, so there is no outside writer to hear.
   *
   * ⚠️ MMKV does expose addOnValueChangedListener, and wiring it would be a
   * bug. It fires on same-process writes, which core already announces on its
   * own module bus — every saveWord would notify onWordsChanged twice and every
   * subscribed screen would render twice per save.
   */
};
