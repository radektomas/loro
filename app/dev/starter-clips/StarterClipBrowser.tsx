'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  describeStarterPlan,
  planStarterDeck,
  STARTER_CLIP_ALLOWLIST,
  starterCandidates,
  type StarterCandidate,
  type StarterCandidateRound,
  type StarterRoundSource,
  type StarterTopic,
} from '@/lib/starterRounds';

/** Badge copy and styling per topic — 'tech' is the one this whole page exists
    to help a curator spot and skip, so it alone gets a warning treatment. */
const TOPIC_STYLE: Record<StarterTopic, { label: string; className: string }> = {
  travel: { label: 'travel', className: 'bg-white/10 text-text/80' },
  dailyLife: { label: 'daily life', className: 'bg-white/10 text-text/80' },
  food: { label: 'food', className: 'bg-white/10 text-text/80' },
  culture: { label: 'culture', className: 'bg-white/10 text-text/80' },
  other: { label: 'other', className: 'bg-white/5 text-muted' },
  tech: { label: 'tech / tutorial', className: 'bg-red-500/20 text-red-400' },
};

/**
 * Which of a candidate's two prices to show as ITS row: round 1's (content
 * words only) when the clip can actually open the deck, otherwise the later-
 * round price (one function word allowed) — the same choice starterCandidates
 * ranks the list by, so a row's own headline numbers match its position in it.
 */
function shownRound(candidate: StarterCandidate): StarterCandidateRound {
  return candidate.round1Ready ? candidate.asRound1 : candidate.asLaterRound;
}

/**
 * The starter-clip curation browser — see the route file for why it exists.
 *
 * THE LIST IS THE DECK'S OWN. Every row comes from starterCandidates(), which
 * shares its candidate construction and its ranking with the planner, so this
 * page cannot show a clip the deck would refuse or hide one it would accept.
 * Rows are ordered exactly as the planner ranks them for ROUND 1, so the
 * algorithm's own first pick is the first row.
 *
 * A BRAND-NEW USER'S VIEW, deliberately: saved and watched sets are empty
 * rather than read from this device's localStorage. Curation is a decision about
 * what every new user gets, and pricing it against the curator's own history
 * would hide exactly the clips they have already watched — which, for whoever
 * is doing the curating, is most of them.
 *
 * NO SHARED PLAYER HERE. The previews are plain trimmed iframes, one at a time,
 * with YouTube's own controls: this page must be able to judge a clip while the
 * deck's player provider is being changed, and a curation tool that can break
 * the product's playback path is worse than no tool. Nothing is drawn over a
 * preview either — same embed-terms rule as the feed.
 */

type Row = StarterCandidate & {
  /** 1-based round this clip fills in the plan, or null if it is not picked. */
  plannedRound: number | null;
  plannedSource: StarterRoundSource | null;
  /** 1-based position in STARTER_CLIP_ALLOWLIST, or null. */
  curatedPosition: number | null;
};

