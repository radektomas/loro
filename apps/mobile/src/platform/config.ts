/**
 * Platform constants for the RN drivers.
 *
 * Kept in one file so the two values that differ per environment are visible
 * together rather than buried in the modules that consume them.
 */

/**
 * The public Supabase Storage origin for the catalog snapshot bucket.
 *
 * Composed as <project>/storage/v1/object/public/<bucket>, and the loader
 * appends catalog/latest.json and catalog/<hash>.json to it — those two paths
 * are declared ONCE in core (catalogLoader.ts POINTER_PATH / snapshotPath) and
 * re-exported by the publisher, so this constant deliberately stops at the
 * bucket and must not spell them out again.
 *
 * The bucket is public-read (migration 20260804010000), so no anon key and no
 * Authorization header — a plain unauthenticated GET. That is why the catalog
 * loads before, and independently of, any sign-in.
 */
export const CATALOG_BASE_URL =
  'https://iqfsnkmtpffrepcedwih.supabase.co/storage/v1/object/public/loro-catalog';

/**
 * Origin for the app's OWN API routes (/api/...). The web passes '' because
 * its routes are same-origin; RN has no origin of its own and must pass an
 * absolute https:// URL.
 *
 * ⚠️ UNRESOLVED, AND DELIBERATELY LEFT EMPTY FOR THIS PHASE.
 *
 * Exactly one thing in core builds a URL with it — entitlements/state.ts's
 * fetch(apiUrl('/api/entitlements/grandfather')) — and that call only happens
 * behind a signed-in Supabase session. This phase never calls initSupabase, so
 * getSupabase() stays null, storage.initSync() no-ops, and nothing reaches an
 * API route. An empty value therefore cannot be exercised here.
 *
 * It must be set before entitlements are wired. The value is the web
 * deployment's origin, which has no custom domain yet — so it will be the
 * Vercel URL until one exists. EXPO_PUBLIC_* is read at BUNDLE time by
 * babel-preset-expo, not baked into the binary, so this can change without a
 * new native build.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_ORIGIN ?? '';

/**
 * The document origin the player page is served under, and the `origin`
 * playerVar it hands the IFrame API. They must be the SAME value — the API's
 * handshake compares them — which is why this is one constant.
 *
 * ⚠️ PLACEHOLDER, and it is the value the spike measured with. rn-lab used
 * https://example.com for exactly this reason: WKWebView needs a real,
 * reachable https origin for an inline-HTML document to be representative, and
 * the app had no origin of its own. Every §5e result was produced under it.
 *
 * Replace with the web deployment's origin once it exists — the same
 * unresolved value as EXPO_PUBLIC_API_ORIGIN above. Note the spike's own
 * warning: loro.vercel.app is NOT this app (verified 2026-08-02 — it serves an
 * unrelated page), so it must not be used as a stand-in.
 */
export const PLAYER_EMBED_ORIGIN =
  process.env.EXPO_PUBLIC_API_ORIGIN ?? 'https://example.com';

/**
 * Supabase project credentials, or empty strings when unset.
 *
 * BOTH ARE PUBLIC. The anon key is RLS-scoped and is meant to ship inside the
 * client — it is the same value the web serves to every browser. The service
 * role key is the one that must never come near this file.
 *
 * Empty is a supported resting state, not a misconfiguration: supabaseInit.ts
 * simply skips initSupabase, getSupabase() stays null, and the app runs fully
 * anonymously on MMKV. That is the same "unconfigured" contract core documents
 * (supabase.ts) and the web enforces via lib/supabaseInit.ts's env check.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Where auth providers send the user back to — the app's own URL scheme.
 *
 * The scheme half (`loro`) is app.json's `scheme`, which becomes a native
 * Info.plist entry at prebuild; changing one without the other silently breaks
 * every sign-in. The path half is arbitrary but mirrors the web's
 * /auth/callback so the two platforms read the same.
 *
 * ⚠️ MUST BE ON THE SUPABASE PROJECT'S REDIRECT URLS ALLOWLIST. An entry that
 * is missing is not rejected — it is silently replaced by the project's Site
 * URL, which on this SHARED project is another product's domain. Verified
 * present 2026-08-07.
 */
export const AUTH_REDIRECT_URL = 'loro://auth/callback';
