import { NextResponse } from 'next/server';
import { requireAdmin } from '../../_lib/requireAdmin';
import { getServiceRole } from '../../_lib/serviceRole';
import { syncAll } from '../../_lib/instagram';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET — the daily Vercel cron (vercel.json). Vercel sends
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on the
 * project; without it set, this refuses rather than running open.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set.' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return run();
}

/** POST — "Sync now" from the dashboard. Admins only. */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  return run();
}

async function run() {
  try {
    const results = await syncAll(getServiceRole());
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
