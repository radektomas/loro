'use client';

import { useMemo, useState } from 'react';
import { DASH } from '../RadekDashboard';
import { FORMATS, rankBy, type Dimension, type RankRow } from '@/lib/scaleStats';
import type { Model } from './ScaleDashboard';
import { CHANNELS, ChannelChip, Cover, Empty, Pill, PillRow, VERDICT, VerdictTag, compact } from './ui';

const DIMS: { id: Dimension; label: string; hint: string }[] = [
  { id: 'hook', label: 'Hooks', hint: 'Near-identical wordings count as one hook ("1000 words in ONE MONTH" and "2000 words in one month").' },
  { id: 'hookKind', label: 'Hook style', hint: 'A viewer’s question in quotes, or a statement.' },
  { id: 'line1Variant', label: 'Line 1', hint: 'What the first line says about how you learn (/cut reels).' },
  { id: 'voice', label: 'Voice', hint: '“I / me” or speaking to the viewer as “you” (/cut reels).' },
  { id: 'demoKind', label: 'Demo', hint: 'What the demo shows. Tag old reels on the Reels tab to fill this in.' },
  { id: 'format', label: 'Format', hint: 'The kind of reel.' },
  { id: 'account', label: 'Channel', hint: 'Each channel against its own usual reel: a channel that’s growing scores above 1×.' },
];

const PRETTY: Partial<Record<Dimension, Record<string, string>>> = {
  hookKind: { question: 'Question hook ("…?")', statement: 'Statement hook' },
  line1Variant: { reels: '“…scrolling Spanish reels”', peppa: '“…watching Spanish Peppa Pig”' },
  voice: { i: 'I / me', you: 'You' },
  demoKind: { reels: 'Reels demo', peppa: 'Peppa Pig demo', other: 'Other demo', unknown: 'Not tagged yet' },
  format: { cut: '/cut reel (hook + demo + 3 lines)', phrases: 'Phrases ("Things to say when…")', 'outline-game': 'Outline game', other: 'Other / not tagged' },
};

// shared log scale for the bars: 0.25× … 8×, 1× marked
const LO = -2;
const HI = 3;
const pos = (m: number) => Math.max(0, Math.min(100, ((Math.log2(Math.max(m, 0.01)) - LO) / (HI - LO)) * 100));
const ONE = pos(1);

