import { NextResponse } from 'next/server';
import { requireAdmin } from '../_lib/requireAdmin';
import { getServiceRole } from '../_lib/serviceRole';
import { loadMarketingData } from '../_lib/instagram';
import type { MarketingAccount, MarketingData, MarketingPost, ScalePlan } from '@/lib/marketingStats';
import type { PostTags } from '@/lib/scaleStats';
import type { Account } from '@/lib/cutReels';
import { shortcodeOf } from '@/lib/cutReels';

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
              skipRate: num(last.skip_rate),
              viewTotalMs: num(last.view_total_ms),
            }
          : null,
        viewsByDay: days.filter((d) => d.views != null).map((d) => ({ day: String(d.day), views: Number(d.views) })),
      };
    });

    const tags: Record<string, PostTags> = {};
    for (const t of raw.tags as Row[]) {
      tags[String(t.media_id)] = {
        hook: (t.hook as string) ?? null,
        hookSource: (t.hook_source as PostTags['hookSource']) ?? null,
        hookKind: (t.hook_kind as PostTags['hookKind']) ?? null,
        format: t.format as PostTags['format'],
        demoKind: t.demo_kind as PostTags['demoKind'],
        line1Variant: (t.line1_variant as string) ?? null,
        voice: (t.voice as PostTags['voice']) ?? null,
        cutReelId: (t.cut_reel_id as string) ?? null,
        manual: Boolean(t.manual),
      };
    }

    const tapCount = new Map<string, number>();
    for (const t of raw.taps as Row[]) {
      const k = `${t.channel}|${String(t.at).slice(0, 10)}`;
      tapCount.set(k, (tapCount.get(k) ?? 0) + 1);
    }
    const taps = [...tapCount].map(([k, n]) => {
      const [channel, day] = k.split('|');
      return { channel: channel as Account, day, taps: n };
    });

    const installs = (raw.installs as Row[]).map((r) => ({ channel: r.channel as Account, week: String(r.week), installs: Number(r.installs) }));

    const plans: ScalePlan[] = (raw.plans as Row[]).map((p) => ({
      id: String(p.id),
      batch: String(p.batch),
      status: p.status as ScalePlan['status'],
      summary: (p.summary as string) ?? null,
      createdAt: String(p.created_at),
      decidedAt: (p.decided_at as string) ?? null,
      items: (raw.planItems as Row[])
        .filter((i) => i.plan_id === p.id)
        .map((i) => ({
          id: String(i.id),
          slot: Number(i.slot),
          account: i.account as Account,
          meFile: String(i.me_file),
          demoFile: String(i.demo_file),
          hook: String(i.hook),
          hookKind: (i.hook_kind as string) ?? null,
          line1Variant: (i.line1_variant as string) ?? null,
          voice: (i.voice as string) ?? null,
          demoKind: (i.demo_kind as string) ?? null,
          role: i.role as 'exploit' | 'test',
          reason: String(i.reason),
          expectedMultiple: num(i.expected_multiple),
          status: i.status as ScalePlan['status'],
          cutReelId: (i.cut_reel_id as string) ?? null,
        })),
    }));

    // the /cut reel behind each post: an explicit ig_media_id, else the pasted link
    const mediaByCode = new Map<string, string>();
    for (const p of posts) {
      const c = shortcodeOf(p.permalink);
      if (c) mediaByCode.set(c, p.mediaId);
    }
    const cutReels: MarketingData['cutReels'] = {};
    for (const r of raw.cutReels as Row[]) {
      const mid = (r.ig_media_id as string) ?? mediaByCode.get(shortcodeOf(r.permalink as string) ?? '');
      if (mid) cutReels[mid] = { id: String(r.id), account: r.account as Account, batch: String(r.batch), slot: Number(r.slot) };
    }

    const data: MarketingData = { accounts, posts, tags, taps, installs, plans, cutReels };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
