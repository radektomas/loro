import { NextResponse } from 'next/server';
import { requireAdmin } from '../../_lib/requireAdmin';
import { getServiceRole } from '../../_lib/serviceRole';
import { ACCOUNTS } from '@/lib/cutReels';

export const dynamic = 'force-dynamic';

/** The Monday of the week a date falls in, as YYYY-MM-DD. */
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** PUT /api/marketing/installs {channel, week, installs} — one week's App Store installs for a channel. Admins only. */
export async function PUT(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!ACCOUNTS.includes(b.channel as never)) return NextResponse.json({ error: 'Unknown channel.' }, { status: 400 });
  if (typeof b.week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.week)) return NextResponse.json({ error: 'week must be YYYY-MM-DD.' }, { status: 400 });
  const n = Number(b.installs);
  if (!Number.isInteger(n) || n < 0) return NextResponse.json({ error: 'installs must be a whole number.' }, { status: 400 });
  const { error } = await getServiceRole()
    .from('loro_marketing_installs')
    .upsert({ channel: b.channel, week: mondayOf(b.week), installs: n }, { onConflict: 'channel,week' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
