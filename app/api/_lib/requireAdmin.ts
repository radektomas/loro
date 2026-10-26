import { requestUser } from './requestUser';

export type AdminCheck = { ok: true; userId: string } | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * The caller must be signed in AND be in loro_admins. Asked of the database
 * with the caller's own token — loro_is_admin() reads auth.uid() — so the
 * answer comes from the same rule that guards the analytics RPCs, not from a
 * list kept in code.
 */
export async function requireAdmin(req: Request): Promise<AdminCheck> {
  const who = await requestUser(req);
  if (!who.ok) return who;
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/loro_is_admin`, {
    method: 'POST',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      authorization: `Bearer ${who.token}`,
      'content-type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, status: 503, error: `loro_is_admin: HTTP ${res.status}` };
  if ((await res.json()) !== true) return { ok: false, status: 403, error: 'Admins only.' };
  return { ok: true, userId: who.userId };
}
