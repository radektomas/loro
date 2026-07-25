import { NextResponse } from 'next/server';
import {
  getServiceRole,
  ServiceRoleNotConfiguredError,
} from '../../_lib/serviceRole';
import {
  bearerToken,
  deleteAccount,
  type AdminLike,
} from '../../_lib/accountDeletion';

/**
 * Delete the signed-in user's account — GDPR + App Store 5.1.1(v).
 *
 * Identity comes EXCLUSIVELY from the verified Bearer token (the established
 * pattern from /api/creator/import): the request body is never read, so a
 * user_id smuggled into it is inert by construction, not by validation.
 *
 * Client errors are deliberately generic — Supabase error detail is logged
 * server-side only. The response's `authDeleted: false` variant means the
 * cross-product guard found this sign-in in use by other products sharing
 * the database: Loro's data is fully deleted, the sign-in itself is removed
 * separately (see accountDeletion.ts).
 */
export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: 'Account deletion is not configured.' },
      { status: 503 }
    );
  }

  const token = bearerToken(req.headers.get('authorization'));
  if (!token) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  // Verify the JWT against Supabase Auth and resolve the real user id.
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!userRes.ok) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }
  const user = (await userRes.json()) as { id?: string };
  if (!user.id) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }

  let admin;
  try {
    admin = getServiceRole();
  } catch (error) {
    if (error instanceof ServiceRoleNotConfiguredError) {
      // Loud and specific in the logs (names the missing env var and where
      // to add it), generic to the client.
      console.error(`[account-delete] ${error.message}`);
      return NextResponse.json(
        { error: 'Account deletion is not configured.' },
        { status: 503 }
      );
    }
    throw error;
  }

  // One deliberate cast at the seam: SupabaseClient satisfies AdminLike
  // structurally (the test fake proves the shape), but its generics are deep
  // enough that tsc gives up on proving it ("type instantiation is
  // excessively deep").
  const result = await deleteAccount(admin as unknown as AdminLike, user.id);

  if (!result.ok) {
    if (result.status === 403) {
      return NextResponse.json(
        { error: "Admin accounts can't be deleted from the app." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: 'Deletion failed.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, authDeleted: result.authDeleted });
}
