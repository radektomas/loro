'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SavedWord, Video, WordState } from '@/types';
import { storage } from '@/lib/storage';
import { formatDue } from '@/lib/srs';
import { computeStreaks, dueCount, nextDueAt } from '@/lib/progress';
import { LoroMascot } from '@/components/LoroMascot';
import { SignInCard } from '@/components/SignInCard';
import { BookIcon, ChevronLeftIcon } from '@/components/icons/Icons';
import videosData from '@/data/videos.json';

const videos = videosData as unknown as Video[];

/** Segment styling for the word-state bar. Red is reserved for lapses;
    green is earned by knowing; the pipeline states stay neutral. */
const STATE_SEGMENTS: { state: WordState; label: string; dot: string }[] = [
  { state: 'lapsed', label: 'Lapsed', dot: 'bg-[#f87171]' },
  { state: 'new', label: 'New', dot: 'bg-white/25' },
  { state: 'learning', label: 'Learning', dot: 'bg-muted' },
  { state: 'known', label: 'Known', dot: 'bg-accent' },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-muted">
      {children}
    </h2>
  );
}

/** One honest, only-goes-up number. `hero` is the emphasized "Learned" card. */
function MetricCard({
  value,
  label,
  hero = false,
}: {
  value: number;
  label: string;
  hero?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl px-3 py-5 text-center ${
        hero
          ? 'bg-gradient-to-br from-accent/25 via-accent-soft to-surface ring-1 ring-accent/25'
          : 'bg-surface'
      }`}
    >
      <p
        className={`font-bold tabular-nums tracking-tight ${
          hero ? 'text-5xl text-text' : 'text-4xl text-text'
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
    </div>
  );
}

export default function ProgressPage() {
  const [words, setWords] = useState<SavedWord[]>([]);
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [recallDays, setRecallDays] = useState<string[]>([]);
  const [now, setNow] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const refresh = useCallback(() => {
    setWords(storage.getSavedWords());
    setWatchedIds(storage.getWatchedVideoIds());
    setRecallDays(storage.getCorrectRecallDays());
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    setHydrated(true);
    return storage.onWordsChanged(refresh);
  }, [refresh]);

  // The honest headline numbers — every one only goes up as you learn.
  const totals = useMemo(() => {
    let learned = 0;
    let learning = 0;
    let recalls = 0;
    for (const w of words) {
      if (w.state === 'known') learned++;
      else if (w.state === 'learning') learning++;
      recalls += w.correct;
    }
    return { learned, learning, recalls };
  }, [words]);

  // Per video: how many words you've saved, and how many you've learned.
  const videoRows = useMemo(() => {
    const byVideo = new Map<string, { saved: number; learned: number }>();
    for (const w of words) {
      const e = byVideo.get(w.videoId) ?? { saved: 0, learned: 0 };
      e.saved++;
      if (w.state === 'known') e.learned++;
      byVideo.set(w.videoId, e);
    }
    return videos
      .map((video) => {
        const e = byVideo.get(video.id) ?? { saved: 0, learned: 0 };
        return { video, saved: e.saved, learned: e.learned };
      })
      .sort((a, b) => b.saved - a.saved); // most-engaged first
  }, [words]);

  const stateCounts = useMemo(() => {
    const counts = { lapsed: 0, new: 0, learning: 0, known: 0 };
    for (const w of words) counts[w.state]++;
    return counts;
  }, [words]);

  const due = useMemo(() => dueCount(words, now), [words, now]);
  const nextDue = useMemo(() => nextDueAt(words, now), [words, now]);
  const streaks = useMemo(
    () => computeStreaks(recallDays, now),
    [recallDays, now]
  );

  const empty = words.length === 0 && watchedIds.length === 0;

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <header className="sticky top-0 z-10 bg-background/85 pt-safe backdrop-blur-md">
        <div className="flex items-center gap-2 px-4 py-4">
          <Link
            href="/"
            aria-label="Back to feed"
            className="rounded-full bg-surface p-2 text-muted transition-colors hover:text-text"
          >
            <ChevronLeftIcon width={20} height={20} />
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-text">
            Progress
          </h1>
          <Link
            href="/vocab"
            aria-label="My words"
            className="ml-auto rounded-full bg-surface p-2 text-muted transition-colors hover:text-text"
          >
            <BookIcon width={18} height={18} />
          </Link>
        </div>
      </header>

      {hydrated && empty && (
        <div className="flex flex-col items-center px-8 pt-24 text-center">
          <LoroMascot state="sleeping" size={120} />
          <h2 className="mt-6 text-lg font-semibold text-text">
            Nothing to measure yet
          </h2>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
            Watch videos, save words, and recall them — your progress shows up
            here.
          </p>
          <Link
            href="/"
            className="mt-8 rounded-2xl bg-accent px-6 py-3 text-base font-semibold text-background transition-transform active:scale-95"
          >
            Watch videos
          </Link>
          <div className="mt-10 w-full max-w-sm text-left">
            <SignInCard />
          </div>
        </div>
      )}

      {hydrated && !empty && (
        <div className="space-y-8 px-4 pb-10">
          <SignInCard />

          {/* 1 — The honest headline: what you've learned. Every stat only
              ever goes up — never a score that punishes knowing the language. */}
          <section className="grid grid-cols-3 gap-2">
            <MetricCard value={totals.learned} label="Learned" hero />
            <MetricCard value={totals.learning} label="Learning" />
            <MetricCard value={totals.recalls} label="Recalls" />
          </section>

          {/* 2 — Streak: consecutive days with a correct recall, counted
              quietly. A gap resets it silently — no fire, no guilt. */}
          <section>
            <SectionTitle>Streak</SectionTitle>
            <div className="flex items-center justify-between rounded-3xl bg-surface p-5">
              {streaks.current > 0 ? (
                <div>
                  <p className="text-3xl font-bold tracking-tight text-text">
                    {streaks.current}{' '}
                    <span className="text-base font-semibold text-muted">
                      {streaks.current === 1 ? 'day' : 'days'}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    of correct recalls in a row
                  </p>
                </div>
              ) : (
                <p className="text-sm leading-relaxed text-muted">
                  No streak right now. One correct recall starts one.
                </p>
              )}
              {streaks.longest > 0 && (
                <p className="shrink-0 self-end text-xs text-muted/70">
                  Longest: {streaks.longest}{' '}
                  {streaks.longest === 1 ? 'day' : 'days'}
                </p>
              )}
            </div>
          </section>

          {/* 3 — Due today. Caught up is a good state, not a nag. */}
          <section>
            <SectionTitle>Reviews</SectionTitle>
            {due > 0 ? (
              <div className="flex items-center gap-4 rounded-3xl bg-accent-soft p-5 ring-1 ring-accent/25">
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-bold tracking-tight text-text">
                    {due} {due === 1 ? 'word' : 'words'} due
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    They&apos;ll appear as blanks while you watch.
                  </p>
                </div>
                <Link
                  href="/"
                  className="shrink-0 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-background transition-transform active:scale-95"
                >
                  Review
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-4 rounded-3xl bg-surface p-5">
                <LoroMascot state="sleeping" size={64} />
                <div className="min-w-0">
                  <p className="text-base font-semibold text-text">
                    All caught up
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {nextDue
                      ? `Nothing to review — next word is due ${formatDue(nextDue, now)}.`
                      : 'Save words from the feed and Loro will schedule them for you.'}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* 2 — Word states, each segment linking into /vocab */}
          {words.length > 0 && (
            <section>
              <SectionTitle>Words</SectionTitle>
              <div className="rounded-3xl bg-surface p-5">
                <div className="flex h-3 gap-px overflow-hidden rounded-full">
                  {STATE_SEGMENTS.filter(
                    (s) => stateCounts[s.state] > 0
                  ).map((s) => (
                    <Link
                      key={s.state}
                      href={`/vocab?state=${s.state}`}
                      aria-label={`${stateCounts[s.state]} ${s.label.toLowerCase()} words`}
                      style={{ flexGrow: stateCounts[s.state] }}
                      className={`min-w-3.5 basis-0 ${s.dot}`}
                    />
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                  {STATE_SEGMENTS.map((s) => (
                    <Link
                      key={s.state}
                      href={`/vocab?state=${s.state}`}
                      className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-text"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${s.dot}`}
                        aria-hidden
                      />
                      {s.label}
                      <span className="font-semibold text-text">
                        {stateCounts[s.state]}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* 5 — Videos: saved vs learned per video, most-engaged first.
              Deep-links back into the feed to replay and review. */}
          <section>
            <SectionTitle>Videos</SectionTitle>
            <ul className="space-y-2">
              {videoRows.map(({ video, saved, learned }) => (
                <li key={video.id}>
                  <Link
                    href={`/?v=${encodeURIComponent(video.id)}`}
                    className="flex items-center gap-3 rounded-2xl bg-surface px-3 py-3 transition-colors hover:bg-surface-raised"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={video.poster}
                      alt=""
                      className="h-14 w-10 shrink-0 rounded-lg bg-surface-raised object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-text">
                          {video.creator}
                        </span>
                        <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-accent">
                          {video.level}
                        </span>
                      </div>
                      {saved > 0 ? (
                        <>
                          <p className="mt-1 text-xs">
                            <span className="font-semibold text-accent">
                              {learned} learned
                            </span>
                            <span className="text-muted/50"> · </span>
                            <span className="text-muted">{saved} saved</span>
                          </p>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-accent transition-[width] duration-500"
                              style={{
                                width: `${Math.round((learned / saved) * 100)}%`,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <p className="mt-1.5 text-xs text-muted/70">
                          Nothing saved yet
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Replay the guided intro — the loop, taught by doing it. */}
          <div className="pt-2 text-center">
            <Link
              href="/welcome"
              className="text-xs font-medium text-muted transition-colors hover:text-text"
            >
              Replay intro
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
