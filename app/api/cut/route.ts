import { NextResponse } from 'next/server';
import { requireAdmin } from '../_lib/requireAdmin';
import { getServiceRole } from '../_lib/serviceRole';
import {
  CUT_BUCKET,
  hookStats,
  shortcodeOf,
  type CutReel,
  type CutStatus,
} from '@/lib/cutReels';
import { scorePosts } from '@/lib/scaleStats';
import type { MarketingPost } from '@/lib/marketingStats';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const SIGNED_FOR_S = 60 * 60 * 6;

/**
 * GET /api/cut — every reel with its notes, a signed URL for the current
 * version, and the hook ranking. Admins only.
 *
 * Views: a reel linked to a post synced on /marketing takes Instagram's latest
 * number; otherwise the number Radek typed. A typed link whose shortcode
 * matches a synced post links itself here, so connecting an account on
 * /marketing upgrades every old reel without retyping anything.
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const s = getServiceRole();
  try {
    const [{ data: reels, error: e1 }, { data: notes, error: e2 }, { data: media }] = await Promise.all([
      s.from('loro_cut_reels').select('*').order('created_at', { ascending: false }).limit(500),
      s.from('loro_cut_notes').select('*').order('at_s'),
      s.from('loro_marketing_ig_media').select('media_id, ig_user_id, permalink, posted_at, media_type, media_product_type').limit(5000),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const mediaByCode = new Map<string, string>();
    for (const m of (media ?? []) as Row[]) {
      const code = shortcodeOf(m.permalink as string);
      if (code) mediaByCode.set(code, String(m.media_id));
    }
    const mediaIdOf = (r: Row): string | null =>
      (r.ig_media_id as string) ?? mediaByCode.get(shortcodeOf(r.permalink as string) ?? '') ?? null;

    // every synced reel's latest views, so a /cut reel can be scored against
    // its channel's usual reel at the time it went up
    const daily: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await s.from('loro_marketing_ig_media_daily').select('media_id, day, views').order('day').range(from, from + 999);
      if (error) throw new Error(error.message);
      daily.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    const igViews = new Map<string, number>();
    for (const d of daily) if (d.views != null) igViews.set(String(d.media_id), Number(d.views)); // last day wins
    const igPosts: MarketingPost[] = ((media ?? []) as Row[])
      .filter((m) => m.media_product_type === 'REELS' || m.media_type === 'VIDEO')
      .map((m) => ({
        mediaId: String(m.media_id),
        igUserId: String(m.ig_user_id),
        caption: null,
        mediaType: (m.media_type as string) ?? null,
        productType: (m.media_product_type as string) ?? null,
        permalink: (m.permalink as string) ?? null,
        thumbnailUrl: null,
        postedAt: String(m.posted_at),
        latest: igViews.has(String(m.media_id))
          ? { views: igViews.get(String(m.media_id))!, reach: null, likes: null, comments: null, shares: null, saved: null, reposts: null, avgWatchMs: null, skipRate: null, viewTotalMs: null }
          : null,
        viewsByDay: [],
      }));
    const scored = new Map(scorePosts(igPosts, new Map()).map((p) => [p.mediaId, p]));

    const paths = (reels ?? []).flatMap((r) => [r.video_path, r.poster_path].filter(Boolean) as string[]);
    const signed = new Map<string, string>();
    if (paths.length) {
      const { data, error } = await s.storage.from(CUT_BUCKET).createSignedUrls(paths, SIGNED_FOR_S);
      if (error) throw new Error(`signed urls: ${error.message}`);
      for (const x of data ?? []) if (x.path && x.signedUrl) signed.set(x.path, x.signedUrl);
    }

    const out: CutReel[] = ((reels ?? []) as Row[]).map((r) => {
      const mid = mediaIdOf(r);
      const ig = mid ? igViews.get(mid) : undefined;
      const manual = r.manual_views == null ? null : Number(r.manual_views);
      return {
        id: String(r.id),
        account: r.account as CutReel['account'],
        batch: String(r.batch),
        slot: Number(r.slot),
        version: Number(r.version),
        hook: String(r.hook),
        lines: (r.lines as CutReel['lines']) ?? [],
        durationS: Number(r.duration_s),
        videoUrl: signed.get(String(r.video_path)) ?? null,
        posterUrl: r.poster_path ? signed.get(String(r.poster_path)) ?? null : null,
        meFile: (r.me_file as string) ?? null,
        demoFile: (r.demo_file as string) ?? null,
        status: r.status as CutStatus,
        permalink: (r.permalink as string) ?? null,
        igMediaId: mid,
        views: ig ?? manual,
        viewsSource: ig != null ? 'instagram' : manual != null ? 'manual' : null,
        multiple: mid && scored.get(mid)?.settled ? scored.get(mid)!.multiple : null,
        postedAt: (r.posted_at as string) ?? null,
        createdAt: String(r.created_at),
        notes: ((notes ?? []) as Row[])
          .filter((n) => n.reel_id === r.id)
          .map((n) => ({
            id: String(n.id),
            reelId: String(n.reel_id),
            version: Number(n.version),
            atS: Number(n.at_s),
            body: String(n.body),
            createdAt: String(n.created_at),
            doneVersion: n.done_version == null ? null : Number(n.done_version),
            reply: (n.reply as string) ?? null,
          })),
      };
    });

    // what the Claude chats on Radek's Mac are doing (scripts/cut/wait-notes.mts)
    let worker: { state: string; noteIds: string[]; at: string } | null = null;
    const { data: w } = await s.storage.from(CUT_BUCKET).download("_worker.json");
    if (w) worker = JSON.parse(await w.text().catch(() => 'null'));

    return NextResponse.json({ reels: out, hooks: hookStats(out), worker });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const STATUSES: CutStatus[] = ['review', 'approved', 'posted', 'dropped'];

/** PATCH /api/cut — {id, status?, permalink?, manualViews?} */
export async function PATCH(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    status?: CutStatus;
    permalink?: string | null;
    manualViews?: number | null;
  };
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const patch: Row = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: 'bad status' }, { status: 400 });
    patch.status = body.status;
    if (body.status === 'posted') patch.posted_at = new Date().toISOString();
  }
  if (body.permalink !== undefined) {
    const link = body.permalink?.trim() || null;
    if (link && !shortcodeOf(link)) return NextResponse.json({ error: 'That is not an Instagram reel link.' }, { status: 400 });
    patch.permalink = link;
    patch.ig_media_id = null; // re-matched from the link on the next read
  }
  if (body.manualViews !== undefined) {
    const v = body.manualViews;
    if (v != null && (!Number.isFinite(v) || v < 0)) return NextResponse.json({ error: 'bad views' }, { status: 400 });
    patch.manual_views = v == null ? null : Math.round(v);
  }
  const { error } = await getServiceRole().from('loro_cut_reels').update(patch).eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