export function StarterClipBrowser() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [report, setReport] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Dynamic import for the same reason the deck does it: the catalog carries
    // every embed transcript (~5.4MB of JSON).
    void import('@/lib/localVideos').then(({ localVideos }) => {
      if (cancelled) return;
      const options = { videos: localVideos, savedIds: new Set<string>() };
      const plan = planStarterDeck(options);
      const picked = new Map(
        plan.rounds.map((round, i) => [
          round.video.id,
          { round: i + 1, source: round.source },
        ])
      );
      setRows(
        starterCandidates(options).map((candidate) => {
          const pick = picked.get(candidate.video.id);
          const curatedAt = STARTER_CLIP_ALLOWLIST.indexOf(candidate.video.id);
          return {
            ...candidate,
            plannedRound: pick?.round ?? null,
            plannedSource: pick?.source ?? null,
            curatedPosition: curatedAt < 0 ? null : curatedAt + 1,
          };
        })
      );
      setReport(describeStarterPlan(plan));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyId = useCallback(async (id: string) => {
    // navigator.clipboard is unavailable on http:// origins, which is exactly
    // how this page is opened from a phone on the LAN — hence the fallback.
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const field = document.createElement('textarea');
      field.value = id;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try {
        document.execCommand('copy');
      } catch {
        // Nothing left to try; the id is on screen and selectable.
      }
      field.remove();
    }
    setCopied(id);
    window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  }, []);

  const summary = useMemo(() => {
    if (!rows) return '';
    const short = rows.filter((r) => shownRound(r).payoffEnd <= 30).length;
    const openers = rows.filter((r) => r.round1Ready).length;
    return `${rows.length} eligible · ${short} under 30s · ${openers} can open the deck`;
  }, [rows]);

  return (
    <main className="min-h-[100dvh] bg-background px-4 pt-safe pb-16 text-text">
      <header className="mx-auto max-w-2xl py-5">
        <h1 className="text-xl font-bold tracking-tight">Starter clips</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Every clip the starter deck would accept, ranked as it ranks them for
          round 1. Watch the previews, then put the winners in{' '}
          <code className="text-text/80">STARTER_CLIP_ALLOWLIST</code> —
          in round order.
        </p>
        {rows && (
          <p className="mt-2 text-xs font-semibold tabular-nums text-muted">
            {summary}
          </p>
        )}
        {report.length > 0 && (
          <pre className="mt-3 overflow-x-auto rounded-xl bg-surface p-3 text-[11px] leading-relaxed text-text/80">
            {report.join('\n')}
          </pre>
        )}
        {STARTER_CLIP_ALLOWLIST.length === 0 && (
          <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
            The allowlist is empty, so the ranking alone is choosing all three
            rounds.
          </p>
        )}
      </header>

      {rows === null ? (
        <p className="mx-auto max-w-2xl text-sm text-muted">Loading catalog…</p>
      ) : (
        <ul className="mx-auto flex max-w-2xl flex-col gap-3">
          {rows.map((row) => (
            <CandidateRow
              key={row.video.id}
              row={row}
              previewing={previewId === row.video.id}
              onPreview={() =>
                setPreviewId((current) =>
                  current === row.video.id ? null : row.video.id
                )
              }
              onCopy={() => void copyId(row.video.id)}
              copied={copied === row.video.id}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function CandidateRow({
  row,
  previewing,
  onPreview,
  onCopy,
  copied,
}: {
  row: Row;
  previewing: boolean;
  onPreview: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const { video } = row;
  const round = shownRound(row);
  const roundLength = `${round.payoffEnd.toFixed(1)}s`;

  return (
    <li
      className={`rounded-2xl bg-surface p-3 ${
        row.plannedRound ? 'ring-2 ring-accent' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {row.plannedRound && (
          <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-background">
            ROUND {row.plannedRound} · {row.plannedSource}
          </span>
        )}
        {row.curatedPosition !== null && (
          <span className="rounded-md bg-level-soft px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-level">
            curated #{row.curatedPosition}
          </span>
        )}
        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-accent">
          {video.level}
        </span>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${TOPIC_STYLE[row.topic].className}`}
          title="Inferred from the clip's own vocabulary — see lib/starterTopics.ts"
        >
          {TOPIC_STYLE[row.topic].label}
        </span>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${
            row.round1Ready
              ? 'bg-white/10 text-text/70'
              : 'bg-white/5 text-muted'
          }`}
          title="Round 1 allows no function words"
        >
          {row.round1Ready
            ? 'round 1 ok'
            : `round 1 no (${row.asRound1.targets.length} content)`}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="min-w-0 flex-1 truncate rounded-lg bg-surface-raised px-2.5 py-2 text-left font-mono text-[13px] text-text transition-colors active:bg-white/15"
        >
          {copied ? 'copied ✓' : video.id}
        </button>
        <span className="shrink-0 text-xs tabular-nums text-muted">
          round {roundLength} · video{' '}
          {row.durationSeconds === null ? '?' : `${row.durationSeconds}s`}
        </span>
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {round.targets.map((target) => {
          const span = round.occurrences.get(target.entry.id);
          const seconds = span ? span.end - span.start : 0;
          return (
            <li
              key={target.entry.id}
              className="rounded-lg bg-surface-raised px-2 py-1 text-[13px]"
            >
              <span className={target.content ? 'text-text' : 'text-muted'}>
                {target.entry.word}
                {target.content ? '' : '*'}
              </span>{' '}
              <span className="tabular-nums text-[11px] text-muted">
                {seconds.toFixed(2)}s
                {span ? ` · cue ${span.cueIndex}` : ' · not found'}
              </span>
            </li>
          );
        })}
      </ul>

      {/* The preview: the round exactly as the deck would play it — from the
          start, ending at payoffEnd. One iframe at a time (tapping another row
          unmounts this one), and NOTHING is drawn over it. */}
      <button
        type="button"
        onClick={onPreview}
        className="mt-2.5 w-full rounded-xl bg-surface-raised py-2.5 text-sm font-semibold text-text transition-colors active:bg-white/15"
      >
        {previewing ? 'Close preview' : `Preview round (${roundLength})`}
      </button>
      {previewing && (
        <div className="mt-2 flex justify-center">
          <div
            className="h-[60vh] max-w-full overflow-hidden rounded-xl bg-black"
            style={{ aspectRatio: '9 / 16' }}
          >
            <iframe
              // Mounted inside the tap that asked for it, so autoplay counts as
              // gesture-initiated. `end` trims playback to the round's payoff
              // window; controls stay ON — this is a judging tool, and scrubbing
              // back over a word is the point.
              src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?start=0&end=${Math.ceil(
                round.payoffEnd
              )}&autoplay=1&playsinline=1&rel=0&modestbranding=1&fs=0&iv_load_policy=3`}
              title={`Round preview for ${video.id}`}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen={false}
              className="h-full w-full border-0"
            />
          </div>
        </div>
      )}
    </li>
  );
}
