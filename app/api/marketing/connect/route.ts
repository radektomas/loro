import { NextResponse } from 'next/server';
import { requireAdmin } from '../../_lib/requireAdmin';
import { getServiceRole } from '../../_lib/serviceRole';
import { connectAccount } from '../../_lib/instagram';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/marketing/connect { token } — store an Instagram access token
 * generated in Meta's app dashboard, after checking it against Instagram.
 * Admins only. The token is written server-side and never echoed back.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'Paste the access token first.' }, { status: 400 });

  try {
    const result = await connectAccount(getServiceRole(), token);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
