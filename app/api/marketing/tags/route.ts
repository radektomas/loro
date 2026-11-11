import { NextResponse } from 'next/server';
import { requireAdmin } from '../../_lib/requireAdmin';
import { getServiceRole } from '../../_lib/serviceRole';
import { DEMO_KINDS, FORMATS, HOOK_KINDS, inferHookKind } from '@/lib/scaleStats';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/marketing/tags {mediaId, hook?, format?, demoKind?, hookKind?}
 * Radek's correction of what a post is. Marks the row manual, so the enrich
 * script never overwrites it. Admins only.
 */
export async function PATCH(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mediaId = typeof b.mediaId === 'string' ? b.mediaId : '';
  if (!mediaId) return NextResponse.json({ error: 'mediaId is required.' }, { status: 400 });

  const patch: Record<string, unknown> = { media_id: mediaId, manual: true, updated_at: new Date().toISOString() };
  if (b.hook !== undefined) {
    const hook = typeof b.hook === 'string' ? b.hook.trim() : '';
    patch.hook = hook || null;
    patch.hook_source = hook ? 'manual' : null;
    if (hook && b.hookKind === undefined) patch.hook_kind = inferHookKind(hook);
  }
  if (b.format !== undefined) {
    if (!FORMATS.includes(b.format as never)) return NextResponse.json({ error: 'Unknown format.' }, { status: 400 });
    patch.format = b.format;
  }
  if (b.demoKind !== undefined) {
    if (!DEMO_KINDS.includes(b.demoKind as never)) return NextResponse.json({ error: 'Unknown demo kind.' }, { status: 400 });
    patch.demo_kind = b.demoKind;
  }
  if (b.hookKind !== undefined) {
    if (b.hookKind !== null && !HOOK_KINDS.includes(b.hookKind as never)) return NextResponse.json({ error: 'Unknown hook kind.' }, { status: 400 });
    patch.hook_kind = b.hookKind;
  }
  const { error } = await getServiceRole().from('loro_marketing_post_tags').upsert(patch, { onConflict: 'media_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
