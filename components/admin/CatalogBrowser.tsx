'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyFilters,
  blockCommand,
  channelOf,
  EMPTY_FILTERS,
  loadTranscriptStats,
  posterOf,
  summarise,
  type CatalogFilters,
  type CatalogLevel,
  type CatalogSort,
  type CatalogVideo,
  type TranscriptStats,
} from '@/lib/adminCatalog';
import { CheckIcon, CloseIcon, GlobeIcon, SearchIcon } from '@/components/icons/Icons';

/**
 * The catalog management view.
 *
 * WHAT "CONTROL" MEANS HERE, and what it cannot mean. The repo JSON is
 * canonical and loro_catalog_videos is derived from it, so this component
 * never writes: a removal made here would be silently undone by the next
 * publish-catalog. Instead a selection produces the exact `npm run block`
 * command to run on the machine that owns the repo. That is a deliberate
 * seam, not a missing feature — see the header of lib/adminCatalog.ts.
 *
 * NO UI IS EVER LAID OVER THE PLAYER. The YouTube embed terms prohibit
 * overlaying an embedded player, which is why the app's own feed uses a band
 * layout (player above, everything Loro below). The same rule is kept here
 * even though this page is admin-only, because "it is only the admin view" is
 * exactly how a compliance rule stops being followed anywhere.
 */

function secs(n: number | null): string {
  return n === null ? '—' : `${Math.round(n)}s`;
}

const LEVEL_CLASS: Record<CatalogLevel, string> = {
  A1: 'bg-accent-soft text-accent',
  A2: 'bg-accent-soft text-accent',
  B1: 'bg-level-soft text-level',
  B2: 'bg-level-soft text-level',
};

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

