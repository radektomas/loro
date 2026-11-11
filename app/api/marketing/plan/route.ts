import { NextResponse } from 'next/server';
import { requireAdmin } from '../../_lib/requireAdmin';
import { getServiceRole } from '../../_lib/serviceRole';
import { resolvePlanStatus, type ItemStatus } from '@/lib/scalePlan';

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
    const { data: item, error } = await s
      .from('loro_scale_plan_items')
      .update({ status })
      .eq('id', b.itemId)
      .in('status', ['proposed', 'approved', 'rejected'])
      .select('plan_id')
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!item) return NextResponse.json({ error: 'That item is already cut or gone.' }, { status: 409 });
    // once nothing is waiting, the plan itself is decided
    const { data: items, error: e2 } = await s.from('loro_scale_plan_items').select('status').eq('plan_id', item.plan_id);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    const planStatus = resolvePlanStatus((items ?? []).map((i) => i.status as ItemStatus));
    const { error: e3 } = await s
      .from('loro_scale_plans')
      .update({ status: planStatus, decided_at: planStatus === 'proposed' ? null : now })
      .eq('id', item.plan_id)
      .neq('status', 'cut');
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (typeof b.planId === 'string') {
    const { error: e1 } = await s.from('loro_scale_plans').update({ status, decided_at: now }).eq('id', b.planId);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    // approving decides what's still waiting; rejecting also takes back items approved one by one
    const { error: e2 } = await s
      .from('loro_scale_plan_items')
      .update({ status })
      .eq('plan_id', b.planId)
      .in('status', status === 'rejected' ? ['proposed', 'approved'] : ['proposed']);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'planId or itemId is required.' }, { status: 400 });
}
