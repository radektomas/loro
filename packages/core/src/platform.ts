/**
 * The platform seam: where core gets its storage and its API origin. This is
 * the first slice of the port map's §7b initCore() — each platform calls
 * initPlatform() once at boot, before anything renders or syncs:
 *   - web: lib/platformInit.ts — localStorage + sessionStorage + the
 *     cross-tab 'storage' event, apiBaseUrl '' (same-origin relative fetches)
 *   - RN: MMKV for local, an in-memory map for session, no external-change
 *     feed (single process), apiBaseUrl = the deployment's https origin
 *
 * EVERY READ IS SYNCHRONOUS, STRING-VALUED, AND PROMISE-FREE. That property
 * is load-bearing across the whole app — the save gate, the blank planners
 * and the render-time reads all assume it — and it is why the RN target is
 * MMKV, not AsyncStorage. Do not add a promise to this interface.
 *
 * "No driver" (before initPlatform, i.e. during a server render) is the
 * resting state: reads fall back to their defaults and writes no-op, exactly
 * the behaviour the old `typeof window` guards produced.
 */

export type StorageLayer = {
  getItem(key: string): string | null;
  /** May throw (browser quota / eviction) — callers own the try/catch and
      the verified-read-back contract, exactly as with raw localStorage. */
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type StorageDriver = {
  /** Persistent layer — the synchronous source of truth the UI reads.
      localStorage on web, MMKV in RN. */
  local: StorageLayer;
  /**
   * Session layer — true for THIS running session, gone with it. Web:
   * sessionStorage (survives navigation, dies with the tab). RN: an
   * in-memory map (a session is the process lifetime). Used by the
   * two-layer sound state (session truth over standing choice) and the
   * dev-only paywall overrides.
   */
  session: StorageLayer;
  /** Remove every key starting with `prefix` from BOTH layers — the
      account-deletion sweep (loro. / loro: / sb-). */
  clearByPrefix(prefix: string): void;
  /**
   * Change notification from OUTSIDE this JS context: the browser's
   * cross-tab 'storage' event, forwarded with its key (null = the whole
   * store was cleared). Optional — single-process platforms (RN) omit it,
   * because every in-process write already announces itself on a module
   * bus. Returns an unsubscribe function.
   */
  onExternalChange?(callback: (key: string | null) => void): () => void;
};

export type PlatformLifecycle = {
  /**
   * Subscribe to "flush pending writes NOW" moments — the app may be about
   * to lose execution or has just regained the network. Web wires today's
   * three signals unchanged: document visibilitychange→hidden, window
   * 'online', and 'beforeunload'. RN has NO beforeunload — it flushes on
   * AppState background transitions (and NetInfo reconnect) instead, wired
   * mobile-side, later. Returns an unsubscribe function.
   */
  onFlushSignal(callback: () => void): () => void;
};

export type PlatformCrypto = {
  /**
   * A fresh unique id for one logged event. The web supplies its own
   * fallback chain (crypto.randomUUID → getRandomValues → time+random)
   * because the LAN device-testing path runs on an insecure origin where
   * randomUUID is absent; RN supplies expo-crypto. Uniqueness is the only
   * property required — ids are opaque merge keys, never parsed or ordered.
   */
  randomUUID(): string;
};

export type PlatformInit = {
  storage: StorageDriver;
  /** Origin prefix for the app's own API routes ('/api/...'). '' on web —
      relative, same-origin, byte-identical to the pre-seam fetches. RN
      supplies an absolute https origin. */
  apiBaseUrl?: string;
  lifecycle?: PlatformLifecycle;
  crypto?: PlatformCrypto;
};

let platform: PlatformInit | null = null;

/** Call once at platform boot. Calling again replaces the seam (dev-reload
    convenience; production calls this exactly once). */
export function initPlatform(init: PlatformInit): void {
  platform = init;
}

/** null until initPlatform() — treat as "no storage environment". */
export function getStorageDriver(): StorageDriver | null {
  return platform?.storage ?? null;
}

/** Resolve an app API path against the platform's origin. Uninitialised ⇒
    relative, which is the web's behaviour anyway. */
export function apiUrl(path: string): string {
  return `${platform?.apiBaseUrl ?? ''}${path}`;
}

/** Register a flush-signal listener with the platform's lifecycle. No
    lifecycle (server render, or a platform that hasn't wired one) ⇒ no
    signals, matching the old web behaviour where initSync never ran without
    a window. Returns an unsubscribe function. */
export function onFlushSignal(callback: () => void): () => void {
  return platform?.lifecycle?.onFlushSignal(callback) ?? (() => {});
}

/** The platform's crypto, or null when none was injected (server render /
    node tests) — callers fall back to their non-crypto id path. */
export function getPlatformCrypto(): PlatformCrypto | null {
  return platform?.crypto ?? null;
}
