import { NextResponse } from 'next/server';
import { requireAdmin } from '../_lib/requireAdmin';
import { getServiceRole } from '../_lib/serviceRole';
import { loadMarketingData } from '../_lib/instagram';
import { buildMarketingData } from '../_lib/marketingData';

export const dynamic = 'force-dynamic';

/** GET /api/marketing — the dashboard's data. Admins only; never returns tokens. */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  try {
    return NextResponse.json(buildMarketingData(await loadMarketingData(getServiceRole())));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
