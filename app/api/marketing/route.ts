import { NextResponse } from 'next/server';
import { requireAdmin } from '../_lib/requireAdmin';
import { getServiceRole } from '../_lib/serviceRole';
import { loadMarketingData } from '../_lib/instagram';
import type { MarketingAccount, MarketingData, MarketingPost } from '@/lib/marketingStats';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** GET /api/marketing — the dashboard's data. Admins only; never returns tokens. */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  try {
    const raw = await loadMarketingData(getServiceRole());

    const followersBy = new Map<string, { day: string; count: number }[]>();
    for (const r of raw.accountDaily as Row[]) {
      if (r.followers_count == null) continue;
      const id = String(r.ig_user_id);
      if (!followersBy.has(id)) followersBy.set(id, []);
      followersBy.get(id)!.push({ day: String(r.day), count: Number(r.followers_count) });
    }

    const dailyBy = new Map<string, Row[]>();
    for (const r of raw.mediaDaily as Row[]) {
      const id = String(r.media_id);
      if (!dailyBy.has(id)) dailyBy.set(id, []);
      dailyBy.get(id)!.push(r);
    }

    const accounts: MarketingAccount[] = (raw.accounts as Row[]).map((a) => ({
      igUserId: String(a.ig_user_id),
      username: String(a.username),
      connectedAt: String(a.connected_at),
      lastSyncedAt: (a.last_synced_at as string) ?? null,
      lastError: (a.last_error as string) ?? null,
      tokenExpiresAt: (a.token_expires_at as string) ?? null,
      followers: followersBy.get(String(a.ig_user_id)) ?? [],
    }));

    const posts: MarketingPost[] = (raw.media as Row[]).map((m) => {
      const days = dailyBy.get(String(m.media_id)) ?? []; // oldest first
      const last = days[days.length - 1];
      return {
        mediaId: String(m.media_id),
        igUserId: String(m.ig_user_id),
        caption: (m.caption as string) ?? null,
        mediaType: (m.media_type as string) ?? null,
        productType: (m.media_product_type as string) ?? null,
        permalink: (m.permalink as string) ?? null,
        thumbnailUrl: (m.thumbnail_url as string) ?? null,
        postedAt: String(m.posted_at),
        latest: last
          ? {
              views: num(last.views),
              reach: num(last.reach),
              likes: num(last.likes),
              comments: num(last.comments),
              shares: num(last.shares),
              saved: num(last.saved),
              reposts: num(last.reposts),
              avgWatchMs: num(last.avg_watch_ms),
            }
          : null,
        viewsByDay: days.filter((d) => d.views != null).map((d) => ({ day: String(d.day), views: Number(d.views) })),
      };
    });

    const data: MarketingData = { accounts, posts };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
