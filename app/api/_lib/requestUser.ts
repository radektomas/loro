import { bearerToken } from './accountDeletion';

/**
 * Resolve the signed-in user from a request's Authorization header.
 *
 * Identity comes EXCLUSIVELY from the verified Bearer token — the same rule
 * /api/account/delete and /api/creator/import follow. No route may read a user
 * id from a body or a query string: a smuggled id is then inert by
 * construction rather than by remembering to validate it.
 *
 * Extracted here because the entitlement routes need it twice and the seam is
 * where a mistake would be expensive: /api/entitlements/grandfather writes a
 * column that grants unlimited saves. (/api/account/delete predates this
 * helper and still verifies inline; it is not worth churning that route to
 * share four lines.)
 */

export type RequestUser =
  | { ok: true; userId: string; token: string }
  | { ok: false; status: 401 | 503; error: string };

export async function requestUser(req: Request): Promise<RequestUser> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 503, error: 'Not configured.' };
  }

  const token = bearerToken(req.headers.get('authorization'));
  if (!token) return { ok: false, status: 401, error: 'Not signed in.' };

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, status: 401, error: 'Invalid session.' };

  const user = (await res.json()) as { id?: string };
  if (!user.id) return { ok: false, status: 401, error: 'Invalid session.' };

  return { ok: true, userId: user.id, token };
}
