import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — ROUTE HANDLERS ONLY.
 *
 * Modelled on scripts/lib/supabaseAdmin.mts, which stays the CLI's copy. This
 * one exists for the single server-side operation that cannot run under RLS:
 * account deletion (/api/account/delete), which must delete rows across every
 * loro_ table and remove the auth user itself.
 *
 * Why it lives under app/api/_lib and not lib/: lib/ is importable from
 * client components, and the repo's standing rule is that the service role
 * key never gets a path into the client bundle. An underscore folder inside
 * app/api is not routable and is only reachable from server code that
 * deliberately imports it. The runtime guard below is the backstop for the
 * remaining accident: a client module importing through it anyway would
 * throw at import time in the browser, where process.env has no service key
 * to leak.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'app/api/_lib/serviceRole.ts was imported in the browser. This module is server-only.'
  );
}

/** Thrown when the deployment has no service role key — see getServiceRole. */
export class ServiceRoleNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Service role client is not configured: missing ${missing.join(', ')}. ` +
        'Account deletion needs SUPABASE_SERVICE_ROLE_KEY (server-only, never ' +
        'NEXT_PUBLIC_) alongside NEXT_PUBLIC_SUPABASE_URL. On Vercel, add it ' +
        'under Project Settings -> Environment Variables; it exists only in ' +
        'the local .env until someone does.'
    );
    this.name = 'ServiceRoleNotConfiguredError';
  }
}

/**
 * Build the client per call rather than caching a singleton: route handlers
 * are the only consumers, the construction is cheap, and a cached client
 * would hide a mid-deploy env change behind a warm lambda.
 */
export function getServiceRole(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    ...(url ? [] : ['NEXT_PUBLIC_SUPABASE_URL']),
    ...(key ? [] : ['SUPABASE_SERVICE_ROLE_KEY']),
  ];
  if (missing.length > 0) throw new ServiceRoleNotConfiguredError(missing);
  return createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
