'use client';

import { useMemo, useState } from 'react';
import {
  accountBaseline,
  followerGains,
  hookLine,
  multipleOf,
  sharesSavesPer1k,
  type MarketingAccount,
  type MarketingData,
  type MarketingPost,
} from '@/lib/marketingStats';
import { Card, CardTitle, DASH, KpiCard } from './RadekDashboard';

/**
 * WHICH REELS WORK — getloro.app/marketing (2026-10-26).
 *
 * Radek's two experiment accounts (@loro.app, @radek.explains.spanish), read
 * daily from Instagram's official API. The organising idea is the multiple:
 * every reel against ITS account's usual views (median of the last 12 settled
 * posts), so a breakout on the small account is as visible as one on the big
 * one. Raw views are shown, but never ranked on.
 */

const fmt = new Intl.NumberFormat('en-GB');
const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const DAY = 86400 * 1000;

type Scored = MarketingPost & { multiple: number | null; ss1k: number | null; username: string };

/** ≥3× is a format worth repeating; under 1× a quiet one. Text carries it, colour only echoes. */
function MultipleBadge({ m }: { m: number | null }) {
  if (m == null) return <span style={{ color: DASH.faint }}>—</span>;
  const strong = m >= 3;
  const good = m >= 1.5;
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums"
      style={{
        background: strong ? DASH.greenSoft : good ? DASH.blueSoft : 'transparent',
        color: strong ? DASH.green : good ? DASH.blue : DASH.muted,
      }}
      title="Views against this account's usual reel (median of its last 12 settled posts)"
    >
      {m >= 10 ? Math.round(m) : m.toFixed(1)}× {strong ? 'breakout' : ''}
    </span>
  );
}

function Thumb({ post, size = 44 }: { post: MarketingPost; size?: number }) {
  return post.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={post.thumbnailUrl}
      alt=""
      width={size}
      height={Math.round(size * 1.6)}
      className="shrink-0 rounded-md object-cover"
      style={{ width: size, height: Math.round(size * 1.6), background: DASH.inset }}
      loading="lazy"
    />
  ) : (
    <div className="shrink-0 rounded-md" style={{ width: size, height: Math.round(size * 1.6), background: DASH.inset }} />
  );
}

const watch = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const n = (v: number | null | undefined) => (v == null ? '—' : fmt.format(v));

// ------------------------------------------------------------ best posts

