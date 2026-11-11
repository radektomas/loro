'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Card, CardTitle, DASH } from '../RadekDashboard';
import { baselineAt, type ScoredPost } from '@/lib/scaleStats';
import type { Model } from './ScaleDashboard';
import { GO_SLUGS } from '@/lib/goLinks';
import { CHANNELS, ChannelChip, Cover, DAY_MS, Empty, MultipleBadge, Sparkline, compact, day, fmt } from './ui';

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const lastDays = (n: number) => Array.from({ length: n }, (_, i) => isoDay(Date.now() - (n - 1 - i) * DAY_MS));
const mondayOf = (t: number) => {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

export function Overview({ m, accountsPanel, goto }: { m: Model; accountsPanel: ReactNode; goto: (t: 'reels' | 'winners' | 'plan') => void }) {
  const { data, reels } = m;
  const connected = CHANNELS.map((c) => ({ c, acct: data.accounts.find((a) => a.username === c.account) })).filter((x) => x.acct);

  const recentWinners = useMemo(
    () =>
      reels
        .filter((r) => r.settled && r.multiple != null && Date.now() - new Date(r.postedAt).getTime() < 14 * DAY_MS)
        .sort((a, b) => b.multiple! - a.multiple!)
        .slice(0, 5),
    [reels]
  );

  if (data.accounts.length === 0) {
    return (
      <div className="grid gap-5">
        <Empty>No Instagram account is connected yet. Paste an access token below to start.</Empty>
        {accountsPanel}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 lg:grid-cols-3">
        {connected.map(({ c, acct }) => (
          <ChannelCard key={c.account} m={m} account={c.account} color={c.color} igUserId={acct!.igUserId} followers={acct!.followers} />
        ))}
      </div>

      <Card>
        <CardTitle
          title="Best reels of the last 2 weeks"
          hint="Across all three channels, each scored against its own channel's usual reel. Reels under 48 hours old aren't ranked yet."
          aside={<button onClick={() => goto('reels')} className="text-sm font-semibold" style={{ color: DASH.green }}>All reels →</button>}
        />
        {recentWinners.length === 0 ? (
          <Empty>Nothing settled from the last 2 weeks yet.</Empty>
        ) : (
          <ol className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            {recentWinners.map((r, i) => (
              <li key={r.mediaId} className="flex gap-3 rounded-xl p-2.5 lg:flex-col" style={{ background: DASH.inset }}>
                <div className="relative">
                  <Cover src={r.thumbnailUrl} w={64} href={r.permalink} />
                  <span className="absolute left-1 top-1 rounded-md px-1.5 text-[11px] font-black" style={{ background: DASH.page, color: DASH.ink }}>#{i + 1}</span>
                </div>
                <div className="min-w-0">
                  <MultipleBadge m={r.multiple} size="lg" />
                  <p className="mt-1.5 line-clamp-3 text-[13px] font-semibold leading-snug">{r.tags?.hook ?? <span style={{ color: DASH.faint }}>no hook yet</span>}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: DASH.muted }}>
                    <ChannelChip account={m.username(r.igUserId)} />
                    {compact.format(r.latest?.views ?? 0)} views
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <TapsTimeline m={m} />

      {accountsPanel}
    </div>
  );
}

function ChannelCard({
  m,
  account,
  color,
  igUserId,
  followers,
}: {
  m: Model;
  account: string;
  color: string;
  igUserId: string;
  followers: { day: string; count: number }[];
}) {
  const own = m.reels.filter((r) => r.igUserId === igUserId);
  const now = baselineAt(own, igUserId, new Date(Date.now() + 48 * 3600 * 1000)); // all settled reels count today
  const days = lastDays(30);
  const baselineSeries = days.map((d) => ({ x: d, y: baselineAt(own, igUserId, new Date(`${d}T23:59:59Z`)) }));
  const monthAgo = baselineSeries[0].y;

  const fNow = followers[followers.length - 1]?.count ?? null;
  const fWeek = [...followers].reverse().find((f) => f.day <= isoDay(Date.now() - 7 * DAY_MS))?.count ?? followers[0]?.count ?? null;

  const taps = m.data.taps.filter((t) => t.channel === account);
  const tapSeries = days.map((d) => ({ x: d, y: taps.find((t) => t.day === d)?.taps ?? 0 }));
  const taps7 = tapSeries.slice(-7).reduce((s, p) => s + (p.y ?? 0), 0);

  const installs = m.data.installs.filter((i) => i.channel === account).sort((a, b) => a.week.localeCompare(b.week));
  const lastInstalls = installs[installs.length - 1];

  const best = own
    .filter((r) => r.settled && r.multiple != null && Date.now() - new Date(r.postedAt).getTime() < 14 * DAY_MS)
    .sort((a, b) => b.multiple! - a.multiple!)[0];

  return (
    <section className="flex flex-col gap-4 rounded-2xl p-5" style={{ background: DASH.card, border: `1px solid ${DASH.line}`, borderTop: `3px solid ${color}` }}>
      <div className="flex items-center justify-between gap-2">
        <ChannelChip account={account} full />
        <span className="text-xs" style={{ color: DASH.muted }}>
          {fNow != null ? `${fmt.format(fNow)} followers` : ''}
          {fNow != null && fWeek != null && fNow !== fWeek && (
            <span style={{ color: fNow > fWeek ? DASH.green : DASH.red }}> {fNow > fWeek ? '+' : '−'}{Math.abs(fNow - fWeek)} this week</span>
          )}
        </span>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: DASH.faint }}>Usual reel</p>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black tabular-nums">{now != null ? compact.format(now) : '–'}</span>
          <span className="text-sm" style={{ color: DASH.muted }}>views</span>
          {now != null && monthAgo != null && monthAgo > 0 && (
            <span className="text-xs font-semibold" style={{ color: now >= monthAgo ? DASH.green : DASH.red }}>
              {now >= monthAgo ? '▲' : '▼'} {Math.abs(Math.round(((now - monthAgo) / monthAgo) * 100))}% vs a month ago
            </span>
          )}
        </div>
        <div className="mt-2">
          <Sparkline points={baselineSeries} color={color} label={`@${account} usual reel views, last 30 days`} format={(v) => `${compact.format(v)} views`} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-3" style={{ background: DASH.inset }}>
          <p className="text-xs font-semibold" style={{ color: DASH.muted }}>Bio-link taps · 7 days</p>
          <p className="text-xl font-black tabular-nums">{fmt.format(taps7)}</p>
          <div className="mt-1">
            <Sparkline points={tapSeries} color={color} height={28} label={`@${account} bio-link taps per day`} format={(v) => `${v} taps`} />
          </div>
        </div>
        <InstallsBox m={m} account={account} last={lastInstalls} />
      </div>

      <div className="rounded-xl p-3" style={{ background: DASH.inset }}>
        <p className="mb-2 text-xs font-semibold" style={{ color: DASH.muted }}>Best reel · last 2 weeks</p>
        {best ? (
          <div className="flex items-center gap-3">
            <Cover src={best.thumbnailUrl} w={40} href={best.permalink} />
            <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-snug">{best.tags?.hook ?? <span style={{ color: DASH.faint }}>no hook yet</span>}</p>
            <MultipleBadge m={best.multiple} />
          </div>
        ) : (
          <p className="text-sm" style={{ color: DASH.faint }}>Nothing settled yet.</p>
        )}
      </div>
    </section>
  );
}

function InstallsBox({ m, account, last }: { m: Model; account: string; last?: { week: string; installs: number } }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState('');
  const [week, setWeek] = useState(mondayOf(Date.now() - 7 * DAY_MS));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-xl p-3" style={{ background: DASH.inset }}>
      <p className="text-xs font-semibold" style={{ color: DASH.muted }}>App Store installs</p>
      {!open ? (
        <>
          <p className="text-xl font-black tabular-nums">{last ? fmt.format(last.installs) : '–'}</p>
          <p className="text-[11px]" style={{ color: DASH.faint }}>{last ? `week of ${day(last.week)}` : 'from App Store Connect'}</p>
          <button onClick={() => setOpen(true)} className="mt-1 text-xs font-semibold" style={{ color: DASH.green }}>+ add a week</button>
        </>
      ) : (
        <form
          className="mt-1 grid gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!n || busy) return;
            setBusy(true);
            const error = await m.act('/api/marketing/installs', 'PUT', { channel: account, week, installs: Number(n) });
            setBusy(false);
            if (error) setErr(error);
            else {
              setOpen(false);
              setN('');
              setErr(null);
            }
          }}
        >
          <input type="date" value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week" className="w-full rounded-md px-2 py-1 text-xs" style={{ background: DASH.page, border: `1px solid ${DASH.line}`, color: DASH.ink, colorScheme: 'dark' }} />
          <input inputMode="numeric" autoFocus placeholder="installs" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} aria-label="Installs that week" className="w-full rounded-md px-2 py-1 text-sm" style={{ background: DASH.page, border: `1px solid ${DASH.line}`, color: DASH.ink }} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !n} className="rounded-md px-2 py-1 text-xs font-bold disabled:opacity-50" style={{ background: DASH.green, color: DASH.page }}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs" style={{ color: DASH.muted }}>Cancel</button>
          </div>
          {err && <p className="text-[11px]" style={{ color: DASH.red }}>{err}</p>}
          <p className="text-[10px] leading-snug" style={{ color: DASH.faint }}>App Analytics → Acquisition → Campaigns → ig-{Object.entries(GO_SLUGS).find(([, a]) => a === account)?.[0]}</p>
        </form>
      )}
    </div>
  );
}

