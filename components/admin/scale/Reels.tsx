'use client';

import { useMemo, useState } from 'react';
import { DASH } from '../RadekDashboard';
import { DEMO_KINDS, FORMATS, type ScoredPost } from '@/lib/scaleStats';
import type { Model } from './ScaleDashboard';
import { CHANNELS, ChannelChip, Cover, Empty, MultipleBadge, Pill, PillRow, compact, day } from './ui';

type Band = 'all' | 'hit' | 'ok' | 'quiet' | 'climbing';
type Sort = 'multiple' | 'views' | 'date' | 'comments';

const BANDS: { id: Band; label: string; test: (r: ScoredPost) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'hit', label: '3× and up', test: (r) => r.settled && (r.multiple ?? 0) >= 3 },
  { id: 'ok', label: '1–3×', test: (r) => r.settled && (r.multiple ?? 0) >= 1 && (r.multiple ?? 0) < 3 },
  { id: 'quiet', label: 'Under 1×', test: (r) => r.settled && r.multiple != null && r.multiple < 1 },
  { id: 'climbing', label: 'Still climbing', test: (r) => !r.settled },
];

const FORMAT_LABEL: Record<string, string> = { cut: '/cut reel', phrases: 'Phrases', 'outline-game': 'Outline game', other: 'Other' };
const DEMO_LABEL: Record<string, string> = { reels: 'Reels demo', peppa: 'Peppa demo', other: 'Other demo', unknown: 'Demo?' };

export function Reels({ m }: { m: Model }) {
  const [channel, setChannel] = useState<string>('all');
  const [format, setFormat] = useState<string>('all');
  const [band, setBand] = useState<Band>('all');
  const [needsHook, setNeedsHook] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('date');
  const [shown, setShown] = useState(40);

  const list = useMemo(() => {
    const bandTest = BANDS.find((b) => b.id === band)!.test;
    const needle = q.trim().toLowerCase();
    const out = m.reels.filter(
      (r) =>
        (channel === 'all' || m.username(r.igUserId) === channel) &&
        (format === 'all' || (r.tags?.format ?? 'other') === format) &&
        bandTest(r) &&
        (!needsHook || !r.tags?.hook) &&
        (!needle || (r.tags?.hook ?? '').toLowerCase().includes(needle) || (r.caption ?? '').toLowerCase().includes(needle))
    );
    const key: Record<Sort, (r: ScoredPost) => number> = {
      multiple: (r) => (r.settled ? r.multiple ?? -1 : -2),
      views: (r) => r.latest?.views ?? -1,
      date: (r) => new Date(r.postedAt).getTime(),
      comments: (r) => r.commentsPer1k ?? -1,
    };
    return out.sort((a, b) => key[sort](b) - key[sort](a));
  }, [m, channel, format, band, needsHook, q, sort]);

  const missing = m.reels.filter((r) => !r.tags?.hook).length;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-2xl p-4" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
        <PillRow>
          <Pill on={channel === 'all'} onClick={() => setChannel('all')}>All channels</Pill>
          {CHANNELS.map((c) => (
            <Pill key={c.account} on={channel === c.account} onClick={() => setChannel(c.account)} color={c.color}>{c.short}</Pill>
          ))}
        </PillRow>
        <PillRow>
          {BANDS.map((b) => (
            <Pill key={b.id} on={band === b.id} onClick={() => setBand(b.id)}>{b.label}</Pill>
          ))}
          <Pill on={needsHook} onClick={() => setNeedsHook(!needsHook)}>Needs a hook{missing ? ` (${missing})` : ''}</Pill>
        </PillRow>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search hooks…"
            aria-label="Search hooks"
            className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: DASH.page, border: `1px solid ${DASH.line}`, color: DASH.ink, minWidth: 160 }}
          />
          <Select value={format} onChange={setFormat} label="Format" options={[['all', 'All formats'], ...FORMATS.map((f) => [f, FORMAT_LABEL[f]] as [string, string])]} />
          <Select value={sort} onChange={(v) => setSort(v as Sort)} label="Sort" options={[['date', 'Newest'], ['multiple', 'Best vs channel'], ['views', 'Most views'], ['comments', 'Most comments / 1k']]} />
        </div>
      </div>

      <p className="text-sm" style={{ color: DASH.muted }}>
        {list.length} reel{list.length === 1 ? '' : 's'} · the multiple is views against that channel&apos;s usual reel when it went up (1× = ordinary).
      </p>

      {list.length === 0 ? (
        <Empty>No reels match these filters.</Empty>
      ) : (
        <ul className="grid gap-2.5">
          {list.slice(0, shown).map((r) => (
            <ReelRow key={r.mediaId} r={r} m={m} />
          ))}
        </ul>
      )}
      {list.length > shown && (
        <button onClick={() => setShown(shown + 40)} className="mx-auto rounded-xl px-5 py-2.5 text-sm font-semibold" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
          Show {Math.min(40, list.length - shown)} more
        </button>
      )}
    </div>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="rounded-lg px-2.5 py-2 text-sm font-semibold"
      style={{ background: DASH.page, border: `1px solid ${DASH.line}`, color: DASH.ink, colorScheme: 'dark' }}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span style={{ color: DASH.faint }}>{label} </span>
      <span className="font-semibold tabular-nums" style={{ color: DASH.ink }}>{value}</span>
    </span>
  );
}

