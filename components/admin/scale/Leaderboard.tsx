'use client';

import { useMemo, useState } from 'react';
import { DASH } from '../RadekDashboard';
import { rankBy, type RankRow } from '@/lib/scaleStats';
import type { Model } from './ScaleDashboard';
import { CHANNELS, Cover, Empty, Pill, PillRow, VERDICT, compact } from './ui';

/**
 * The hook leaderboard (Radek, 2026-11-13: "I know best which hooks work",
 * so reels are cut without text and he types the hook in Instagram himself).
 * Hooks only, ranked by median views against that channel's usual reel.
 * Hooks are read off the covers of what he posted (scripts/scale/enrich.mts);
 * a misread one is fixed on the Reels tab.
 *
 * Two tables, because one lucky reel isn't a record: hooks with 3+ reels
 * behind them, then hooks tried once or twice.
 */

const PROVEN_N = 3;

export function Leaderboard({ m }: { m: Model }) {
  const [channel, setChannel] = useState<string>('all');

  const { proven, tried, waiting } = useMemo(() => {
    const posts = m.reels.filter((r) => channel === 'all' || m.username(r.igUserId) === channel);
    const byMedian = (a: RankRow, b: RankRow) => (b.medianMultiple ?? 0) - (a.medianMultiple ?? 0) || b.n - a.n;
    const rows = rankBy(posts, 'hook');
    return {
      proven: rows.filter((r) => r.n >= PROVEN_N).sort(byMedian),
      tried: rows.filter((r) => r.n < PROVEN_N).sort(byMedian),
      waiting: posts.filter((r) => !r.settled).length,
    };
  }, [m, channel]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-2xl p-4" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
        <PillRow>
          <Pill on={channel === 'all'} onClick={() => setChannel('all')}>All channels</Pill>
          {CHANNELS.map((c) => (
            <Pill key={c.account} on={channel === c.account} onClick={() => setChannel(c.account)} color={c.color}>{c.short}</Pill>
          ))}
        </PillRow>
        <p className="text-sm leading-relaxed" style={{ color: DASH.muted }}>
          <b style={{ color: DASH.ink }}>2.0×</b> = twice the views of that channel&apos;s usual reel when it went up. Hooks are read off
          your covers; tap a misread one on the Reels tab to fix it. Reels count after 48 hours
          {waiting > 0 && <> ({waiting} still climbing)</>}.
        </p>
      </div>

      <Section title="Proven" sub={`${PROVEN_N}+ reels behind each`} rows={proven} m={m} start={1} />
      <Section title="Tried once or twice" sub="one good reel can be luck: post it again before trusting it" rows={tried} m={m} start={proven.length + 1} faint />
    </div>
  );
}

function Section({ title, sub, rows, m, start, faint = false }: { title: string; sub: string; rows: RankRow[]; m: Model; start: number; faint?: boolean }) {
  return (
    <section className="grid gap-2">
      <h2 className="flex flex-wrap items-baseline gap-x-2 px-1">
        <span className="text-lg font-bold">{title}</span>
        <span className="text-sm" style={{ color: DASH.faint }}>{sub}</span>
      </h2>
      {rows.length === 0 ? (
        <Empty>No hooks here yet for this channel.</Empty>
      ) : (
        <ol className="grid gap-2">
          {rows.map((r, i) => (
            <Row key={r.key} r={r} rank={start + i} m={m} faint={faint} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({ r, rank, m, faint }: { r: RankRow; rank: number; m: Model; faint: boolean }) {
  const [copied, setCopied] = useState(false);
  const med = r.medianMultiple ?? 0;
  const color = med >= 1.5 ? DASH.green : med < 0.8 ? DASH.red : DASH.ink;
  const burned = r.verdict === 'fading';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.label);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard (http, old browser): the text is still selectable */
    }
  };

  return (
    <li
      className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-3 rounded-2xl p-3.5"
      style={{ background: faint ? DASH.inset : DASH.card, border: `1px solid ${DASH.line}` }}
    >
      <span className="pt-0.5 text-center font-mono text-xl font-bold tabular-nums" style={{ color: rank <= 3 && !faint ? DASH.ink : DASH.faint }}>
        {rank}
      </span>

      <div className="min-w-0">
        <p className="line-clamp-3 select-text text-[15px] font-semibold leading-snug">{r.label}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: DASH.muted }}>
          <span>{r.n} reel{r.n === 1 ? '' : 's'}</span>
          {r.n > 1 && r.max != null && <span>· best {r.max.toFixed(1)}×</span>}
          {r.n > PROVEN_N && r.recentMedian != null && (
            <span style={{ color: r.recentMedian >= 1.5 ? DASH.green : r.recentMedian < 0.8 ? DASH.red : DASH.muted }}>· last {PROVEN_N}: {r.recentMedian.toFixed(1)}×</span>
          )}
          <span>· {compact.format(r.totalViews)} views</span>
          {burned && (
            <span className="rounded-md px-1.5 py-px font-semibold" style={{ background: VERDICT.fading.soft, color: VERDICT.fading.color }}>burned out lately</span>
          )}
          <button onClick={copy} className="rounded-md px-1.5 py-px font-semibold" style={{ background: DASH.track, color: copied ? DASH.green : DASH.ink }}>
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
        <div className="mt-2 flex gap-1.5">
          {r.examples.map((id) => {
            const p = m.byId.get(id);
            return p ? <Cover key={id} src={p.thumbnailUrl} w={30} href={p.permalink} alt={p.tags?.hook ?? ''} /> : null;
          })}
        </div>
      </div>

      <span className="font-mono text-2xl font-bold tabular-nums" style={{ color }}>{med.toFixed(1)}×</span>
    </li>
  );
}
