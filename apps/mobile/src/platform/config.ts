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
