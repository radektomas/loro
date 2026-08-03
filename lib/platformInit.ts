import { initPlatform, type StorageDriver } from '@loro/core/platform';

/**
 * Web bootstrap for @loro/core's platform seam: the browser StorageDriver,
 * the API base, the flush-signal lifecycle, and the event-id crypto chain.
 * Sibling of lib/supabaseInit.ts, same contract — this
 * runs as an IMPORT SIDE EFFECT from the top of components/SyncInit.tsx
 * (mounted by the root layout on every route), so the driver is installed
 * during module evaluation, before hydration renders anything that reads
 * synchronously from storage.
 *
 * This IS today's behaviour, relocated: localStorage as the persistent
 * layer, sessionStorage as the session layer, and the cross-tab 'storage'
 * event as the external-change feed core's onTierChanged / onFollowsChanged
 * keep listening to. On the server the module evaluates but never
 * initialises, so core reads fall back exactly as the old
 * `typeof window === 'undefined'` guards did.
 */

const webStorageDriver: StorageDriver = {
  local: {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value);
    },
    removeItem: (key) => {
      window.localStorage.removeItem(key);
    },
  },
  session: {
    getItem: (key) => window.sessionStorage.getItem(key),
    setItem: (key, value) => {
      window.sessionStorage.setItem(key, value);
    },
    removeItem: (key) => {
      window.sessionStorage.removeItem(key);
    },
  },
  clearByPrefix(prefix) {
    for (const store of [window.localStorage, window.sessionStorage]) {
      // Backwards: removing while iterating shifts the key index.
      for (let i = store.length - 1; i >= 0; i--) {
        const key = store.key(i);
        if (key && key.startsWith(prefix)) store.removeItem(key);
      }
    }
  },
  onExternalChange(callback) {
    // Another tab wrote. e.key === null means the whole store was cleared;
    // core's subscribers filter by their own keys.
    const onStorage = (e: StorageEvent) => callback(e.key);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  },
};

if (typeof window !== 'undefined') {
  // apiBaseUrl '': the app's own API routes stay relative, same-origin —
  // byte-identical requests to the pre-seam fetch('/api/...') calls.
  initPlatform({
    storage: webStorageDriver,
    apiBaseUrl: '',
    lifecycle: {
      // The three flush signals storage.initSync wired directly before the
      // extraction, unchanged: hidden-tab, reconnect, and page teardown.
      // (RN has no beforeunload — it flushes on AppState background instead,
      // wired mobile-side.)
      onFlushSignal(callback) {
        const onVisibility = () => {
          if (document.visibilityState === 'hidden') callback();
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('online', callback);
        window.addEventListener('beforeunload', callback);
        return () => {
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('online', callback);
          window.removeEventListener('beforeunload', callback);
        };
      },
    },
    crypto: {
      // newEventId's original fallback chain, verbatim. The fallbacks are
      // load-bearing, not defensive padding: crypto.randomUUID exists only
      // in a SECURE context, and the device-testing path for this app is
      // http://192.168.x.x on a phone, where it is undefined.
      // getRandomValues IS available on insecure origins; the last resort
      // covers neither being there at all.
      randomUUID() {
        const c = window.crypto;
        if (c && typeof c.randomUUID === 'function') return c.randomUUID();
        if (c && typeof c.getRandomValues === 'function') {
          const bytes = new Uint8Array(16);
          c.getRandomValues(bytes);
          return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        }
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      },
    },
  });
}