function BestPosts({ posts }: { posts: Scored[] }) {
  const top = posts
    .filter((p) => Date.now() - new Date(p.postedAt).getTime() <= 14 * DAY && p.multiple != null)
    .sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))
    .slice(0, 5);
  return (
    <Card>
      <CardTitle
        title="What worked in the last 14 days"
        hint="Ranked by how far each post beat its own account's usual views — not by raw views. Repeat the format of anything marked breakout."
      />
      {top.length === 0 ? (
        <p className="text-sm" style={{ color: DASH.muted }}>
          Nothing to rank yet. A post needs a few days of numbers, and each account needs a few older posts to set its usual.
        </p>
      ) : (
        <ol className="grid gap-3">
          {top.map((p, i) => (
            <li key={p.mediaId} className="flex items-center gap-3 rounded-xl p-3" style={{ background: DASH.inset }}>
              <span className="w-5 text-center text-sm font-bold tabular-nums" style={{ color: DASH.faint }}>{i + 1}</span>
              <Thumb post={p} />
              <div className="min-w-0 flex-1">
                <a
                  href={p.permalink ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-semibold hover:underline"
                  style={{ color: DASH.ink }}
                >
                  {hookLine(p.caption) || '(no caption)'}
                </a>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: DASH.muted }}>
                  <span>@{p.username}</span>
                  <span>{dayLabel(p.postedAt)}</span>
                  <span className="tabular-nums">{n(p.latest?.views)} views</span>
                  <span className="tabular-nums">{n(p.latest?.shares)} shares</span>
                  <span className="tabular-nums">{n(p.latest?.saved)} saves</span>
                  {p.latest?.avgWatchMs != null && <span className="tabular-nums">{watch(p.latest.avgWatchMs)} avg watch</span>}
                </div>
              </div>
              <MultipleBadge m={p.multiple} />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ------------------------------------------------------- followers chart

/** Followers gained per day — one series, so no legend; the title names it. */
function FollowerGains({ account }: { account: MarketingAccount }) {
  const gains = followerGains(account.followers).slice(-30);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 120;
  const PAD = 18;
  const max = Math.max(1, ...gains.map((g) => Math.abs(g.gain)));
  const barW = gains.length ? (W / gains.length) - 2 : 0;
  const zero = H / 2;
  const current = account.followers[account.followers.length - 1]?.count;
  return (
    <Card>
      <CardTitle
        title={`@${account.username} · followers gained per day`}
        hint="Instagram doesn't say which reel brought a follower. A tall bar the day after a post is the closest thing to that answer."
        aside={current != null ? <span className="text-sm font-semibold tabular-nums">{fmt.format(current)} followers</span> : undefined}
      />
      {gains.length < 2 ? (
        <p className="text-sm" style={{ color: DASH.muted }}>Needs two or more days of syncs. The first bars appear after tomorrow morning&apos;s sync.</p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H + PAD}`} className="w-full" role="img" aria-label="Followers gained per day">
            <line x1={0} x2={W} y1={zero} y2={zero} stroke={DASH.line} strokeWidth={1} />
            {gains.map((g, i) => {
              const h = (Math.abs(g.gain) / max) * (H / 2 - 4);
              const x = i * (W / gains.length) + 1;
              const up = g.gain >= 0;
              return (
                <g key={g.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {/* Hit target: the full column, bigger than the mark. */}
                  <rect x={x - 1} y={0} width={barW + 2} height={H} fill="transparent" />
                  <rect
                    x={x}
                    y={up ? zero - h : zero}
                    width={Math.max(1, barW)}
                    height={Math.max(1, h)}
                    rx={Math.min(4, barW / 2)}
                    fill={up ? DASH.green : DASH.red}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                </g>
              );
            })}
            <text x={0} y={H + PAD - 4} fontSize={11} fill={DASH.faint}>{dayLabel(gains[0].day)}</text>
            <text x={W} y={H + PAD - 4} fontSize={11} fill={DASH.faint} textAnchor="end">{dayLabel(gains[gains.length - 1].day)}</text>
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 rounded-lg px-2.5 py-1.5 text-xs shadow"
              style={{
                left: `${((hover + 0.5) / gains.length) * 100}%`,
                transform: 'translateX(-50%)',
                background: DASH.page,
                border: `1px solid ${DASH.line}`,
                color: DASH.ink,
              }}
            >
              <div style={{ color: DASH.muted }}>{dayLabel(gains[hover].day)}</div>
              <div className="font-semibold tabular-nums">
                {gains[hover].gain >= 0 ? '+' : ''}{gains[hover].gain} followers
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ posts table

type SortKey = 'postedAt' | 'views' | 'multiple' | 'shares' | 'saved' | 'ss1k' | 'watch';

function PostsTable({ posts }: { posts: Scored[] }) {
  const [sort, setSort] = useState<SortKey>('postedAt');
  const value = (p: Scored, k: SortKey): number => {
    switch (k) {
      case 'postedAt': return new Date(p.postedAt).getTime();
      case 'views': return p.latest?.views ?? -1;
      case 'multiple': return p.multiple ?? -1;
      case 'shares': return p.latest?.shares ?? -1;
      case 'saved': return p.latest?.saved ?? -1;
      case 'ss1k': return p.ss1k ?? -1;
      case 'watch': return p.latest?.avgWatchMs ?? -1;
    }
  };
  const rows = [...posts].sort((a, b) => value(b, sort) - value(a, sort));
  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th className="px-2 py-2 text-right font-medium">
      <button onClick={() => setSort(k)} style={{ color: sort === k ? DASH.ink : DASH.muted }} className="hover:underline">
        {children}{sort === k ? ' ↓' : ''}
      </button>
    </th>
  );
  return (
    <Card>
      <CardTitle title="Every post" hint="Totals as of the last sync. Click a column to sort. Posts under 48 hours old are still climbing." />
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-xs" style={{ color: DASH.muted }}>
            <tr style={{ borderBottom: `1px solid ${DASH.line}` }}>
              <th className="px-2 py-2 text-left font-medium">Post</th>
              <Th k="postedAt">Posted</Th>
              <Th k="views">Views</Th>
              <Th k="multiple">× usual</Th>
              <Th k="shares">Shares</Th>
              <Th k="saved">Saves</Th>
              <Th k="ss1k">Shares+saves /1k</Th>
              <Th k="watch">Avg watch</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.mediaId} style={{ borderBottom: `1px solid ${DASH.line}` }}>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2.5">
                    <Thumb post={p} size={28} />
                    <div className="min-w-0 max-w-[280px]">
                      <a href={p.permalink ?? undefined} target="_blank" rel="noreferrer" className="block truncate hover:underline" style={{ color: DASH.ink }}>
                        {hookLine(p.caption, 70) || '(no caption)'}
                      </a>
                      <span className="text-xs" style={{ color: DASH.faint }}>
                        @{p.username} · {p.productType === 'REELS' ? 'Reel' : p.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Post'}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: DASH.muted }}>{dayLabel(p.postedAt)}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{n(p.latest?.views)}</td>
                <td className="px-2 py-2 text-right"><MultipleBadge m={p.multiple} /></td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.latest?.shares)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.latest?.saved)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{p.ss1k == null ? '—' : p.ss1k.toFixed(1)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{watch(p.latest?.avgWatchMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------- the view

export function MarketingDashboardView({ data }: { data: MarketingData }) {
  const [only, setOnly] = useState<string | 'all'>('all');

  const scored: Scored[] = useMemo(() => {
    const names = new Map(data.accounts.map((a) => [a.igUserId, a.username]));
    const baselines = new Map(
      data.accounts.map((a) => [a.igUserId, accountBaseline(data.posts.filter((p) => p.igUserId === a.igUserId))])
    );
    return data.posts.map((p) => ({
      ...p,
      username: names.get(p.igUserId) ?? '?',
      multiple: multipleOf(p.latest?.views, baselines.get(p.igUserId) ?? null),
      ss1k: sharesSavesPer1k(p.latest),
    }));
  }, [data]);

  const accounts = only === 'all' ? data.accounts : data.accounts.filter((a) => a.igUserId === only);
  const posts = only === 'all' ? scored : scored.filter((p) => p.igUserId === only);

  // This week against last week, by when the post went up.
  const inWindow = (p: Scored, from: number, to: number) => {
    const age = Date.now() - new Date(p.postedAt).getTime();
    return age >= from * DAY && age < to * DAY;
  };
  const thisWeek = posts.filter((p) => inWindow(p, 0, 7));
  const lastWeek = posts.filter((p) => inWindow(p, 7, 14));
  const sum = (ps: Scored[], f: (p: Scored) => number | null | undefined) => ps.reduce((s, p) => s + (f(p) ?? 0), 0);
  const followersNow = accounts.reduce((s, a) => s + (a.followers[a.followers.length - 1]?.count ?? 0), 0);
  const followersWeekAgo = accounts.reduce((s, a) => {
    const cutoff = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
    const old = [...a.followers].reverse().find((f) => f.day <= cutoff) ?? a.followers[0];
    return s + (old?.count ?? 0);
  }, 0);
  const bestThisWeek = Math.max(0, ...thisWeek.map((p) => p.multiple ?? 0));

  return (
    <div className="grid gap-5">
      {data.accounts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[{ id: 'all', label: 'Both accounts' }, ...data.accounts.map((a) => ({ id: a.igUserId, label: `@${a.username}` }))].map((t) => (
            <button
              key={t.id}
              onClick={() => setOnly(t.id)}
              className="rounded-full px-3.5 py-1.5 text-sm font-semibold"
              style={{
                background: only === t.id ? DASH.green : DASH.card,
                color: only === t.id ? DASH.page : DASH.ink,
                border: `1px solid ${only === t.id ? DASH.green : DASH.line}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Posts this week" value={String(thisWeek.length)} now={thisWeek.length} before={lastWeek.length} color={DASH.blue} caption="vs last week" />
        <KpiCard
          label="Views on this week's posts"
          value={compact.format(sum(thisWeek, (p) => p.latest?.views))}
          now={sum(thisWeek, (p) => p.latest?.views)}
          before={sum(lastWeek, (p) => p.latest?.views)}
          color={DASH.violet}
          caption="vs last week's posts"
        />
        <KpiCard
          label="Shares + saves this week"
          value={fmt.format(sum(thisWeek, (p) => (p.latest?.shares ?? 0) + (p.latest?.saved ?? 0)))}
          now={sum(thisWeek, (p) => (p.latest?.shares ?? 0) + (p.latest?.saved ?? 0))}
          before={sum(lastWeek, (p) => (p.latest?.shares ?? 0) + (p.latest?.saved ?? 0))}
          color={DASH.orange}
          caption="vs last week"
        />
        <KpiCard
          label="Followers"
          value={fmt.format(followersNow)}
          now={followersNow}
          before={followersWeekAgo}
          color={DASH.green}
          caption={`best post this week ${bestThisWeek ? `${bestThisWeek.toFixed(1)}×` : '—'}`}
        />
      </div>

      <BestPosts posts={posts} />

      <div className="grid gap-5 lg:grid-cols-2">
        {accounts.map((a) => <FollowerGains key={a.igUserId} account={a} />)}
      </div>

      <PostsTable posts={posts} />
    </div>
  );
}

// --------------------------------------------------- accounts & connecting

export function AccountsPanel({
  accounts,
  onConnect,
  connecting,
  connectError,
}: {
  accounts: MarketingAccount[];
  onConnect: (token: string) => void;
  connecting: boolean;
  connectError: string | null;
}) {
  const [token, setToken] = useState('');
  return (
    <Card>
      <CardTitle
        title="Connected accounts"
        hint="Synced every morning around 6–7am. The access token renews itself; if a red error appears here, generate a new token in Meta's app dashboard and paste it below."
      />
      <ul className="mb-4 grid gap-2">
        {accounts.length === 0 && <li className="text-sm" style={{ color: DASH.muted }}>No accounts connected yet.</li>}
        {accounts.map((a) => {
          const daysLeft = a.tokenExpiresAt ? Math.round((new Date(a.tokenExpiresAt).getTime() - Date.now()) / DAY) : null;
          return (
            <li key={a.igUserId} className="rounded-xl p-3 text-sm" style={{ background: DASH.inset }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">@{a.username}</span>
                <span className="text-xs" style={{ color: DASH.muted }}>
                  {a.lastSyncedAt ? `synced ${new Date(a.lastSyncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'not synced yet'}
                  {daysLeft != null && ` · token ${daysLeft} days left`}
                </span>
              </div>
              {a.lastError && <p className="mt-1.5 break-words text-xs" style={{ color: DASH.red }}>{a.lastError}</p>}
            </li>
          );
        })}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!token.trim() || connecting) return;
          onConnect(token.trim());
          setToken('');
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="password"
          autoComplete="off"
          aria-label="Instagram access token"
          placeholder="Paste an Instagram access token to connect an account"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-sm outline-none"
          style={{ border: `1px solid ${DASH.line}`, color: DASH.ink, background: DASH.page }}
        />
        <button
          type="submit"
          disabled={connecting || !token.trim()}
          className="rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-50"
          style={{ background: DASH.green, color: DASH.page }}
        >
          {connecting ? 'Connecting…' : 'Connect'}
        </button>
      </form>
      {connectError && <p className="mt-2 break-words text-sm" style={{ color: DASH.red }}>{connectError}</p>}
    </Card>
  );
}
