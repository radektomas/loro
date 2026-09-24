'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { DailyPoint, DauPoint, RadekDashboard, SubscriberRow, WallWindow } from '@/lib/analytics';

/**
 * THE OWNER'S DASHBOARD, in the house style of RevenueCat and App Store
 * Connect (Radek, 2026-09-24: "visually attractive and very clear, I like
 * the RevenueCat dashboard and the App Store Connect dashboard"): a light
 * page, a row of metric cards — big number, change against the previous
 * period, a small trend line — then one large chart switched by metric,
 * then the funnel, the subscribers and retention.
 *
 * Its own palette on purpose (the rest of the site is dark): these tokens
 * live here and nowhere else. Charts are hand-drawn SVG, one hue per
 * metric, thin marks, a hover readout — the site has no chart library and
 * does not need one for bars and a line.
 *
 * NOTHING HERE IS A PROJECTION. Every number is a count of installs or
 * events from loro_analytics_events, App Store builds only.
 */

export const DASH = {
  page: '#f4f5f7',
  card: '#ffffff',
  line: '#e6e8ec',
  ink: '#0f172a',
  muted: '#667085',
  faint: '#98a2b3',
  green: '#12a150',
  greenSoft: '#e7f6ee',
  red: '#d92d20',
  redSoft: '#fdecea',
} as const;

type MetricKey = 'installs' | 'wall' | 'purchases' | 'videos';
const METRICS: { key: MetricKey; label: string; color: string; pick: (d: DailyPoint) => number; help: string }[] = [
  { key: 'installs', label: 'New installs', color: '#2563eb', pick: (d) => d.newInstalls, help: 'First launch of the App Store app.' },
  { key: 'wall', label: 'Paywall views', color: '#7c3aed', pick: (d) => d.paywallViews, help: 'Installs that saw the wall that day.' },
  { key: 'purchases', label: 'Trials & purchases', color: DASH.green, pick: (d) => d.purchases, help: 'Completed Apple sheets — a trial start counts.' },
  { key: 'videos', label: 'Videos watched', color: '#ea580c', pick: (d) => d.videosWatched, help: 'Clips played inside the app.' },
];

