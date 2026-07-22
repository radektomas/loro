import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client — PUBLIC DATA ONLY.
 *
 * The app's normal client (lib/supabase.ts) is browser-only by design: it
 * returns null on the server and keeps the session in localStorage. This one
 * exists for the single case where public data must be readable during a
 * server render — the creator profile page and its link preview, which have
 * to be crawlable and fast without waiting on client-side hydration.
 *
 * Rules for anything using this client:
 *
 *  1. ANON KEY ONLY. Never the service role key — this client is used in
 *     rendering paths for pages served to anyone, and a service-role client
 *     bypasses RLS entirely. RLS is what makes these reads safe: it is the
 *     only thing standing between a public page and every pending creator
 *     application.
 *  2. READ ONLY, and only data whose RLS policy already grants public
 *     access (approved creators, published videos).
 *  3. NO SESSION. There is no signed-in user on the server — auth lives in
 *     browser localStorage. Anything that depends on WHO is viewing must be
 *     a client component. auth.uid() is null in every query made here, so
 *     any own-row policy simply returns nothing.
 *
 * Returns null when Supabase isn't configured, exactly like the browser
 * client, so a misconfigured deployment degrades to "no profile" instead of
 * throwing during render.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        // Nothing to persist or refresh: every request is anonymous.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
