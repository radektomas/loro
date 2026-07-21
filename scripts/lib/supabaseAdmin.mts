import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env.mts';

/**
 * Service-role Supabase client — SERVER/CLI ONLY.
 *
 * This deliberately lives under scripts/ and NOT in lib/. Everything in lib/
 * is reachable from the client bundle, and a service-role key that reaches a
 * browser is a total compromise: it bypasses every RLS policy in the
 * database. Keeping the only createClient(SERVICE_ROLE) call outside the
 * Next.js source tree makes that mistake impossible to make by accident.
 *
 * lib/supabase.ts is the browser counterpart (anon key, RLS enforced), and
 * the two must never be merged.
 *
 * loro_video_candidates has RLS on with no policies, so this client is the
 * only thing in the codebase that can read or write it — the same posture
 * the n8n import workflow already uses for loro_videos.
 */

let client: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (client) return client;
  // NEXT_PUBLIC_SUPABASE_URL is the same project URL the app uses; only the
  // key differs. It is public by nature, so sharing the variable is fine.
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  client = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return client;
}
