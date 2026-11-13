'use client';

import { useState, type ReactNode } from 'react';
import { DASH } from '../RadekDashboard';
import type { Account } from '@/lib/cutReels';
import type { Verdict } from '@/lib/scaleStats';

/**
 * Shared pieces of the scaler dashboard (/marketing).
 *
 * Channel colours are a categorical palette checked with the dataviz skill's
 * validator on the dark card surface (#141a17, --pairs all): blue / amber /
 * magenta pass lightness, chroma, CVD (worst ΔE 13.2) and the normal-vision
 * floor (19.3). Green and red are NOT channel colours: they mean
 * winning / losing.
 */
export const CHANNELS: { account: Account; short: string; color: string; soft: string }[] = [
  { account: 'radek.spanish', short: 'radek.spanish', color: '#3987e5', soft: 'rgba(57,135,229,0.16)' },
  { account: 'radek.explains.spanish', short: 'radek.explains', color: '#c98500', soft: 'rgba(201,133,0,0.16)' },
  { account: 'loro.app', short: 'loro.app', color: '#d55181', soft: 'rgba(213,81,129,0.16)' },
];
export const channelOf = (account: string | undefined) => CHANNELS.find((c) => c.account === account);

export const VERDICT: Record<Verdict, { label: string; color: string; soft: string }> = {
  winning: { label: 'Winning', color: DASH.green, soft: DASH.greenSoft },
  promising: { label: 'Promising', color: DASH.violet, soft: 'rgba(167,139,250,0.15)' },
  ordinary: { label: 'Ordinary', color: DASH.muted, soft: DASH.track },
  fading: { label: 'Fading', color: DASH.orange, soft: 'rgba(251,146,60,0.14)' },
  losing: { label: 'Losing', color: DASH.red, soft: DASH.redSoft },
};

export const fmt = new Intl.NumberFormat('en-GB');
export const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
export const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const DAY_MS = 86400 * 1000;

export function ChannelChip({ account, full = false }: { account: string; full?: boolean }) {
  const c = channelOf(account);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: c?.soft ?? DASH.track, color: DASH.ink }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: c?.color ?? DASH.faint }} />
      {full ? `@${account}` : c?.short ?? account}
    </span>
  );
}

/** A reel's views against its channel's usual reel. The number carries the meaning; colour only backs it. */
export function MultipleBadge({ m, size = 'md', climbing = false }: { m: number | null; size?: 'md' | 'lg'; climbing?: boolean }) {
  const big = size === 'lg';
  if (climbing) {
    return (
      <span className={`inline-flex items-center rounded-lg px-2 py-1 font-semibold ${big ? 'text-xs' : 'text-[11px]'}`} style={{ background: DASH.track, color: DASH.muted }} title="Under 48 hours old: Instagram's numbers are still climbing">
        still climbing
      </span>
    );
  }
  if (m == null) {
    return <span className={`font-mono ${big ? 'text-lg' : 'text-sm'}`} style={{ color: DASH.faint }} title="No usual reel to compare with yet">–</span>;
  }
  const tone = m >= 3 ? { bg: DASH.green, fg: DASH.page } : m >= 1.5 ? { bg: DASH.greenSoft, fg: DASH.green } : m >= 0.8 ? { bg: DASH.track, fg: DASH.ink } : { bg: DASH.redSoft, fg: DASH.red };
  return (
    <span
      className={`inline-flex items-baseline rounded-lg font-mono font-bold tabular-nums ${big ? 'px-2.5 py-1 text-lg' : 'px-2 py-0.5 text-sm'}`}
      style={{ background: tone.bg, color: tone.fg }}
      title="Views against this channel's usual reel when it was posted (1× = ordinary)"
    >
      {m >= 10 ? m.toFixed(0) : m.toFixed(1)}×
    </span>
  );
}

export function VerdictTag({ v }: { v: Verdict }) {
  const s = VERDICT[v];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ background: s.soft, color: s.color }}>
      {v === 'winning' ? '▲' : v === 'losing' ? '▼' : v === 'promising' ? '◆' : v === 'fading' ? '↘' : '•'} {s.label}
    </span>
  );
}

/** A reel cover at 9:16. Instagram's cover links expire; the daily sync refreshes them. */
export function Cover({ src, w = 48, href, alt = '' }: { src: string | null; w?: number; href?: string | null; alt?: string }) {
  const [broken, setBroken] = useState(false);
  const box = (
    <span className="block shrink-0 overflow-hidden rounded-lg" style={{ width: w, height: Math.round((w * 16) / 9), background: DASH.track }}>
      {src && !broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      )}
    </span>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="shrink-0" title="Open on Instagram">
      {box}
    </a>
  ) : (
    box
  );
}

export function Pill({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors"
      style={{
        background: on ? DASH.ink : DASH.card,
        color: on ? DASH.page : DASH.ink,
        border: `1px solid ${on ? DASH.ink : DASH.line}`,
      }}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

export function PillRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="mr-1 text-xs font-semibold uppercase tracking-wide" style={{ color: DASH.faint }}>{label}</span>}
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl p-8 text-center text-sm leading-relaxed" style={{ background: DASH.inset, border: `1px dashed ${DASH.line}`, color: DASH.muted }}>
      {children}
    </p>
  );
}

/**
 * A small single-series line with a hover readout (crosshair + value), for
 * trends inside a card. One series, so no legend: the card title names it.
 */
export function Sparkline({
  points,
  color,
  height = 44,
  format = (v: number) => fmt.format(Math.round(v)),
  label,
}: {
  points: { x: string; y: number | null }[];
  color: string;
  height?: number;
  format?: (v: number) => string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 240;
  const H = height;
  const ys = points.map((p) => p.y).filter((y): y is number => y != null);
  if (ys.length < 2) return <div style={{ height: H }} className="flex items-center text-xs" ><span style={{ color: DASH.faint }}>Not enough days yet</span></div>;
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = 4;
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => (hi === lo ? H / 2 : H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad));
  let d = '';
  points.forEach((p, i) => {
    if (p.y == null) return;
    d += `${d && points[i - 1]?.y != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)} `;
  });
  const h = hover != null ? points[hover] : null;
  const last = [...points].reverse().find((p) => p.y != null)!;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${points.length} days, latest ${format(last.y!)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        onTouchStart={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.touches[0].clientX - r.left) / r.width) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }}
      >
        <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {h && h.y != null && (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1={0} y2={H} stroke={DASH.faint} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {h && h.y != null && (
        <div
          className="pointer-events-none absolute -top-7 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: 'translateX(-50%)', background: DASH.ink, color: DASH.page }}
        >
          {day(h.x)} · {format(h.y)}
        </div>
      )}
    </div>
  );
}