export function Winners({ m }: { m: Model }) {
  const [dim, setDim] = useState<Dimension>('hook');
  const [channel, setChannel] = useState('all');
  const [format, setFormat] = useState('all');
  const [proven, setProven] = useState(false);

  const rows = useMemo(() => {
    const posts = m.reels.filter(
      (r) => (channel === 'all' || m.username(r.igUserId) === channel) && (format === 'all' || (r.tags?.format ?? 'other') === format)
    );
    const all = rankBy(posts, dim);
    return proven ? all.filter((r) => r.n >= 3) : all;
  }, [m, dim, channel, format, proven]);

  const label = (r: RankRow) => (dim === 'account' ? null : PRETTY[dim]?.[r.key] ?? r.label);
  const d = DIMS.find((x) => x.id === dim)!;
  const counts = { winning: 0, promising: 0, ordinary: 0, losing: 0 };
  for (const r of rows) counts[r.verdict]++;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-2xl p-4" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
        <PillRow>
          {DIMS.map((x) => (
            <Pill key={x.id} on={dim === x.id} onClick={() => setDim(x.id)}>{x.label}</Pill>
          ))}
        </PillRow>
        <div className="flex flex-wrap gap-2">
          <PillRow>
            <Pill on={channel === 'all'} onClick={() => setChannel('all')}>All channels</Pill>
            {CHANNELS.map((c) => (
              <Pill key={c.account} on={channel === c.account} onClick={() => setChannel(c.account)} color={c.color}>{c.short}</Pill>
            ))}
          </PillRow>
          <Pill on={proven} onClick={() => setProven(!proven)}>3+ reels only</Pill>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            aria-label="Format"
            className="rounded-lg px-2.5 py-1.5 text-sm font-semibold"
            style={{ background: DASH.page, border: `1px solid ${DASH.line}`, color: DASH.ink, colorScheme: 'dark' }}
          >
            <option value="all">All formats</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>{PRETTY.format![f]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-2xl p-4 text-sm leading-relaxed" style={{ background: DASH.inset, border: `1px solid ${DASH.line}`, color: DASH.muted }}>
        <span style={{ color: DASH.ink }} className="font-semibold">How to read this: </span>
        1× = that channel&apos;s usual reel when it went up. <b style={{ color: VERDICT.winning.color }}>Winning</b> = 3+ reels at 1.5× or better.{' '}
        <b style={{ color: VERDICT.promising.color }}>Promising</b> = it did well but on fewer than 3 reels, so test it again before trusting it.{' '}
        <b style={{ color: VERDICT.losing.color }}>Losing</b> = 3+ reels under 0.8×. {d.hint}
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {(['winning', 'promising', 'ordinary', 'losing'] as const).map((v) => (
            <span key={v}>
              <b style={{ color: VERDICT[v].color }}>{counts[v]}</b> {VERDICT[v].label.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty>Nothing to rank here yet: these reels have no {d.label.toLowerCase()} tagged, or none have settled (48 hours).</Empty>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.key} className="grid gap-3 rounded-2xl p-3.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <VerdictTag v={r.verdict} />
                  <span className="text-xs" style={{ color: DASH.muted }}>
                    {r.n} reel{r.n === 1 ? '' : 's'} · {compact.format(r.totalViews)} views
                    {r.variants != null && r.variants > 1 && ` · ${r.variants} wordings`}
                  </span>
                </div>
                {dim === 'account' ? <ChannelChip account={m.username(r.key)} full /> : <p className="text-[15px] font-semibold leading-snug">{label(r)}</p>}
              </div>
              <Bar r={r} />
              <div className="flex gap-1.5">
                {r.examples.map((id) => {
                  const p = m.byId.get(id);
                  return p ? <Cover key={id} src={p.thumbnailUrl} w={30} href={p.permalink} alt={p.tags?.hook ?? ''} /> : null;
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Median multiple as a bar from the 1× line, min–max as a whisker, on a shared log scale. */
function Bar({ r }: { r: RankRow }) {
  const med = r.medianMultiple ?? 1;
  const x = pos(med);
  const color = VERDICT[r.verdict].color === DASH.muted ? DASH.faint : VERDICT[r.verdict].color;
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-mono text-base font-bold tabular-nums" style={{ color: DASH.ink }}>{med.toFixed(1)}×</span>
        <span style={{ color: DASH.faint }}>
          {r.min != null && r.max != null && r.n > 1 ? `${r.min.toFixed(1)}–${r.max.toFixed(1)}×` : 'one reel'}
        </span>
      </div>
      <div className="relative h-3 rounded-full" style={{ background: DASH.track }} role="img" aria-label={`median ${med.toFixed(1)} times the usual reel`}>
        {r.min != null && r.max != null && r.n > 1 && (
          <span className="absolute top-1/2 h-px -translate-y-1/2" style={{ left: `${pos(r.min)}%`, width: `${Math.max(0.5, pos(r.max) - pos(r.min))}%`, background: DASH.muted }} />
        )}
        <span
          className="absolute top-0 h-3 rounded-full"
          style={{ left: `${Math.min(x, ONE)}%`, width: `${Math.max(1.5, Math.abs(x - ONE))}%`, background: color }}
        />
        <span className="absolute -top-1 h-5 w-[2px]" style={{ left: `${ONE}%`, background: DASH.ink }} title="1× = the usual reel" />
      </div>
      <div className="relative mt-0.5 h-3 text-[10px]" style={{ color: DASH.faint }}>
        <span className="absolute left-0">¼×</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${ONE}%` }}>1×</span>
        <span className="absolute right-0">8×</span>
      </div>
    </div>
  );
}
