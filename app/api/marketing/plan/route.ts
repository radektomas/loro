import { NextResponse } from 'next/server';
import { requireAdmin } from '../../_lib/requireAdmin';
import { getServiceRole } from '../../_lib/serviceRole';

export const dynamic = 'force-dynamic';

const DECISIONS = ['approved', 'rejected'] as const;

/**
 * PATCH /api/marketing/plan {planId, status} | {itemId, status} — Radek's
 * decision on the scaler's proposal. Approving a plan approves its items that
 * are still proposed; rejecting it rejects them. Admins only.
 */
export async function PATCH(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = b.status as (typeof DECISIONS)[number];
  if (!DECISIONS.includes(status)) return NextResponse.json({ error: 'status must be approved or rejected.' }, { status: 400 });
  const s = getServiceRole();
  const now = new Date().toISOString();

  if (typeof b.itemId === 'string') {
    const { error } = await s.from('loro_scale_plan_items').update({ status }).eq('id', b.itemId).in('status', ['proposed', 'approved', 'rejected']);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (typeof b.planId === 'string') {
    const { error: e1 } = await s.from('loro_scale_plans').update({ status, decided_at: now }).eq('id', b.planId);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    const { error: e2 } = await s.from('loro_scale_plan_items').update({ status }).eq('plan_id', b.planId).eq('status', 'proposed');
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'planId or itemId is required.' }, { status: 400 });
}
