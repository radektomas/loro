import * as Crypto from 'expo-crypto';
import type { PlatformCrypto } from '@loro/core/platform';

/**
 * Event ids for the starter-deck and paywall funnels.
 *
 * Uniqueness is the only property core asks for — the ids are opaque merge
 * keys, never parsed and never ordered — but they ARE merge keys, so a
 * collision silently unions two different events into one and quietly loses a
 * row of funnel data.
 *
 * The same three-step chain the web documents, for the same reason: each step
 * covers a way the one above it can be missing. On RN both native steps come
 * from expo-crypto and are present in any dev or production build; they can
 * still fail if the native module did not link (a JS-only reload against a
 * stale binary, Expo Go). The last resort keeps ids flowing in that case rather
 * than throwing from inside a logging call.
 */
export const platformCrypto: PlatformCrypto = {
  randomUUID() {
    try {
      return Crypto.randomUUID();
    } catch {
      // Native module missing — fall through rather than take down the caller.
    }
    try {
      const bytes = Crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Same, one level down.
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  },
};
