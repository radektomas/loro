'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  DailyPoint,
  FunnelStage,
  OnboardingStep,
  PaywallOutcome,
  WatchBucket,
} from '@/lib/analytics';

/**
 * The dashboard's marks.
 *
 * COLOR IS NOT EYEBALLED HERE. Every palette below was generated in OKLCH and
 * run through the data-viz validator against THIS app's chart surface
 * (#151b17), not a generic dark grey:
 *
 *   ORDINAL (funnel, watch buckets) — one hue, evenly spaced in L, monotone,
 *     adjacent ΔL ≥ 0.06, dark end ≥ 2:1 against the surface. Used because
 *     both scales are ORDERED (funnel depth, videos-watched bands). A ramp on
 *     unordered categories would be a bug — it double-encodes bar length as
 *     hue — which is why the paywall outcomes below do NOT get one.
 *   CATEGORICAL (paywall outcomes, daily lines) — the four validated dark
 *     steps: worst adjacent CVD ΔE 8.4, worst normal-vision ΔE 19.8, all ≥ 3:1
 *     on the surface.
 *
 * Changing any hex here means re-running that validator. "It looks fine" is
 * not a check — the failure mode is invisible to anyone with normal vision.
 */

/** Funnel depth, brightest at the bottom. The direction is deliberate: the
    last stage is the one the business cares about, so it is the loudest mark
    on the chart rather than the dimmest. */
const RAMP_FUNNEL = [
  '#146a25',
  '#2e7f3a',
  '#45944e',
  '#5baa63',
  '#71c178',
  '#87d78d',
  '#9eefa3',
];

/** Videos watched, more = brighter. Same hue, five steps. */
const RAMP_BUCKETS = ['#146a25', '#3a8a44', '#5baa63', '#7ccc82', '#9eefa3'];

/** Categorical slots 1–4, dark steps. Order is fixed and assigned by ENTITY,
    never by rank — a filter that changes the numbers must not repaint them. */
const CAT = {
  blue: '#3987e5',
  orange: '#d95926',
  aqua: '#199e70',
  yellow: '#c98500',
} as const;

/** The chart surface, matching --surface. Gaps and rings are drawn IN it —
    that is the separator, never a stroke around a mark. */
const SURFACE = '#151b17';

const fmt = new Intl.NumberFormat('en-GB');
const pct = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';

// ------------------------------------------------------------------ chrome

export function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-surface p-5">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {hint && <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * A headline number. A stat tile rather than a one-bar chart — a single value
 * has no magnitude to compare against, so a bar would be decoration.
 */
export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-text">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Shared hover card. Absolutely positioned by the caller's relative wrapper. */
function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl bg-surface-raised px-3 py-2 text-xs whitespace-nowrap text-text shadow-lg ring-1 ring-white/10"
      style={{ left: x, top: y - 8 }}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ funnel

/**
 * The funnel. Horizontal bars because the stage names are long sentences, and
 * a horizontal bar gives them a full line each instead of a rotated tick.
 *
 * TWO PERCENTAGES, AND THEY ANSWER DIFFERENT QUESTIONS. "of installs" is the
 * absolute conversion; "of previous" is where the loss actually happens. A
 * funnel showing only the first hides which step is broken, and one showing
 * only the second hides that the whole thing is small.
 */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(
    null
  );
  /**
   * The tooltip is positioned inside THIS element, so the pointer has to be
   * measured against it too. Measuring against the hovered row instead (the
   * obvious thing to write) puts every tooltip at the top of the list, because
   * the row's own origin is not the origin the `absolute` child resolves
   * against.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  const top = stages[0]?.installs ?? 0;

  return (
    <div ref={boxRef} className="relative">
      <ul className="space-y-3">
        {stages.map((stage, i) => {
          const prev = i === 0 ? null : stages[i - 1].installs;
          const width = top > 0 ? (stage.installs / top) * 100 : 0;
          return (
            <li
              key={stage.stage}
              onMouseMove={(e) => {
                const box = boxRef.current?.getBoundingClientRect();
                if (!box) return;
                setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-text">{stage.stage}</span>
                {/* Direct label at the tip, every row: seven rows is few
                    enough that labelling all of them is reading, not clutter,
                    and this chart has no value axis to fall back on. */}
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  <span className="font-semibold text-text">
                    {fmt.format(stage.installs)}
                  </span>{' '}
                  · {pct(stage.installs, top)} of installs
                  {prev !== null && ` · ${pct(stage.installs, prev)} of previous`}
                </span>
              </div>
              {/* The track is the surface one step up, not a tinted version of
                  the series hue — a tinted track reads as data. */}
              <div className="mt-1.5 h-3 w-full overflow-hidden rounded-l-none bg-white/[0.04]">
                <div
                  className="h-full rounded-r"
                  style={{
                    width: `${Math.max(width, stage.installs > 0 ? 0.8 : 0)}%`,
                    background: RAMP_FUNNEL[Math.min(i, RAMP_FUNNEL.length - 1)],
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {hover && stages[hover.i] && (
        <Tip x={hover.x} y={hover.y}>
          <span className="font-semibold">{stages[hover.i].stage}</span>
          {' — '}
          {fmt.format(stages[hover.i].installs)} installs
        </Tip>
      )}
    </div>
  );
}

