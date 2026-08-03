import { initSupabase } from '@loro/core/supabase';

/**
 * Web bootstrap for the @loro/core Supabase client, plus the web's
 * "does auth exist at all" render flag.
 *
 * This runs as an IMPORT SIDE EFFECT (module scope, not a React effect),
 * imported at the top of components/SyncInit.tsx — which the root layout
 * mounts on every route. Module evaluation completes before React hydrates,
 * and every consumer of the client calls it from an effect, an event handler
 * or the sync engine, so the factory is always configured before first use.
 * An effect would be too late: child effects run before the root's.
 *
 * The browser gate below replaces the old `typeof window === 'undefined'`
 * guard that lived inside lib/supabase.ts. On the server this module still
 * evaluates (SSR renders client components too), but core is simply never
 * initialised there, so getSupabase() keeps returning null during SSR and in
 * API routes — the session-free-server rule documented in
 * lib/supabaseServer.ts holds by construction, not by a guard in core.
 *
 * redirectTo is built from window.location.origin rather than an env var on
 * purpose: localhost, tunnel previews and production each return to
 * themselves with no per-environment configuration. It is a function so the
 * origin is read at call time — byte-identical to the old lib/auth.ts
 * behaviour. Supabase only honours it if the URL matches the project's
 * Redirect URLs allowlist; a missing origin is silently replaced by the Site
 * URL, which looks exactly like a bug in here. Add each origin (and a
 * wildcard for preview URLs) in the dashboard.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Env-derived — NOT init-derived — so the server render and the client
    hydration pass agree on whether sign-in UI exists. */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const authEnabled = isSupabaseConfigured;

if (isSupabaseConfigured && typeof window !== 'undefined') {
  initSupabase({
    url: url!,
    anonKey: anonKey!,
    // No authStorage: supabase-js keeps its localStorage default on web.
    redirectTo: () => `${window.location.origin}/auth/callback`,
  });
}
