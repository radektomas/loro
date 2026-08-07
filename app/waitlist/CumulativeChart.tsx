/**
 * Cumulative signups over time — a server-rendered inline SVG.
 *
 * No client component, no charting dependency, no JS of any kind: this page is
 * gated by a secret and reads a table the browser must never touch, so the less
 * that ships to it the better. Hover tooltips are native <title> elements on
 * invisible hit circles, which the browser renders without script.
 *
 * Single series, so no legend — the heading names it (dataviz rule: a legend
 * exists for >= 2 series, never for one). The line wears the brand accent; text
 * wears text tokens, never the series colour.
 */

type Day = {
  /** YYYY-MM-DD, UTC. */
  date: string;
  /** Signups on this day alone. */
  added: number;
  /** Running total through end of this day. */
  total: number;
};

/** Round up to a 1 / 2 / 2.5 / 5 x 10^k step so gridlines land on real numbers. */
function niceCeil(value: number): number {
  if (value <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * pow;
    if (value <= candidate) return candidate;
  }
  return 10 * pow;
}

/** "2026-08-07" -> "7 Aug". Built from the parts, so it cannot drift by timezone. */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

const W = 720;
const H = 220;
const PAD = { top: 16, right: 18, bottom: 30, left: 46 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export function CumulativeChart({ days }: { days: Day[] }) {
  if (days.length === 0) return null;

  const yMax = niceCeil(days[days.length - 1].total);
  const baseline = PAD.top + PLOT_H;

  // One point still gets a dot; a line needs two, so it sits mid-plot rather
  // than pinned to the left edge where it would read as an axis artefact.
  const x = (i: number) =>
    days.length === 1
      ? PAD.left + PLOT_W / 2
      : PAD.left + (i / (days.length - 1)) * PLOT_W;
  const y = (v: number) => PAD.top + PLOT_H - (v / yMax) * PLOT_H;

  const points = days.map((d, i) => ({ ...d, cx: x(i), cy: y(d.total) }));
  const line = points.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' L ');
  const area =
    points.length > 1
      ? `M ${points[0].cx.toFixed(1)},${baseline} L ${line} L ${points[points.length - 1].cx.toFixed(1)},${baseline} Z`
      : '';

  const last = points[points.length - 1];
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Cumulative signups from ${shortDate(days[0].date)} to ${shortDate(last.date)}, ending at ${last.total}.`}
    >
      {/* Recessive grid — present enough to read a value off, quiet enough to
          stay behind the data. */}
      {gridValues.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--muted)"
            strokeOpacity={v === 0 ? 0.28 : 0.12}
            strokeWidth={1}
          />
          <text
            x={PAD.left - 10}
            y={y(v) + 4}
            textAnchor="end"
            className="fill-muted"
            fontSize={11}
          >
            {Number.isInteger(v) ? v : v.toFixed(1)}
          </text>
        </g>
      ))}

      {area && <path d={area} fill="var(--accent-soft)" />}
      {points.length > 1 && (
        <path
          d={`M ${line}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Data-end marker: the only point that always earns a dot. */}
      <circle cx={last.cx} cy={last.cy} r={4.5} fill="var(--accent)" />
      <circle
        cx={last.cx}
        cy={last.cy}
        r={4.5}
        fill="none"
        stroke="var(--surface)"
        strokeWidth={2}
      />

      {/* Hit targets, larger than the marks, carrying native hover tooltips. */}
      {points.map((p) => (
        <circle key={p.date} cx={p.cx} cy={p.cy} r={11} fill="transparent">
          <title>{`${shortDate(p.date)} — ${p.total} total (+${p.added})`}</title>
        </circle>
      ))}

      {/* Selective labels only: first and last date, never one per point. */}
      <text x={PAD.left} y={H - 8} className="fill-muted" fontSize={11}>
        {shortDate(days[0].date)}
      </text>
      {days.length > 1 && (
        <text
          x={W - PAD.right}
          y={H - 8}
          textAnchor="end"
          className="fill-muted"
          fontSize={11}
        >
          {shortDate(last.date)}
        </text>
      )}
    </svg>
  );
}

export type { Day };
