import { NextResponse } from 'next/server';
import { requireAdmin } from '../../_lib/requireAdmin';
import { getServiceRole } from '../../_lib/serviceRole';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cut/notes — {reelId, atS, body}: a note pinned to a second of the
 * reel's CURRENT version. Claude reads open notes with scripts/cut/notes.mts.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const b = (await req.json().catch(() => ({}))) as { reelId?: string; atS?: number; body?: string };
  const text = b.body?.trim();
  if (!b.reelId || !text || typeof b.atS !== 'number' || !Number.isFinite(b.atS) || b.atS < 0) {
    return NextResponse.json({ error: 'reelId, atS and body are required' }, { status: 400 });
  }
  const s = getServiceRole();
  const { data: reel, error: e1 } = await s.from('loro_cut_reels').select('version').eq('id', b.reelId).maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!reel) return NextResponse.json({ error: 'No such reel.' }, { status: 404 });
  const { data, error } = await s
    .from('loro_cut_notes')
    .insert({ reel_id: b.reelId, version: reel.version, at_s: Math.round(b.atS * 10) / 10, body: text.slice(0, 2000) })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

/** DELETE /api/cut/notes?id=… — only notes no recut has answered yet. */
export async function DELETE(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const { error } = await getServiceRole().from('loro_cut_notes').delete().eq('id', id).is('done_version', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