// -------------------------------------------------------------- onboarding

/**
 * Onboarding drop-off, in EMPHASIS form: one screen in the accent, the rest in
 * de-emphasis grey.
 *
 * Not an ordinal ramp, even though the screens are ordered. Thirteen steps of
 * one hue are indistinguishable from each other, and the question this panel
 * answers is not "what order are the screens in" — it is "WHICH ONE loses the
 * most people". That is a single-point story, and emphasis is its form.
 */
export function DropOffChart({ steps }: { steps: OnboardingStep[] }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(
    null
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const worst = useMemo(() => {
    let index = -1;
    let most = 0;
    steps.forEach((step, i) => {
      if (step.stoppedHere > most) {
        most = step.stoppedHere;
        index = i;
      }
    });
    return index;
  }, [steps]);
  const top = steps[0]?.reached ?? 0;

  if (steps.length === 0) {
    return <Empty>No onboarding runs recorded in this window.</Empty>;
  }

  return (
    <div ref={boxRef} className="relative">
      <ul className="space-y-2">
        {steps.map((step, i) => {
          const width = top > 0 ? (step.reached / top) * 100 : 0;
          const isWorst = i === worst && step.stoppedHere > 0;
          return (
            <li
              key={step.step}
              className="grid grid-cols-[9rem_1fr_auto] items-center gap-3"
              onMouseMove={(e) => {
                const box = boxRef.current?.getBoundingClientRect();
                if (!box) return;
                setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <span className="truncate text-xs text-muted" title={step.step}>
                {step.step}
              </span>
              <div className="h-2.5 w-full bg-white/[0.04]">
                <div
                  className="h-full rounded-r"
                  style={{
                    width: `${Math.max(width, step.reached > 0 ? 0.8 : 0)}%`,
                    // Emphasis: the loss leader in the accent, everyone else
                    // recessive. Colour follows the STORY, and the story is
                    // recomputed from the data, not from row order.
                    background: isWorst ? CAT.orange : '#3f4a43',
                  }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted">
                {fmt.format(step.reached)}
                {step.stoppedHere > 0 && (
                  <span className={isWorst ? 'text-text' : ''}>
                    {' '}
                    · −{fmt.format(step.stoppedHere)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {worst >= 0 && steps[worst] && (
        <p className="mt-4 text-xs leading-relaxed text-muted">
          <span
            className="mr-1.5 inline-block size-2 rounded-full align-middle"
            style={{ background: CAT.orange }}
          />
          Most abandonments happen on{' '}
          <span className="font-semibold text-text">{steps[worst].step}</span> —{' '}
          {fmt.format(steps[worst].stoppedHere)} install
          {steps[worst].stoppedHere === 1 ? '' : 's'} got no further.
        </p>
      )}
      {hover && steps[hover.i] && (
        <Tip x={hover.x} y={hover.y}>
          <span className="font-semibold">{steps[hover.i].step}</span>
          {' — '}
          {fmt.format(steps[hover.i].reached)} reached ·{' '}
          {fmt.format(steps[hover.i].stoppedHere)} stopped here
        </Tip>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- paywall

const OUTCOME_STYLE: Record<
  string,
  { label: string; color: string; note: string }
> = {
  subscribed: {
    label: 'Subscribed',
    color: CAT.aqua,
    note: 'Bought on this install.',
  },
  restored: {
    label: 'Restored',
    color: CAT.blue,
    note: 'Already subscribed — a reinstall or a second device, not a new sale.',
  },
  tried_and_failed: {
    label: 'Tapped subscribe, did not finish',
    color: CAT.yellow,
    note: 'Opened the Apple sheet and backed out, or the purchase errored.',
  },
  left: {
    label: 'Left without trying',
    color: CAT.orange,
    note: 'Saw the price and never tapped subscribe.',
  },
};

/**
 * Part-to-whole of everyone who reached the wall: one stacked bar.
 *
 * Categorical, NOT a ramp — the four outcomes have no natural order (is
 * "restored" more or less than "left"?), and a ramp would falsely imply one.
 * Four series is the point at which direct labels stop being optional, so
 * every segment gets a labelled legend row carrying its own number; the bar
 * itself carries no inline text, because interior segments have no free end
 * and clipping a label is worse than omitting it.
 */
export function PaywallChart({ outcomes }: { outcomes: PaywallOutcome[] }) {
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const total = outcomes.reduce((sum, o) => sum + o.installs, 0);

  if (total === 0) {
    return <Empty>Nobody has reached the paywall in this window.</Empty>;
  }

  return (
    <div>
      <div className="relative">
        {/* 2px surface gaps between segments — the separator is negative
            space in the surface colour, never a stroke on the mark. */}
        <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded">
          {outcomes
            .filter((o) => o.installs > 0)
            .map((o, i) => {
              const style = OUTCOME_STYLE[o.outcome];
              return (
                <div
                  key={o.outcome}
                  className="h-full first:rounded-l last:rounded-r"
                  style={{
                    width: `${(o.installs / total) * 100}%`,
                    background: style?.color ?? '#3f4a43',
                  }}
                  onMouseMove={(e) => {
                    // The segment's parent is the flex track, which is itself
                    // inside the `relative` wrapper at the same origin — so
                    // this one is already measured against the right box.
                    const track = e.currentTarget.parentElement;
                    if (!track) return;
                    const box = track.getBoundingClientRect();
                    setHover({ i, x: e.clientX - box.left });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
        </div>
        {hover !== null &&
          (() => {
            const shown = outcomes.filter((o) => o.installs > 0);
            const o = shown[hover.i];
            const style = o ? OUTCOME_STYLE[o.outcome] : null;
            return o && style ? (
              <Tip x={hover.x} y={0}>
                <span className="font-semibold">{style.label}</span> —{' '}
                {fmt.format(o.installs)} · {pct(o.installs, total)}
              </Tip>
            ) : null;
          })()}
      </div>

      {/* The legend IS the direct-label layer here. Always present at four
          series, and it carries the numbers so identity never rests on colour
          alone. */}
      <ul className="mt-5 space-y-2.5">
        {outcomes.map((o) => {
          const style = OUTCOME_STYLE[o.outcome];
          return (
            <li key={o.outcome} className="flex items-start gap-2.5">
              <span
                className="mt-1 size-2.5 shrink-0 rounded-full"
                style={{ background: style?.color ?? '#3f4a43' }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-text">
                  {style?.label ?? o.outcome}{' '}
                  <span className="tabular-nums text-muted">
                    — {fmt.format(o.installs)} · {pct(o.installs, total)}
                  </span>
                </p>
                {style && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    {style.note}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------- buckets

/** Videos watched per subscriber. Ordinal ramp: the bands ARE ordered. */
export function WatchChart({ buckets }: { buckets: WatchBucket[] }) {
  const total = buckets.reduce((sum, b) => sum + b.installs, 0);
  if (total === 0) {
    return <Empty>No subscribers in this window yet.</Empty>;
  }
  const max = Math.max(...buckets.map((b) => b.installs));
  const LABELS: Record<string, string> = {
    none: 'None',
    '1-4': '1–4 videos',
    '5-19': '5–19 videos',
    '20-49': '20–49 videos',
    '50+': '50+ videos',
  };
  return (
    <ul className="space-y-2.5">
      {buckets.map((b, i) => (
        <li key={b.bucket} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3">
          <span className="text-xs text-muted">{LABELS[b.bucket] ?? b.bucket}</span>
          <div className="h-2.5 w-full bg-white/[0.04]">
            <div
              className="h-full rounded-r"
              style={{
                width: `${max > 0 ? Math.max((b.installs / max) * 100, b.installs > 0 ? 1 : 0) : 0}%`,
                background: RAMP_BUCKETS[Math.min(i, RAMP_BUCKETS.length - 1)],
              }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted">
            <span className="font-semibold text-text">{fmt.format(b.installs)}</span>{' '}
            · {pct(b.installs, total)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------- daily

const DAILY_SERIES = [
  { key: 'newInstalls' as const, label: 'New installs', color: CAT.blue },
  { key: 'paywallViews' as const, label: 'Paywall views', color: CAT.orange },
  { key: 'purchases' as const, label: 'Purchases', color: CAT.aqua },
] satisfies { key: keyof DailyPoint; label: string; color: string }[];

const W = 900;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

/** Clean axis maxima — 1/2/5 × 10ⁿ. A raw max produces ticks like "7" and
    "3.5", which read as precision that is not there. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Daily activity, three series on ONE axis.
 *
 * All three are counts of installs-or-events per day, so they share a scale
 * honestly. If a fourth measure of a different order of magnitude is ever
 * wanted here (revenue, say), it gets its OWN chart — a second y-axis invents
 * a correlation that is not in the data, and is the single most common way a
 * dashboard lies.
 */
export function DailyChart({ points }: { points: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const max = niceMax(
    Math.max(
      1,
      ...points.flatMap((p) => DAILY_SERIES.map((s) => p[s.key] as number))
    )
  );
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = useCallback(
    (i: number) => PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW),
    [points.length, plotW]
  );
  const y = useCallback(
    (v: number) => PAD.top + plotH - (v / max) * plotH,
    [max, plotH]
  );

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || points.length === 0) return;
      const box = svg.getBoundingClientRect();
      // Client px → viewBox units, so the nearest-point maths stays correct
      // however the SVG has been scaled by its container.
      const vx = ((e.clientX - box.left) / box.width) * W;
      const ratio = (vx - PAD.left) / plotW;
      const i = Math.round(ratio * (points.length - 1));
      setHover(Math.min(Math.max(i, 0), points.length - 1));
    },
    [points.length, plotW]
  );

  if (points.length === 0) return <Empty>No activity in this window.</Empty>;

  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

  return (
    <div>
      {/* Legend first and always — three series must never rest on colour
          alone, and the endpoint labels below only supplement it. */}
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {DAILY_SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-full"
              style={{ background: s.color }}
            />
            <span className="text-xs text-muted">{s.label}</span>
          </li>
        ))}
      </ul>

      <div className="relative overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[560px]"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label="Daily new installs, paywall views and purchases"
        >
          {/* Gridlines: hairline, solid, one step off the surface. Recessive
              by construction — never dashed, never at data weight. */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="#2a332d"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-muted"
                style={{ fontSize: 11 }}
              >
                {fmt.format(t)}
              </text>
            </g>
          ))}

          {DAILY_SERIES.map((s) => {
            const d = points
              .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p[s.key] as number)}`)
              .join(' ');
            const last = points.length - 1;
            return (
              <g key={s.key}>
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {/* End marker: r=4 with a 2px surface ring, so it stays
                    legible where two series cross. */}
                <circle
                  cx={x(last)}
                  cy={y(points[last][s.key] as number)}
                  r={4}
                  fill={s.color}
                  stroke={SURFACE}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {hover !== null && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="#4a564e"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {DAILY_SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(points[hover][s.key] as number)}
                  r={4}
                  fill={s.color}
                  stroke={SURFACE}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )}

          {/* Date ticks: first, middle and last only. Every day would collide
              on any window longer than a fortnight. */}
          {[0, Math.floor((points.length - 1) / 2), points.length - 1]
            .filter((i, idx, arr) => arr.indexOf(i) === idx && i >= 0)
            .map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 8}
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                className="fill-muted"
                style={{ fontSize: 11 }}
              >
                {points[i].day.slice(5)}
              </text>
            ))}
        </svg>

        {hover !== null && (
          <div className="pointer-events-none absolute left-0 top-0 w-full">
            <div
              className="absolute -translate-x-1/2 rounded-xl bg-surface-raised px-3 py-2 text-xs whitespace-nowrap text-text shadow-lg ring-1 ring-white/10"
              style={{ left: `${(x(hover) / W) * 100}%`, top: 4 }}
            >
              <p className="font-semibold">{points[hover].day}</p>
              {DAILY_SERIES.map((s) => (
                <p key={s.key} className="mt-0.5 flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="text-muted">{s.label}</span>
                  <span className="ml-auto tabular-nums">
                    {fmt.format(points[hover][s.key] as number)}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ shared

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-xs text-muted">{children}</p>;
}