/**
 * Bio-link taps per day, one row per channel (small multiples on a shared
 * day axis, never stacked), with a tick under every day that channel posted.
 * A tap spike next to a tick is the closest thing to per-reel conversion
 * Instagram allows; it's shown, never claimed.
 */
function TapsTimeline({ m }: { m: Model }) {
  const days = lastDays(30);
  const [hover, setHover] = useState<{ account: string; d: string } | null>(null);
  const rows = CHANNELS.map((c) => {
    const acct = m.data.accounts.find((a) => a.username === c.account);
    const counts = days.map((d) => m.data.taps.find((t) => t.channel === c.account && t.day === d)?.taps ?? 0);
    const posted = new Map<string, ScoredPost[]>();
    for (const r of m.reels) {
      if (r.igUserId !== acct?.igUserId) continue;
      const d = r.postedAt.slice(0, 10);
      if (!posted.has(d)) posted.set(d, []);
      posted.get(d)!.push(r);
    }
    return { c, counts, posted };
  });
  const max = Math.max(1, ...rows.flatMap((r) => r.counts));
  const total = rows.reduce((s, r) => s + r.counts.reduce((a, b) => a + b, 0), 0);
  const h = hover ? rows.find((r) => r.c.account === hover.account) : null;
  const hi = hover ? days.indexOf(hover.d) : -1;

  return (
    <Card>
      <CardTitle
        title="Bio-link taps, day by day"
        hint="Taps on getloro.app/go/… in each bio (link previews and bots left out). A tick under a day means that channel posted a reel; hover a day to see which."
      />
      {total === 0 ? (
        <Empty>No taps yet. Once the three bios link to getloro.app/go/radek-spanish, /go/radek-explains and /go/loro-app, every tap shows up here.</Empty>
      ) : null}
      <div className="grid gap-4" onMouseLeave={() => setHover(null)}>
        {rows.map(({ c, counts, posted }) => (
          <div key={c.account}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <ChannelChip account={c.account} />
              <span style={{ color: DASH.muted }}>{fmt.format(counts.reduce((a, b) => a + b, 0))} taps · 30 days</span>
            </div>
            <div className="flex h-16 items-end gap-[2px]">
              {counts.map((n, i) => (
                <button
                  key={days[i]}
                  type="button"
                  aria-label={`${day(days[i])}: ${n} taps${posted.has(days[i]) ? `, posted ${posted.get(days[i])!.length}` : ''}`}
                  onMouseEnter={() => setHover({ account: c.account, d: days[i] })}
                  onFocus={() => setHover({ account: c.account, d: days[i] })}
                  onClick={() => setHover({ account: c.account, d: days[i] })}
                  className="flex h-full flex-1 flex-col justify-end"
                >
                  <span
                    className="block w-full rounded-t-[3px]"
                    style={{
                      height: `${Math.max(n ? 6 : 2, (n / max) * 100)}%`,
                      background: n ? c.color : DASH.track,
                      opacity: hover && !(hover.account === c.account && hover.d === days[i]) ? 0.55 : 1,
                    }}
                  />
                </button>
              ))}
            </div>
            <div className="mt-1 flex gap-[2px]">
              {days.map((d) => (
                <span key={d} className="flex flex-1 justify-center">
                  {posted.has(d) && <span className="h-1.5 w-1.5 rounded-full" style={{ background: DASH.ink }} />}
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className="flex justify-between text-[11px]" style={{ color: DASH.faint }}>
          <span>{day(days[0])}</span>
          <span>today</span>
        </div>
      </div>
      {h && hi >= 0 && (
        <div className="mt-3 rounded-xl p-3 text-sm" style={{ background: DASH.inset }}>
          <div className="flex items-center gap-2">
            <ChannelChip account={h.c.account} />
            <span className="font-semibold">{day(days[hi])}</span>
            <span style={{ color: DASH.muted }}>{h.counts[hi]} taps</span>
          </div>
          {(h.posted.get(days[hi]) ?? []).map((r) => (
            <div key={r.mediaId} className="mt-2 flex items-center gap-2">
              <Cover src={r.thumbnailUrl} w={28} href={r.permalink} />
              <span className="line-clamp-1 flex-1 text-[13px]">{r.tags?.hook ?? 'no hook yet'}</span>
              <MultipleBadge m={r.multiple} climbing={!r.settled} />
            </div>
          ))}
          {!h.posted.has(days[hi]) && <p className="mt-1 text-xs" style={{ color: DASH.faint }}>No reel posted that day.</p>}
        </div>
      )}
    </Card>
  );
}