function ReelRow({ r, m }: { r: ScoredPost; m: Model }) {
  const [editing, setEditing] = useState(false);
  const [hook, setHook] = useState(r.tags?.hook ?? '');
  const [err, setErr] = useState<string | null>(null);
  const cut = m.data.cutReels[r.mediaId];
  const t = r.tags;
  const save = async (patch: Record<string, unknown>) => {
    const e = await m.act('/api/marketing/tags', 'PATCH', { mediaId: r.mediaId, ...patch });
    setErr(e);
    return e;
  };
  const src = t?.manual ? 'edited' : t?.hookSource === 'cut' ? 'from /cut' : t?.hookSource === 'cover' ? 'read off cover' : null;

  return (
    <li className="flex gap-3 rounded-2xl p-3 sm:gap-4" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
      <Cover src={r.thumbnailUrl} w={56} href={r.permalink} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editing ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!(await save({ hook }))) setEditing(false);
                }}
                className="flex gap-2"
              >
                <input
                  autoFocus
                  value={hook}
                  onChange={(e) => setHook(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
                  aria-label="Hook"
                  className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm outline-none"
                  style={{ background: DASH.page, border: `1px solid ${DASH.green}`, color: DASH.ink }}
                />
                <button type="submit" className="rounded-lg px-3 text-sm font-bold" style={{ background: DASH.green, color: DASH.page }}>Save</button>
              </form>
            ) : (
              <button onClick={() => setEditing(true)} className="group block text-left" title="Click to fix the hook">
                {t?.hook ? (
                  <span className="text-[15px] font-semibold leading-snug">{t.hook}</span>
                ) : (
                  <span className="text-[15px] font-semibold" style={{ color: DASH.orange }}>+ add hook</span>
                )}
                <span className="ml-2 text-[11px] opacity-0 transition-opacity group-hover:opacity-100" style={{ color: DASH.faint }}>edit</span>
              </button>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: DASH.muted }}>
              <ChannelChip account={m.username(r.igUserId)} />
              <span>{day(r.postedAt)}</span>
              <span>·</span>
              <span className="font-semibold" style={{ color: DASH.ink }}>{compact.format(r.latest?.views ?? 0)} views</span>
              {src && <span className="rounded px-1.5 py-px text-[10px] font-semibold" style={{ background: DASH.track }}>{src}</span>}
            </div>
          </div>
          <MultipleBadge m={r.multiple} size="lg" climbing={!r.settled} />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          <Stat label="comments/1k" value={r.commentsPer1k != null ? r.commentsPer1k.toFixed(1) : '–'} />
          <Stat label="shares+saves/1k" value={r.sharesSavesPer1k != null ? r.sharesSavesPer1k.toFixed(1) : '–'} />
          <Stat label="avg watch" value={r.latest?.avgWatchMs != null ? `${(r.latest.avgWatchMs / 1000).toFixed(1)}s` : '–'} />
          {r.latest?.skipRate != null && <Stat label="skip" value={`${Math.round(r.latest.skipRate)}%`} />}
          <span className="flex flex-wrap items-center gap-1.5">
            <TagSelect value={t?.format ?? 'other'} options={FORMATS} labels={FORMAT_LABEL} onChange={(v) => void save({ format: v })} label="Format" />
            <TagSelect value={t?.demoKind ?? 'unknown'} options={DEMO_KINDS} labels={DEMO_LABEL} onChange={(v) => void save({ demoKind: v })} label="Demo" />
          </span>
          <span className="ml-auto flex gap-3 font-semibold">
            {cut && <a href={`/cut#${cut.id}`} style={{ color: DASH.green }}>/cut ↗</a>}
            {r.permalink && <a href={r.permalink} target="_blank" rel="noreferrer" style={{ color: DASH.muted }}>Instagram ↗</a>}
          </span>
        </div>
        {err && <p className="mt-1.5 text-xs" style={{ color: DASH.red }}>{err}</p>}
      </div>
    </li>
  );
}

function TagSelect({ value, options, labels, onChange, label }: { value: string; options: string[]; labels: Record<string, string>; onChange: (v: string) => void; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="rounded-md px-1.5 py-1 text-[11px] font-semibold"
      style={{ background: DASH.inset, border: `1px solid ${DASH.line}`, color: value === 'unknown' || value === 'other' ? DASH.muted : DASH.ink, colorScheme: 'dark' }}
    >
      {options.map((o) => (
        <option key={o} value={o}>{labels[o]}</option>
      ))}
    </select>
  );
}