const fmt = new Intl.NumberFormat('en-GB');
const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const dayLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Daily rows with the missing days filled with zeros, oldest first. */
function fillDays(daily: DailyPoint[], days: number): DailyPoint[] {
  const byDay = new Map(daily.map((d) => [d.day.slice(0, 10), d]));
  const out: DailyPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = t.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, newInstalls: 0, paywallViews: 0, purchases: 0, videosWatched: 0 });
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------ chrome

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl p-5 ${className}`}
      style={{ background: DASH.card, border: `1px solid ${DASH.line}`, boxShadow: '0 1px 2px rgba(16,24,40,0.04)' }}
    >
      {children}
    </section>
  );
}

function CardTitle({ title, hint, aside }: { title: string; hint?: string; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-[15px] font-semibold" style={{ color: DASH.ink }}>{title}</h2>
        {hint && <p className="mt-0.5 max-w-prose text-xs leading-relaxed" style={{ color: DASH.muted }}>{hint}</p>}
      </div>
      {aside}
    </div>
  );
}

/** "+42%" in green or "−12%" in red, against the previous period. */
function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0 && now === 0) return <span style={{ color: DASH.faint }}>no change</span>;
  if (before === 0) return <span className="font-semibold" style={{ color: DASH.green }}>new</span>;
  const change = Math.round(((now - before) / before) * 100);
  const up = change >= 0;
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums"
      style={{ background: up ? DASH.greenSoft : DASH.redSoft, color: up ? DASH.green : DASH.red }}
    >
      {up ? '▲' : '▼'} {Math.abs(change)}%
    </span>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 120;
  const H = 32;
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v: number) => H - 2 - (H - 4) * (v / max);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-28" aria-hidden>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------- KPI cards

function KpiCard({
  label,
  value,
  now,
  before,
  spark,
  color,
  caption,
  active,
  onClick,
}: {
  label: string;
  value: string;
  now: number;
  before: number;
  spark?: number[];
  color: string;
  caption: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className="flex flex-col rounded-2xl p-4 text-left transition"
      style={{
        background: DASH.card,
        border: `1px solid ${active ? color : DASH.line}`,
        boxShadow: active ? `0 0 0 3px ${color}22` : '0 1px 2px rgba(16,24,40,0.04)',
      }}
    >
      <div className="flex items-center gap-2 text-xs font-medium" style={{ color: DASH.muted }}>
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="text-[28px] font-bold leading-none tabular-nums" style={{ color: DASH.ink }}>
            {value}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: DASH.muted }}>
            <Delta now={now} before={before} />
            <span>{caption}</span>
          </div>
        </div>
        {spark && <Sparkline values={spark} color={color} />}
      </div>
    </Tag>
  );
}

// ------------------------------------------------------------ main chart

function MainChart({ days, metric }: { days: DailyPoint[]; metric: (typeof METRICS)[number] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 260;
  const padL = 34;
  const padR = 12;
  const padT = 16;
  const padB = 26;
  const values = days.map(metric.pick);
  const rawMax = Math.max(1, ...values);
  const step = rawMax <= 5 ? 1 : rawMax <= 10 ? 2 : rawMax <= 25 ? 5 : rawMax <= 50 ? 10 : Math.ceil(rawMax / 50) * 10;
  const max = Math.ceil(rawMax / step) * step;
  const n = days.length;
  const slot = (W - padL - padR) / n;
  const barW = Math.max(4, Math.min(22, slot * 0.62));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img" aria-label={`${metric.label} per day`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={DASH.line} strokeDasharray={t === 0 ? undefined : '3 4'} />
            <text x={padL - 8} y={y(t) + 3} textAnchor="end" fontSize={11} fill={DASH.faint}>
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const v = values[i];
          const x = padL + i * slot;
          const on = hover === i;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={padT} width={slot} height={H - padT - padB} fill={on ? '#f2f4f7' : 'transparent'} />
              {v > 0 && (
                <rect
                  x={x + (slot - barW) / 2}
                  y={y(v)}
                  width={barW}
                  height={y(0) - y(v)}
                  rx={Math.min(4, barW / 2)}
                  fill={metric.color}
                  opacity={hover === null || on ? 1 : 0.55}
                />
              )}
              {(i % 7 === (n - 1) % 7) && (
                <text x={x + slot / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={DASH.faint}>
                  {dayLabel(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && days[hover] && (
        <div
          className="pointer-events-none absolute top-2 rounded-xl px-3 py-2 text-xs shadow-lg"
          style={{
            background: DASH.ink,
            color: '#fff',
            left: `${Math.min(80, Math.max(4, ((padL + (hover + 0.5) * slot) / W) * 100 - 8))}%`,
          }}
        >
          <div className="font-semibold">{dayLabel(days[hover].day)}</div>
          <div className="mt-0.5 tabular-nums">
            {metric.label}: <b>{fmt.format(values[hover])}</b>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ funnel

function Funnel({ w, compare }: { w: WallWindow; compare: WallWindow }) {
  const steps = [
    { label: 'Saw the paywall', n: w.sawWall, prev: compare.sawWall, rate: null as string | null },
    { label: 'Tapped the button', n: w.tapped, prev: compare.tapped, rate: pct(w.tapped, w.sawWall) },
    { label: 'Trial or purchase', n: w.completed, prev: compare.completed, rate: pct(w.completed, w.tapped) },
  ];
  const max = Math.max(1, w.sawWall);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.label} className="relative rounded-xl p-4" style={{ background: '#f8f9fb', border: `1px solid ${DASH.line}` }}>
            <div className="text-xs font-medium" style={{ color: DASH.muted }}>
              {i + 1}. {s.label}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums" style={{ color: DASH.ink }}>{fmt.format(s.n)}</span>
              {s.rate && <span className="text-sm font-semibold" style={{ color: DASH.muted }}>{s.rate} of step {i}</span>}
            </div>
            <div className="mt-3 h-2 rounded-full" style={{ background: DASH.line }}>
              <div className="h-2 rounded-full" style={{ width: `${(100 * s.n) / max}%`, background: DASH.green }} />
            </div>
            <div className="mt-2 text-xs" style={{ color: DASH.faint }}>
              previous 14 days: {fmt.format(s.prev)}
            </div>
          </div>
        ))}
      </div>
      <div
        className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm"
        style={{ background: DASH.redSoft, color: DASH.red }}
      >
        <span>
          <b>{fmt.format(w.cancelled)}</b> of {fmt.format(w.tapped)} who tapped backed out on Apple’s sheet
        </span>
        <span className="font-bold">{pct(w.cancelled, w.tapped)} leak</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- subscribers

function Subscribers({ rows: all }: { rows: SubscriberRow[] }) {
  const [tab, setTab] = useState<'all' | 'trials' | 'paid'>('all');
  const rows = all.filter((r) => (tab === 'all' ? true : tab === 'trials' ? Boolean(r.trial) : !r.trial));
  const tabs = [
    { key: 'all' as const, label: `All ${all.length}` },
    { key: 'trials' as const, label: `Trials ${all.filter((r) => r.trial).length}` },
    { key: 'paid' as const, label: `Paid straight away ${all.filter((r) => !r.trial).length}` },
  ];
  const tabBar = (
    <div className="mb-3 flex w-fit gap-1 rounded-lg p-0.5" style={{ background: '#f2f4f7' }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className="rounded-md px-3 py-1 text-xs font-semibold"
          style={tab === t.key ? { background: DASH.card, color: DASH.ink, boxShadow: '0 1px 2px rgba(16,24,40,0.08)' } : { color: DASH.muted }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
  if (all.length === 0) return <p className="text-sm" style={{ color: DASH.muted }}>Nobody has bought or started a trial yet.</p>;
  const head = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide';
  return (
    <div>
    {tabBar}
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead style={{ color: DASH.faint, background: '#f8f9fb' }}>
          <tr>
            <th className={`${head} pl-5`}>Started</th>
            <th className={head}>Plan</th>
            <th className={head}>Status</th>
            <th className={`${head} text-right`}>Days active</th>
            <th className={`${head} text-right`}>Videos</th>
            <th className={`${head} text-right`}>Words saved</th>
            <th className={`${head} text-right`}>Reviews</th>
            <th className={`${head} pr-5 text-right`}>Answers</th>
          </tr>
        </thead>
        <tbody className="tabular-nums" style={{ color: DASH.ink }}>
          {rows.map((r) => {
            const ageDays = (Date.now() - new Date(r.boughtAt).getTime()) / 864e5;
            const engaged = r.daysActiveAfter >= 2 || r.savedAfter >= 5;
            const status =
              r.trial && ageDays < 7
                ? { text: `Trial · day ${Math.floor(ageDays) + 1} of 7`, bg: '#eef4ff', fg: '#2563eb' }
                : r.trial
                  ? { text: 'Trial ended · check RevenueCat', bg: '#f2f4f7', fg: DASH.muted }
                  : engaged
                  ? { text: 'Using it', bg: DASH.greenSoft, fg: DASH.green }
                  : { text: 'Went quiet', bg: DASH.redSoft, fg: DASH.red };
            return (
              <tr key={r.installId} style={{ borderTop: `1px solid ${DASH.line}` }}>
                <td className="px-3 py-2.5 pl-5">{dayLabel(r.boughtAt)}</td>
                <td className="px-3 py-2.5">
                  <span className="capitalize">{r.packageType.toLowerCase()}</span>
                  <span style={{ color: DASH.faint }}>{r.trial ? ' · trial' : ''}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: status.bg, color: status.fg }}>
                    {status.text}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">{r.daysActiveAfter}</td>
                <td className="px-3 py-2.5 text-right">{r.videosAfter}</td>
                <td className="px-3 py-2.5 text-right">{r.savedAfter}</td>
                <td className="px-3 py-2.5 text-right">{r.reviewsAfter}</td>
                <td className="px-3 py-2.5 pr-5 text-right">{r.answersAfter}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
  );
}

// ------------------------------------------------------------------- DAU

function DauChart({ points }: { points: DauPoint[] }) {
  const W = 900;
  const H = 140;
  const padT = 18;
  const padB = 22;
  const max = Math.max(1, ...points.map((p) => p.dau));
  const n = points.length;
  const x = (i: number) => (n > 1 ? 8 + (i / (n - 1)) * (W - 16) : W / 2);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.dau).toFixed(1)}`).join(' ');
  const last = points[n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label="Active installs per day">
      <line x1={8} x2={W - 8} y1={y(0)} y2={y(0)} stroke={DASH.line} />
      <path d={`${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="#2563eb" opacity={0.08} />
      <path d={line} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" />
      {last && (
        <g>
          <circle cx={x(n - 1)} cy={y(last.dau)} r={4.5} fill="#2563eb" stroke="#fff" strokeWidth={2} />
          <text x={x(n - 1) - 8} y={y(last.dau) - 9} textAnchor="end" fontSize={12} fontWeight={600} fill={DASH.ink}>
            {last.dau} today
          </text>
        </g>
      )}
      <text x={8} y={H - 5} fontSize={11} fill={DASH.faint}>{points[0] ? dayLabel(points[0].day) : ''}</text>
      <text x={W - 8} y={H - 5} textAnchor="end" fontSize={11} fill={DASH.faint}>{last ? dayLabel(last.day) : ''}</text>
    </svg>
  );
}

// ------------------------------------------------------------------- page

export function RadekDashboardView({ data }: { data: RadekDashboard }) {
  const [metricKey, setMetricKey] = useState<MetricKey>('installs');
  const [range, setRange] = useState<30 | 60>(30);
  const all = useMemo(() => fillDays(data.daily, 60), [data.daily]);
  const shown = all.slice(-range);
  const last14 = all.slice(-14);
  const prev14 = all.slice(-28, -14);
  const metric = METRICS.find((m) => m.key === metricKey)!;
  const [w7, w14, wPrev] = data.windows;
  const r = data.retention;
  const subs = data.subscribers ?? [];
  const inWindow = (iso: string, fromDays: number, toDays: number) => {
    const age = (Date.now() - new Date(iso).getTime()) / 864e5;
    return age >= toDays && age < fromDays;
  };
  const trials14 = subs.filter((x) => x.trial && inWindow(x.boughtAt, 14, 0)).length;
  const trialsPrev = subs.filter((x) => x.trial && inWindow(x.boughtAt, 28, 14)).length;
  const paid14 = subs.filter((x) => !x.trial && inWindow(x.boughtAt, 14, 0)).length;
  const paidPrev = subs.filter((x) => !x.trial && inWindow(x.boughtAt, 28, 14)).length;
  const activeTrials = subs.filter((s) => s.trial && Date.now() - new Date(s.boughtAt).getTime() < 7 * 864e5).length;

  return (
    <div className="space-y-5">
      {/* THE ROW OF CARDS — last 14 days against the 14 before. Tap one to chart it. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((m) => {
          const now = sum(last14.map(m.pick));
          const before = sum(prev14.map(m.pick));
          return (
            <KpiCard
              key={m.key}
              label={m.label}
              value={fmt.format(now)}
              now={now}
              before={before}
              spark={last14.map(m.pick)}
              color={m.color}
              caption="vs prior 14 days"
              active={metricKey === m.key}
              onClick={() => setMetricKey(m.key)}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Wall → trial or purchase"
          value={pct(w14.completed, w14.sawWall)}
          now={w14.sawWall ? w14.completed / w14.sawWall : 0}
          before={wPrev.sawWall ? wPrev.completed / wPrev.sawWall : 0}
          color={DASH.green}
          caption="last 14 days"
        />
        <KpiCard
          label="Backed out on Apple’s sheet"
          value={pct(w14.cancelled, w14.tapped)}
          now={w14.tapped ? w14.cancelled / w14.tapped : 0}
          before={wPrev.tapped ? wPrev.cancelled / wPrev.tapped : 0}
          color={DASH.red}
          caption="of taps, lower is better"
        />
        <KpiCard
          label="Trials started"
          value={fmt.format(trials14)}
          now={trials14}
          before={trialsPrev}
          color="#2563eb"
          caption={`last 14 days · ${activeTrials} running now`}
        />
        <KpiCard
          label="Paid straight away"
          value={fmt.format(paid14)}
          now={paid14}
          before={paidPrev}
          color={DASH.green}
          caption="last 14 days, no trial"
        />
      </div>

      {/* THE BIG CHART */}
      <Card>
        <CardTitle
          title={metric.label}
          hint={metric.help}
          aside={
            <div className="flex gap-1 rounded-lg p-0.5" style={{ background: '#f2f4f7' }}>
              {([30, 60] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setRange(d)}
                  className="rounded-md px-3 py-1 text-xs font-semibold"
                  style={range === d ? { background: DASH.card, color: DASH.ink, boxShadow: '0 1px 2px rgba(16,24,40,0.08)' } : { color: DASH.muted }}
                >
                  {d} days
                </button>
              ))}
            </div>
          }
        />
        <div className="mb-2 flex flex-wrap gap-2">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetricKey(m.key)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={
                metricKey === m.key
                  ? { background: `${m.color}14`, color: m.color, border: `1px solid ${m.color}55` }
                  : { color: DASH.muted, border: `1px solid ${DASH.line}` }
              }
            >
              <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
              {m.label}
            </button>
          ))}
        </div>
        <MainChart days={shown} metric={metric} />
      </Card>

      {/* THE WALL */}
      <Card>
        <CardTitle
          title="Paywall funnel"
          hint={`Last 14 days, ${dayLabel(w14.from)} – ${dayLabel(w14.to)}. Distinct installs at each step. Last 7 days: ${w7.sawWall} saw it, ${w7.completed} started.`}
        />
        <Funnel w={w14} compare={wPrev} />
      </Card>

      {/* SUBSCRIBERS */}
      <Card>
        <CardTitle
          title="Subscribers and trials"
          hint="Everyone who completed Apple’s sheet, newest first, and what they did afterwards. “Went quiet” means one day or less of use and under five words saved."
          aside={
            data.subscribers ? (
              <span className="text-xs font-medium" style={{ color: DASH.muted }}>
                {subs.length} total · {activeTrials} in trial now
              </span>
            ) : null
          }
        />
        {data.subscribers ? (
          <Subscribers rows={subs} />
        ) : (
          <p className="text-sm" style={{ color: DASH.muted }}>
            Paste <code>supabase/migrations/20260924000000_analytics_wall_subscribers.sql</code> into the Supabase SQL editor to see this.
          </p>
        )}
      </Card>

      {/* RETENTION */}
      <Card>
        <CardTitle
          title="Coming back"
          hint="Of everyone who installed long enough ago, how many opened the app again on a later day. Most never got past the wall, so this measures interest more than the product."
        />
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Day 1', n: r.d1Returned, of: r.d1Cohort },
            { label: 'Day 3', n: r.d3Returned, of: r.d3Cohort },
            { label: 'Day 7', n: r.d7Returned, of: r.d7Cohort },
          ].map((c) => (
            <div key={c.label} className="rounded-xl p-4" style={{ background: '#f8f9fb', border: `1px solid ${DASH.line}` }}>
              <div className="text-xs font-medium" style={{ color: DASH.muted }}>{c.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: DASH.ink }}>{pct(c.n, c.of)}</div>
              <div className="text-xs" style={{ color: DASH.faint }}>{c.n} of {c.of} installs</div>
            </div>
          ))}
        </div>
        <div className="mt-5 text-xs font-medium" style={{ color: DASH.muted }}>Active installs per day, last 30 days</div>
        <DauChart points={data.dau} />
      </Card>

      <p className="pb-4 text-center text-xs" style={{ color: DASH.faint }}>
        Updated {new Date(data.loadedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · App Store builds only
      </p>
    </div>
  );
}