/** One card. Collapsed it is a still and three chips; opened it plays. */
function VideoCard({
  video,
  open,
  selected,
  onToggleOpen,
  onToggleSelect,
  onFilterChannel,
}: {
  video: CatalogVideo;
  open: boolean;
  selected: boolean;
  onToggleOpen: () => void;
  onToggleSelect: () => void;
  onFilterChannel: (channel: string) => void;
}) {
  const [stats, setStats] = useState<TranscriptStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Transcript jsonb is fetched only for the card actually being looked at.
  useEffect(() => {
    if (!open || stats || statsError) return;
    let live = true;
    void loadTranscriptStats(video.id).then((r) => {
      if (!live) return;
      if (r.ok) setStats(r.data);
      else setStatsError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open, stats, statsError, video.id]);

  const still = posterOf(video);
  const channel = channelOf(video);

  return (
    <li
      className={`overflow-hidden rounded-3xl bg-surface transition-shadow ${
        selected ? 'ring-2 ring-[#f87171]' : ''
      } ${video.live ? '' : 'opacity-55'}`}
    >
      <button
        type="button"
        onClick={onToggleOpen}
        className="block w-full text-left"
        aria-expanded={open}
      >
        <div className="relative aspect-video w-full bg-black/40">
          {still ? (
            // i.ytimg.com is not in next.config images.remotePatterns, and
            // adding a remote host to the production image optimiser for an
            // admin-only grid of 382 thumbnails would put every one of them
            // through Vercel's optimiser on first paint. A plain img is the
            // cheaper, safer call.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={still}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : null}
          <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
            {secs(video.durationSeconds)}
          </span>
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-semibold text-text">{video.creator}</p>
          <p className="mt-0.5 truncate text-xs text-muted/70">{channel}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Chip className={LEVEL_CLASS[video.level]}>{video.level}</Chip>
            {video.license === 'creativeCommon' && (
              <Chip className="bg-white/10 text-muted">CC BY</Chip>
            )}
            {video.license === 'youtube' && (
              <Chip className="bg-amber-400/15 text-amber-300">Standard</Chip>
            )}
            {video.kind === 'seed' && (
              <Chip className="bg-white/10 text-muted">Seed</Chip>
            )}
            {!video.live && (
              <Chip className="bg-[#f87171]/15 text-[#f87171]">Removed</Chip>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-white/5 px-3 pb-3 pt-3">
          {video.youtubeId ? (
            <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
              <iframe
                className="h-full w-full"
                src={`https://www.youtube.com/embed/${video.youtubeId}`}
                title={`${video.creator} — ${video.id}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <p className="rounded-xl bg-white/5 px-3 py-2 text-xs text-muted">
              Seed clip — plays from storage in the app, not embeddable here.
            </p>
          )}

          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/5 py-2">
              <dt className="text-[10px] text-muted">Cues</dt>
              <dd className="text-sm font-semibold tabular-nums text-text">
                {stats ? stats.cues : '·'}
              </dd>
            </div>
            <div className="rounded-xl bg-white/5 py-2">
              <dt className="text-[10px] text-muted">Words</dt>
              <dd className="text-sm font-semibold tabular-nums text-text">
                {stats ? stats.words : '·'}
              </dd>
            </div>
            <div className="rounded-xl bg-white/5 py-2">
              <dt className="text-[10px] text-muted">Glossed</dt>
              <dd className="text-sm font-semibold tabular-nums text-text">
                {stats ? stats.dictionaryEntries : '·'}
              </dd>
            </div>
          </dl>

          {/* The one transcript defect that is invisible in the app until a
              user taps a word and saves a whole sentence. Surfaced because
              rows published before the ingest guard existed still carry it. */}
          {stats && stats.multiWordShare > 0.2 && (
            <p className="mt-2 rounded-xl bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
              {Math.round(stats.multiWordShare * 100)}% of this transcript&apos;s word
              tokens are whole lines, not words — karaoke, word taps and blanks
              will all misbehave. Worth blocking.
            </p>
          )}
          {statsError && (
            <p className="mt-2 rounded-xl bg-[#f87171]/10 px-3 py-2 text-[11px] text-[#f87171]">
              {statsError}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onFilterChannel(channel)}
              className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-text"
            >
              Only this channel
            </button>
            {video.videoUrl && (
              <a
                href={video.videoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-text"
              >
                <GlobeIcon width={13} height={13} />
                YouTube
              </a>
            )}
            <button
              type="button"
              onClick={onToggleSelect}
              className={`ml-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                selected
                  ? 'bg-[#f87171] text-background'
                  : 'bg-[#f87171]/15 text-[#f87171]'
              }`}
            >
              {selected ? <CheckIcon width={13} height={13} /> : null}
              {selected ? 'Marked for removal' : 'Mark for removal'}
            </button>
          </div>

          <p className="mt-2 select-all font-mono text-[10px] text-muted/50">{video.id}</p>
        </div>
      )}
    </li>
  );
}

export function CatalogBrowser({ videos }: { videos: CatalogVideo[] }) {
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<CatalogSort>('newest');
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => summarise(videos), [videos]);
  const orphanCount = useMemo(() => videos.filter((v) => !v.live).length, [videos]);
  const shown = useMemo(
    () => applyFilters(videos, filters, sort),
    [videos, filters, sort]
  );

  const set = useCallback(
    <K extends keyof CatalogFilters>(key: K, value: CatalogFilters[K]) =>
      setFilters((f) => ({ ...f, [key]: value })),
    []
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setCopied(false);
  }, []);

  const command = blockCommand([...selected], reason);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Clipboard is blocked on insecure origins and in some browsers. The
      // command is on screen and selectable, so this is a nicety failing, not
      // the feature failing — say nothing rather than throw a scary banner.
      setCopied(false);
    }
  };

  const maxOptions: { label: string; value: number | null }[] = [
    { label: 'Any length', value: null },
    { label: '≤ 30s', value: 30 },
    { label: '≤ 45s', value: 45 },
    { label: '≤ 60s', value: 60 },
  ];

  const selectClass =
    'rounded-xl bg-surface px-3 py-2 text-xs font-medium text-text outline-none';

  return (
    <div className="space-y-4 px-4 pb-40">
      {/* ---------------------------------------------------------- totals */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl bg-surface px-4 py-4">
          <p className="text-xs font-medium text-muted">Videos</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-text">
            {summary.total}
          </p>
          <p className="mt-0.5 text-[11px] text-muted/70">
            {summary.embeds} embed · {summary.seeds} seed
          </p>
        </div>
        <div className="rounded-2xl bg-surface px-4 py-4">
          <p className="text-xs font-medium text-muted">Channels</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-text">
            {summary.channels}
          </p>
          <p className="mt-0.5 text-[11px] text-muted/70">
            {(summary.total / Math.max(summary.channels, 1)).toFixed(1)} videos each
          </p>
        </div>
        <div className="rounded-2xl bg-surface px-4 py-4">
          <p className="text-xs font-medium text-muted">Median length</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-text">
            {secs(summary.medianSeconds)}
          </p>
        </div>
        <div className="rounded-2xl bg-surface px-4 py-4">
          <p className="text-xs font-medium text-muted">Levels</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-text">
            {(['A1', 'A2', 'B1', 'B2'] as const)
              .map((l) => `${l} ${summary.byLevel[l]}`)
              .join(' · ')}
          </p>
          <p className="mt-0.5 text-[11px] text-muted/70">
            {Math.round(
              ((summary.byLevel.A1 + summary.byLevel.A2) / Math.max(summary.total, 1)) *
                100
            )}
            % beginner
          </p>
        </div>
      </div>

      {/* -------------------------------------------------- concentration */}
      <section className="rounded-3xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-text">Who the feed is</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          The top channels by share. This is the number that decides whether the
          next content run should buy new faces or more of what already works.
        </p>
        <ul className="mt-3 space-y-1.5">
          {summary.topChannels.slice(0, 10).map(({ channel, count }) => (
            <li key={channel}>
              <button
                type="button"
                onClick={() =>
                  set('channel', filters.channel === channel ? 'all' : channel)
                }
                className="flex w-full items-center gap-3 text-left"
              >
                <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-text">
                  {count}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                  <span
                    className={`block h-full rounded-full ${
                      filters.channel === channel ? 'bg-accent' : 'bg-accent/45'
                    }`}
                    style={{
                      width: `${(count / summary.topChannels[0].count) * 100}%`,
                    }}
                  />
                </span>
                <span className="w-1/3 shrink-0 truncate text-xs text-muted">
                  {channel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* --------------------------------------------------------- filters */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 rounded-2xl bg-surface px-3">
          <SearchIcon width={15} height={15} className="shrink-0 text-muted" />
          <input
            value={filters.query}
            onChange={(e) => set('query', e.target.value)}
            placeholder="Search creator, channel or video id"
            className="w-full bg-transparent py-3 text-sm text-text outline-none placeholder:text-muted/60"
          />
          {filters.query && (
            <button type="button" onClick={() => set('query', '')} aria-label="Clear">
              <CloseIcon width={14} height={14} className="text-muted" />
            </button>
          )}
        </label>

        <div className="flex flex-wrap gap-2">
          <select
            value={filters.level}
            onChange={(e) => set('level', e.target.value as CatalogFilters['level'])}
            className={selectClass}
          >
            <option value="all">All levels</option>
            {(['A1', 'A2', 'B1', 'B2'] as const).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <select
            value={filters.license}
            onChange={(e) =>
              set('license', e.target.value as CatalogFilters['license'])
            }
            className={selectClass}
          >
            <option value="all">Any licence</option>
            <option value="creativeCommon">CC BY</option>
            <option value="youtube">Standard</option>
          </select>

          <select
            value={String(filters.maxSeconds ?? '')}
            onChange={(e) =>
              set('maxSeconds', e.target.value === '' ? null : Number(e.target.value))
            }
            className={selectClass}
          >
            {maxOptions.map((o) => (
              <option key={o.label} value={o.value ?? ''}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            value={filters.channel}
            onChange={(e) => set('channel', e.target.value)}
            className={`${selectClass} max-w-[45%]`}
          >
            <option value="all">All channels</option>
            {summary.topChannels.map(({ channel, count }) => (
              <option key={channel} value={channel}>
                {channel} ({count})
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as CatalogSort)}
            className={selectClass}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="shortest">Shortest first</option>
            <option value="longest">Longest first</option>
            <option value="channel">By channel</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-1">
          <p className="text-xs text-muted">
            {shown.length === summary.total
              ? `${summary.total} videos`
              : `${shown.length} of ${summary.total} videos`}
          </p>
          {orphanCount > 0 && (
            <button
              type="button"
              onClick={() => set('includeOrphans', !filters.includeOrphans)}
              aria-pressed={filters.includeOrphans}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                filters.includeOrphans
                  ? 'bg-[#f87171]/15 text-[#f87171]'
                  : 'bg-surface text-muted hover:text-text'
              }`}
              // These are rows the table keeps after a removal so that saved
              // words still resolve. They are not in the app, and none of the
              // counts above include them.
              title="Rows removed from the feed but kept in the table so saved words still resolve"
            >
              {filters.includeOrphans ? 'Hiding nothing' : 'Show'} {orphanCount} removed
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ grid */}
      {shown.length === 0 ? (
        <p className="rounded-3xl bg-surface px-4 py-10 text-center text-sm text-muted">
          Nothing matches those filters.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              open={openId === video.id}
              selected={selected.has(video.id)}
              onToggleOpen={() => setOpenId((id) => (id === video.id ? null : video.id))}
              onToggleSelect={() => toggleSelect(video.id)}
              onFilterChannel={(channel) => set('channel', channel)}
            />
          ))}
        </ul>
      )}

      {/* ------------------------------------------------- removal command */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-background/95 px-4 pb-safe pt-3 backdrop-blur-md">
          <div className="mx-auto max-w-4xl space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-text">
                {selected.size} marked for removal
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelected(new Set());
                  setCopied(false);
                }}
                className="ml-auto text-xs font-medium text-muted"
              >
                Clear
              </button>
            </div>
            <input
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setCopied(false);
              }}
              placeholder="Reason — required by the blocklist, and read by whoever reviews it later"
              className="w-full rounded-xl bg-surface px-3 py-2.5 text-xs text-text outline-none placeholder:text-muted/60"
            />
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-surface px-3 py-2.5 font-mono text-[11px] text-muted">
                {command}
              </code>
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-background transition-transform active:scale-[0.98]"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="pb-2 text-[11px] leading-relaxed text-muted/70">
              Run it in the repo. It writes the blocklist, refilters and prunes —
              then prints the <code className="font-mono">publish-catalog</code>{' '}
              command, which is the only step that reaches devices.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
