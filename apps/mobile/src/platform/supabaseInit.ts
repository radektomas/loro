import { initSupabase } from '@loro/core/supabase';
import { AUTH_REDIRECT_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { mmkv } from './storage';

/**
 * RN bootstrap for @loro/core's Supabase factory — the sibling of the web's
 * lib/supabaseInit.ts, and it follows the same rules for the same reasons.
 *
 * 1. IT CONFIGURES, IT DOES NOT CONNECT. initSupabase only records the config
 *    and drops the memoised client; the client is built lazily on the first
 *    getSupabase(). So calling this at boot costs nothing and reaches no
 *    network.
 *
 * 2. UNCONFIGURED IS A SUPPORTED STATE. With either credential missing we
 *    simply do not call initSupabase, getSupabase() keeps returning null, and
 *    every auth and sync entry point in core no-ops — the app runs anonymously
 *    on MMKV, which is Loro's resting state rather than a degraded one.
 *
 * 3. AUTHSTORAGE IS MANDATORY HERE, unlike on web. supabase-js defaults to
 *    localStorage, which does not exist in RN; without an adapter the session
 *    lives in memory and every cold start silently signs the user out.
 *
 * EXPORTED AS A FUNCTION RATHER THAN RUN ON IMPORT, which is the one place
 * this deliberately diverges from the web. `import './supabaseInit'` would be
 * hoisted above boot.ts's own module body, so the init would run BEFORE
 * initPlatform no matter where the import line sat — an ordering that is
 * invisible in the source and would be "corrected" by anyone tidying imports.
 * boot.ts is this app's single ordering authority; a call it makes explicitly
 * is a sequence you can read.
 */

/** True when both credentials are present — mirrors the web's
    `isSupabaseConfigured`, which its sign-in UI renders against. */
export const authEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function initAuth(): void {
  if (!authEnabled) return;
  initSupabase({
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    /**
     * MMKV, directly — not the StorageDriver.
     *
     * core's SupabaseAuthStorage wants getItem/setItem/removeItem returning
     * `string | null` (or a promise); the driver's `local` layer already has
     * exactly that shape, but passing the driver would hand supabase-js the
     * whole object including clearByPrefix and the session layer. This is the
     * three methods it asks for, over the same store, so the session lands in
     * the same on-disk file as everything else and survives a cold start.
     *
     * SYNCHRONOUS ON PURPOSE. supabase-js accepts a promise-returning adapter,
     * but MMKV's reads are sync and there is no reason to wrap them — an async
     * adapter would make session restore land a tick later, after the first
     * render has already decided the user is anonymous.
     *
     * The keys supabase-js writes are prefixed `loro.auth` (storageKey in
     * core's supabase.ts), which puts them inside the `loro.` sweep that
     * account deletion and switch-user already walk. A deleted account's
     * session is therefore dropped for free, exactly as on web.
     */
    authStorage: {
      getItem: (key) => mmkv.getString(key) ?? null,
      setItem: (key, value) => {
        mmkv.set(key, value);
      },
      removeItem: (key) => {
        mmkv.remove(key);
      },
    },
    /**
     * A constant, not a thunk. The web passes a function because
     * window.location.origin differs between localhost, previews and prod and
     * must be read at call time; an app scheme is fixed at build time, so
     * there is nothing to defer.
     */
    redirectTo: AUTH_REDIRECT_URL,
  });
}
