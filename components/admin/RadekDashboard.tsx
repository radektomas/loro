'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AbRow, DailyPoint, DauPoint, FeedbackRow, RadekDashboard, SubscriberRow, WallWindow } from '@/lib/analytics';

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
  // Dark since 2026-10-09 (Radek: "make the dashboard dark theme"):
  // neutrals leaning toward the app's green, colours lifted for a dark ground.
  page: '#0b0f0d',
  card: '#141a17',
  inset: '#101512',
  track: '#1f2622',
  line: '#26302b',
  ink: '#eef2ef',
  muted: '#9aa59f',
  faint: '#6b766f',
  green: '#34d399',
  greenSoft: 'rgba(52,211,153,0.14)',
  red: '#f87171',
  redSoft: 'rgba(248,113,113,0.14)',
  blue: '#60a5fa',
  blueSoft: 'rgba(96,165,250,0.15)',
  violet: '#a78bfa',
  orange: '#fb923c',
  shadow: 'rgba(0,0,0,0.35)',
} as const;

type MetricKey = 'installs' | 'wall' | 'purchases' | 'videos';
const METRICS: { key: MetricKey; label: string; color: string; pick: (d: DailyPoint) => number; help: string }[] = [
  { key: 'installs', label: 'New installs', color: DASH.blue, pick: (d) => d.newInstalls, help: 'First launch of the App Store app.' },
  { key: 'wall', label: 'Paywall views', color: DASH.violet, pick: (d) => d.paywallViews, help: 'Installs that saw the wall that day.' },
  { key: 'purchases', label: 'Trials & purchases', color: DASH.green, pick: (d) => d.purchases, help: 'Completed Apple sheets — a trial start counts.' },
  { key: 'videos', label: 'Videos watched', color: DASH.orange, pick: (d) => d.videosWatched, help: 'Clips played inside the app.' },
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
      style={{ background: DASH.card, border: `1px solid ${DASH.line}`, boxShadow: `0 1px 2px ${DASH.shadow}` }}
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
        boxShadow: active ? `0 0 0 3px ${color}22` : `0 1px 2px ${DASH.shadow}`,
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
              <rect x={x} y={padT} width={slot} height={H - padT - padB} fill={on ? DASH.track : 'transparent'} />
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
            color: DASH.page,
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
          <div key={s.label} className="relative rounded-xl p-4" style={{ background: DASH.inset, border: `1px solid ${DASH.line}` }}>
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
    <div className="mb-3 flex w-fit gap-1 rounded-lg p-0.5" style={{ background: DASH.track }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className="rounded-md px-3 py-1 text-xs font-semibold"
          style={tab === t.key ? { background: DASH.card, color: DASH.ink, boxShadow: `0 1px 2px ${DASH.shadow}` } : { color: DASH.muted }}
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
        <thead style={{ color: DASH.faint, background: DASH.inset }}>
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
                ? { text: `Trial · day ${Math.floor(ageDays) + 1} of 7`, bg: DASH.blueSoft, fg: DASH.blue }
                : r.trial
                  ? { text: 'Trial ended · check RevenueCat', bg: DASH.track, fg: DASH.muted }
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

// ---------------------------------------------------------------- feedback

const REASON_LABEL: Record<string, string> = {
  price: 'Too expensive',
  no_subscription: 'Doesn’t want a subscription',
  not_sure: 'Not sure it works for them yet',
  try_more: 'Wants to try more first',
  other: 'Something else',
  skipped: 'Skipped the question',
};
const REASON_ORDER = ['price', 'no_subscription', 'not_sure', 'try_more', 'other', 'skipped'];

/**
 * "WHAT'S HOLDING YOU BACK?" — asked once, right after someone closed
 * Apple's purchase sheet (Radek, 2026-10-09). The tally first, then every
 * typed answer word for word; skips are counted but kept out of the bars'
 * share so they do not drown the real reasons.
 */
function Feedback({ rows }: { rows: FeedbackRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: DASH.muted }}>
        No answers yet. People are asked after they close Apple’s sheet, from version 1.9.1 on.
      </p>
    );
  }
  const answered = rows.filter((r) => r.reason !== 'skipped');
  const count = (k: string) => rows.filter((r) => r.reason === k).length;
  const max = Math.max(1, ...REASON_ORDER.filter((k) => k !== 'skipped').map(count));
  const notes = rows.filter((r) => r.note);
  return (
    <div>
      <div className="space-y-2.5">
        {REASON_ORDER.filter((k) => k !== 'skipped').map((k) => {
          const n = count(k);
          return (
            <div key={k} className="flex items-center gap-3 text-sm">
              <div className="w-56 shrink-0" style={{ color: DASH.ink }}>{REASON_LABEL[k]}</div>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: DASH.track }}>
                <div className="h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: DASH.violet }} />
              </div>
              <div className="w-20 shrink-0 text-right tabular-nums" style={{ color: DASH.muted }}>
                <b style={{ color: DASH.ink }}>{n}</b> · {pct(n, answered.length)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs" style={{ color: DASH.faint }}>
        {answered.length} answered · {count('skipped')} skipped the question
      </p>
      {notes.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: DASH.faint }}>In their words</div>
          <ul className="space-y-2">
            {notes.map((r, i) => (
              <li key={i} className="rounded-xl px-4 py-3 text-sm" style={{ background: DASH.inset, border: `1px solid ${DASH.line}` }}>
                <span style={{ color: DASH.ink }}>“{r.note}”</span>
                <span className="ml-2 text-xs" style={{ color: DASH.faint }}>
                  {dayLabel(r.answeredAt)}
                  {r.packageId ? ` · looking at ${r.packageId.replace('$rc_', '')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- A/B

/**
 * TWO TESTS, ONE PANEL. 1.9.2 split Madrid-free vs the hard wall; 1.9.3 runs
 * the wall SHAPE instead — the one-page hard wall vs the three-page one (demo
 * → value → price), everyone on the hard wall (Radek, 2026-10-12). Each test
 * has its own arms, its own steps and its own "born on" version.
 */
type AbTestKey = 'style' | 'madrid';
type Arm = { key: string; label: string; short: string; color: string };
const TESTS: Record<
  AbTestKey,
  { title: string; arms: Arm[]; armOf: (r: AbRow) => string | null; since: string }
> = {
  style: {
    title: '3-page vs 1-page wall (1.9.3+)',
    arms: [
      { key: 'single', label: '1-page hard wall', short: '1-page', color: DASH.blue },
      { key: 'multi', label: '3-page wall (demo → value → price)', short: '3-page', color: DASH.green },
    ],
    armOf: (r) => r.style,
    since: '1.9.3',
  },
  madrid: {
    title: 'Madrid free vs hard wall (1.9.2)',
    arms: [
      { key: 'hard', label: 'Hard wall after onboarding', short: 'Hard', color: DASH.blue },
      { key: 'madrid', label: 'Madrid free first', short: 'Madrid', color: DASH.green },
    ],
    armOf: (r) => r.variant,
    since: '1.9.2',
  },
};

/** "1.9.10" >= "1.9.2", which a string compare gets wrong. */
function versionAtLeast(v: string | null, min: string): boolean {
  if (!v) return false;
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Fewer installs than this in either arm and the page says so, loudly. */
const AB_MIN_PER_ARM = 30;

/**
 * THE PAYWALL A/B TEST (Radek, 2026-10-12: "I want to see how many people
 * saw each wall, and what exactly they did"). Every 1.9.2+ install is put in
 * one arm by the remote dial (scripts/set-paywall-flag.mts): the hard wall
 * straight after onboarding, or Madrid free first. The comparison first —
 * each step as a share of that arm's installs — then every install's story.
 */
function AbTest({ rows: every }: { rows: AbRow[] }) {
  const [test, setTest] = useState<AbTestKey>('style');
  const [newOnly, setNewOnly] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const T = TESTS[test];
  const ARMS = T.arms;
  const all = every.filter((r) => T.armOf(r) !== null);
  const rows = newOnly ? all.filter((r) => versionAtLeast(r.installVersion, T.since)) : all;
  const arm = (k: string) => rows.filter((r) => T.armOf(r) === k);
  const steps: { label: string; help?: string; pick: (r: AbRow) => boolean; of?: 'installs' | 'wall' }[] =
    test === 'style'
      ? [
          { label: 'Finished onboarding', pick: (r) => r.onboarded && !r.skippedOnboarding },
          { label: 'Saw the wall', pick: (r) => r.wallViews > 0 },
          { label: 'Saw the demo (3-page only)', pick: (r) => r.demoSeen, of: 'wall' },
          { label: 'Reached the price page (3-page only)', pick: (r) => r.reachedPrice, of: 'wall' },
          { label: 'Tapped buy', pick: (r) => r.tappedBuy > 0, of: 'wall' },
          { label: 'Closed Apple’s sheet', pick: (r) => r.cancelled > 0, of: 'wall' },
          { label: 'Started a trial / bought', pick: (r) => r.trial },
          { label: 'Finished the walkthrough', pick: (r) => r.tourDone && !r.tourSkippedAt, of: 'installs' },
          { label: 'Answered a blank', pick: (r) => r.blanks > 0 },
          { label: 'Came back on a 2nd day', pick: (r) => r.activeDays >= 2 },
        ]
      : [
          { label: 'Finished onboarding', pick: (r) => r.onboarded && !r.skippedOnboarding },
          { label: 'Answered a blank', pick: (r) => r.blanks > 0 },
          { label: 'Reached Madrid (5 words)', pick: (r) => r.reachedMadrid },
          { label: 'Saw the wall', pick: (r) => r.wallViews > 0 },
          { label: 'Tapped buy', pick: (r) => r.tappedBuy > 0, of: 'wall' },
          { label: 'Closed Apple’s sheet', pick: (r) => r.cancelled > 0, of: 'wall' },
          { label: 'Started a trial / bought', pick: (r) => r.trial },
          { label: 'Came back on a 2nd day', pick: (r) => r.activeDays >= 2 },
        ];
  const tiny = ARMS.some((a) => arm(a.key).length < AB_MIN_PER_ARM);
  const trialRate = (k: string) => {
    const a = arm(k);
    return a.length ? a.filter((r) => r.trial).length / a.length : 0;
  };
  const list = showAll ? rows : rows.slice(0, 40);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs" style={{ color: DASH.muted }}>
        {(Object.keys(TESTS) as AbTestKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setTest(k)}
            className="rounded-full px-3 py-1 font-semibold"
            style={{
              background: test === k ? DASH.greenSoft : DASH.track,
              color: test === k ? DASH.green : DASH.ink,
            }}
          >
            {TESTS[k].title}
          </button>
        ))}
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
          Only installs born on {T.since}+ (older installs also get an arm when they update)
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: DASH.muted }}>
          No installs in this test yet. It starts with the first install of {T.since} from the App Store.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr style={{ color: DASH.muted }}>
                  <th className="pb-2 text-left font-medium">Step</th>
                  {ARMS.map((a) => (
                    <th key={a.key} className="pb-2 text-right font-medium">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: a.color }} />
                      {a.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderTop: `1px solid ${DASH.line}` }}>
                  <td className="py-2" style={{ color: DASH.ink }}>Installs in the arm</td>
                  {ARMS.map((a) => (
                    <td key={a.key} className="py-2 text-right text-base font-bold tabular-nums" style={{ color: DASH.ink }}>
                      {fmt.format(arm(a.key).length)}
                    </td>
                  ))}
                </tr>
                {steps.map((st) => (
                  <tr key={st.label} style={{ borderTop: `1px solid ${DASH.line}` }}>
                    <td className="py-2" style={{ color: DASH.ink }}>
                      {st.label}
                      {st.of === 'wall' && <span className="ml-1 text-xs" style={{ color: DASH.faint }}>(of those who saw it)</span>}
                    </td>
                    {ARMS.map((a) => {
                      const r = arm(a.key);
                      const base = st.of === 'wall' ? r.filter((x) => x.wallViews > 0) : r;
                      const n = base.filter(st.pick).length;
                      return (
                        <td key={a.key} className="py-2 text-right tabular-nums" style={{ color: DASH.muted }}>
                          <b style={{ color: DASH.ink }}>{n}</b> · {pct(n, base.length)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr style={{ borderTop: `1px solid ${DASH.line}` }}>
                  <td className="py-2" style={{ color: DASH.ink }}>Minutes from install to the wall (median)</td>
                  {ARMS.map((a) => {
                    const mins = arm(a.key)
                      .filter((r) => r.firstWallAt && r.installedAt)
                      .map((r) => (Date.parse(r.firstWallAt!) - Date.parse(r.installedAt!)) / 60000);
                    const m = median(mins);
                    return (
                      <td key={a.key} className="py-2 text-right tabular-nums" style={{ color: DASH.ink }}>
                        {m == null ? '—' : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs leading-relaxed" style={{ color: tiny ? DASH.orange : DASH.muted }}>
            {tiny
              ? `Too early to call: wait for at least ${AB_MIN_PER_ARM} installs in each arm.`
              : `Trial per install: ${ARMS.map((a) => `${a.short} ${Math.round(trialRate(a.key) * 100)}%`).join(' vs ')}. A trial is not money yet — check who converts after day 7 in RevenueCat.`}
          </p>

          <div className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: DASH.faint }}>
            What each person did · newest first
          </div>
          <ul className="space-y-1.5">
            {list.map((r) => {
              const a = ARMS.find((x) => x.key === T.armOf(r));
              const chips: { t: string; good?: boolean; bad?: boolean }[] = [];
              chips.push(r.skippedOnboarding ? { t: 'skipped onboarding', bad: true } : r.onboarded ? { t: 'onboarding ✓' } : { t: 'left in onboarding', bad: true });
              if (r.blanks) chips.push({ t: `${r.blanksRight}/${r.blanks} blanks right` });
              if (r.wordsSaved) chips.push({ t: `${r.wordsSaved} saved` });
              if (r.reachedMadrid) chips.push({ t: 'Madrid ✓', good: true });
              if (r.wallViews) chips.push({ t: `saw wall ×${r.wallViews}` });
              if (r.demoSeen) chips.push({ t: r.demoMs != null ? `demo ${Math.round(r.demoMs / 1000)}s` : 'demo' });
              if (r.reachedPrice) chips.push({ t: 'price page' });
              if (r.tappedBuy) chips.push({ t: `tapped buy ×${r.tappedBuy}` });
              if (r.cancelled) chips.push({ t: `closed sheet ×${r.cancelled}`, bad: true });
              if (r.feedback) chips.push({ t: `“${r.feedbackNote ?? REASON_LABEL[r.feedback] ?? r.feedback}”` });
              if (r.trial) chips.push({ t: 'TRIAL', good: true });
              if (r.restored) chips.push({ t: 'restored' });
              if (r.tourSkippedAt) chips.push({ t: `skipped tour at ${r.tourSkippedAt}`, bad: true });
              else if (r.tourDone) chips.push({ t: 'tour ✓', good: true });
              if (r.activeDays >= 2) chips.push({ t: `${r.activeDays} days`, good: true });
              return (
                <li key={r.installId} className="flex flex-wrap items-center gap-1.5 rounded-xl px-3 py-2 text-xs" style={{ background: DASH.inset, border: `1px solid ${DASH.line}` }}>
                  <span className="w-28 shrink-0 tabular-nums" style={{ color: DASH.faint }}>
                    {new Date(r.installedAt ?? r.assignedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: `${a?.color ?? DASH.muted}22`, color: a?.color ?? DASH.muted }}>
                    {a?.short ?? T.armOf(r)}
                  </span>
                  {chips.map((c, i) => (
                    <span
                      key={i}
                      className="rounded-full px-2 py-0.5"
                      style={{
                        background: c.good ? DASH.greenSoft : c.bad ? DASH.redSoft : DASH.track,
                        color: c.good ? DASH.green : c.bad ? DASH.red : DASH.ink,
                      }}
                    >
                      {c.t}
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
          {rows.length > 40 && (
            <button className="mt-3 text-xs font-semibold" style={{ color: DASH.blue }} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show the newest 40' : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
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
      <path d={`${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={DASH.blue} opacity={0.08} />
      <path d={line} fill="none" stroke={DASH.blue} strokeWidth={2} strokeLinejoin="round" />
      {last && (
        <g>
          <circle cx={x(n - 1)} cy={y(last.dau)} r={4.5} fill={DASH.blue} stroke={DASH.card} strokeWidth={2} />
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
          color={DASH.blue}
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
            <div className="flex gap-1 rounded-lg p-0.5" style={{ background: DASH.track }}>
              {([30, 60] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setRange(d)}
                  className="rounded-md px-3 py-1 text-xs font-semibold"
                  style={range === d ? { background: DASH.card, color: DASH.ink, boxShadow: `0 1px 2px ${DASH.shadow}` } : { color: DASH.muted }}
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

      {/* PAYWALL A/B TEST */}
      <Card>
        <CardTitle
          title="Paywall A/B test"
          hint="From 1.9.2 each new install gets one wall: the hard wall right after onboarding, or Madrid free first (5 words), then the wall. The split is the remote dial. Every step is a share of that wall’s installs."
          aside={
            data.ab ? (
              <span className="text-xs font-medium" style={{ color: DASH.muted }}>
                {data.ab.length} installs in the test
              </span>
            ) : null
          }
        />
        {data.ab ? (
          <AbTest rows={data.ab} />
        ) : (
          <p className="text-sm" style={{ color: DASH.muted }}>
            Paste <code>supabase/migrations/20261012000000_analytics_paywall_ab.sql</code> into the Supabase SQL editor to see this.
          </p>
        )}
      </Card>

      {/* PAYWALL FEEDBACK */}
      <Card>
        <CardTitle
          title="What’s holding people back"
          hint="Asked once, right after someone tapped the button and closed Apple’s purchase sheet. One tap, or their own words."
          aside={
            data.feedback ? (
              <span className="text-xs font-medium" style={{ color: DASH.muted }}>
                {data.feedback.length} responses
              </span>
            ) : null
          }
        />
        {data.feedback ? (
          <Feedback rows={data.feedback} />
        ) : (
          <p className="text-sm" style={{ color: DASH.muted }}>
            Paste <code>supabase/migrations/20261009000000_analytics_paywall_feedback.sql</code> into the Supabase SQL editor to see this.
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
            <div key={c.label} className="rounded-xl p-4" style={{ background: DASH.inset, border: `1px solid ${DASH.line}` }}>
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
