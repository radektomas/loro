'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { DauPoint, UserRow } from '@/lib/analytics';

/**
 * The dashboard's marks.
 *
 * The retention rebuild retired the multi-series charts, and their validated
 * categorical palette went with them — what remains draws in the app's own
 * accent against the chart surface (#151b17), which the original OKLCH pass
 * already cleared at ≥ 3:1. If a second series ever lands on the sparkline,
 * its colour goes back through the data-viz validator first; "it looks fine"
 * is not a check — the failure mode is invisible to anyone with normal
 * vision.
 */

const ACCENT = '#9eefa3';

const fmt = new Intl.NumberFormat('en-GB');
const dateFmt = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });

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

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-8 text-center text-xs leading-relaxed text-muted">
      {children}
    </p>
  );
}

// --------------------------------------------------------------- DAU tile

/**
 * Today's DAU with the last seven days behind it. A sparkline, not an axed
 * chart, on purpose: seven points support "up or down since Tuesday" and
 * nothing finer, and axes would promise a precision the mark cannot keep.
 * The exact daily values are one hover away in the title attribute.
 */
export function DauTile({ points, today }: { points: DauPoint[]; today: number }) {
  const W = 120;
  const H = 32;
  const max = Math.max(1, ...points.map((p) => p.dau));
  const x = (i: number) =>
    points.length <= 1 ? W / 2 : (i / (points.length - 1)) * W;
  const y = (v: number) => H - 3 - (v / max) * (H - 6);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.dau).toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1];

  return (
    <div className="rounded-2xl bg-surface px-4 py-4">
      <p className="text-xs font-medium text-muted">Active today</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="text-2xl font-bold tabular-nums text-text">
          {fmt.format(today)}
        </p>
        {points.length > 0 && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-8 w-[120px] shrink-0"
            role="img"
            aria-label="Daily active installs, last 7 days"
          >
            <title>
              {points.map((p) => `${dateFmt(p.day)}: ${p.dau}`).join(' · ')}
            </title>
            <path d={d} fill="none" stroke={ACCENT} strokeWidth={2} />
            {last && (
              <circle cx={x(points.length - 1)} cy={y(last.dau)} r={2.5} fill={ACCENT} />
            )}
          </svg>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted">last 7 days</p>
    </div>
  );
}

// ------------------------------------------------------------ users table

type SortKey =
  | 'installId'
  | 'firstSeen'
  | 'videosTotal'
  | 'videos7d'
  | 'lastActive'
  | 'd1'
  | 'd3'
  | 'd7'
  | 'subStatus';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'installId', label: 'User', numeric: false },
  { key: 'firstSeen', label: 'First seen', numeric: true },
  { key: 'videosTotal', label: 'Videos', numeric: true },
  { key: 'videos7d', label: 'Videos 7d', numeric: true },
  { key: 'lastActive', label: 'Last active', numeric: true },
  { key: 'd1', label: 'D1', numeric: true },
  { key: 'd3', label: 'D3', numeric: true },
  { key: 'd7', label: 'D7', numeric: true },
  { key: 'subStatus', label: 'Sub', numeric: false },
];

/**
 * Every column carries one comparable number (or string), extracted once so
 * the comparator has no per-type branches. Retention flags order as
 * ✓ > ✗ > pending: a verdict, either verdict, is more information than none,
 * and sorting "still open" between true and false would interleave the three
 * into an unreadable stripe.
 */
function sortValue(row: UserRow, key: SortKey): number | string {
  switch (key) {
    case 'installId':
      return row.installId;
    case 'subStatus':
      // Rank, not alphabet: subscribed > restored > none.
      return row.subStatus === 'subscribed' ? 2 : row.subStatus === 'restored' ? 1 : 0;
    case 'firstSeen':
      return Date.parse(row.firstSeen) || 0;
    case 'lastActive':
      return Date.parse(row.lastActive) || 0;
    case 'd1':
    case 'd3':
    case 'd7': {
      const flag = row[key];
      return flag === true ? 2 : flag === false ? 1 : 0;
    }
    default:
      return row[key];
  }
}

function Flag({ value }: { value: boolean | null }) {
  if (value === null) {
    // The day hasn't fully elapsed — an open question, not a churn.
    return <span className="text-muted/50">—</span>;
  }
  return value ? (
    <span className="font-semibold text-accent">✓</span>
  ) : (
    <span className="text-muted">✗</span>
  );
}

export function UsersTable({ users }: { users: UserRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: 'lastActive',
    desc: true,
  });

  const toggle = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, desc: !prev.desc }
        : // A fresh column starts at its useful end: big numbers and recent
          // dates first, names A→Z.
          { key, desc: COLUMNS.find((c) => c.key === key)?.numeric ?? false }
    );

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    return [...users].sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (typeof va === 'string' || typeof vb === 'string') {
        return dir * String(va).localeCompare(String(vb));
      }
      return dir * (va - vb);
    });
  }, [users, sort]);

  if (users.length === 0) {
    return (
      <Empty>
        No installs recorded yet. If the app has been used since analytics
        shipped, check that the migration is applied — and remember events only
        exist from 26 Aug 2026 onward.
      </Empty>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead>
          <tr className="text-muted">
            {COLUMNS.map((col) => (
              <th key={col.key} className="pb-2 font-medium">
                <button
                  type="button"
                  onClick={() => toggle(col.key)}
                  className={`transition-colors hover:text-text ${
                    sort.key === col.key ? 'text-text' : ''
                  }`}
                >
                  {col.label}
                  {sort.key === col.key && (
                    <span className="ml-1">{sort.desc ? '↓' : '↑'}</span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="align-top">
          {sorted.map((row) => (
            <tr key={row.installId} className="border-t border-white/5">
              <td className="py-2 pr-3 whitespace-nowrap text-muted">
                {/* Truncated because it is a client-minted pseudonym, not an
                    identity to copy around; 8 hex chars is plenty to eyeball
                    two rows apart. */}
                {row.installId.slice(0, 8)}
                {row.signedIn && (
                  <span className="ml-1.5 text-accent">· signed in</span>
                )}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">
                {dateFmt(row.firstSeen)}
              </td>
              <td className="py-2 pr-3 tabular-nums text-text">
                {fmt.format(row.videosTotal)}
              </td>
              <td className="py-2 pr-3 tabular-nums text-text">
                {fmt.format(row.videos7d)}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">
                {dateFmt(row.lastActive)}
              </td>
              <td className="py-2 pr-3"><Flag value={row.d1} /></td>
              <td className="py-2 pr-3"><Flag value={row.d3} /></td>
              <td className="py-2 pr-3"><Flag value={row.d7} /></td>
              <td className="py-2 whitespace-nowrap">
                {row.subStatus === 'none' ? (
                  <span className="text-muted/50">—</span>
                ) : (
                  <span
                    className={
                      row.subStatus === 'subscribed'
                        ? 'rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent'
                        : 'rounded-full bg-level-soft px-2 py-0.5 font-semibold text-level'
                    }
                  >
                    {row.subStatus}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
