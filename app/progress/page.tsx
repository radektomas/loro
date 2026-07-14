'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SavedWord, Video, WordState } from '@/types';
import { storage } from '@/lib/storage';
import { formatDue } from '@/lib/srs';
import {
  averageComprehension,
  computeStreaks,
  dueCount,
  knownWordSet,
  levelLadder,
  nextDueAt,
  videoComprehension,
} from '@/lib/progress';
import { LoroMascot } from '@/components/LoroMascot';
import { SignInCard } from '@/components/SignInCard';
import { BookIcon, ChevronLeftIcon, LockIcon } from '@/components/icons/Icons';
import videosData from '@/data/videos.json';

const videos = videosData as unknown as Video[];

const pct = (ratio: number) => Math.round(ratio * 100);

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

  const known = useMemo(() => knownWordSet(words), [words]);

  const videoRows = useMemo(() => {
    const watched = new Set(watchedIds);
    return videos
      .map((video) => ({
        video,
        comp: videoComprehension(video, known),
        watched: watched.has(video.id),
      }))
      .sort((a, b) => b.comp.ratio - a.comp.ratio);
  }, [known, watchedIds]);

  const average = useMemo(() => {
    const watched = new Set(watchedIds);
    return averageComprehension(
      videos.filter((v) => watched.has(v.id)),
      known
    );
  }, [known, watchedIds]);

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
  const ladder = useMemo(() => levelLadder(videos, known), [known]);

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
            Watch videos, save words, and your comprehension will show up
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

          {/* 1 — Comprehension: the number that should grow */}
          <section>
            <div className="rounded-3xl bg-surface px-6 py-7">
              {average === null ? (
                <p className="text-sm leading-relaxed text-muted">
                  Watch a video and your comprehension shows up here.
                </p>
              ) : (
                <>
                  <p className="text-6xl font-bold tracking-tight text-text">
                    {pct(average)}
                    <span className="text-3xl text-muted">%</span>
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    You understand {pct(average)}% of what you&apos;ve
                    watched.
                  </p>
                </>
              )}
            </div>

            <ul className="mt-3 space-y-2">
              {videoRows.map(({ video, comp, watched }) => (
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
                        {!watched && (
                          <span className="shrink-0 text-[10px] text-muted/70">
                            not watched yet
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${pct(comp.ratio)}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-10 shrink-0 text-right text-sm font-semibold text-text">
                      {pct(comp.ratio)}%
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
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

          {/* 4 — Streak: correct recalls, counted quietly */}
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

          {/* 5 — Level ladder, earned through comprehension */}
          <section>
            <SectionTitle>Level</SectionTitle>
            <ol className="space-y-2">
              {ladder.map((band) => (
                <li
                  key={band.level}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${
                    band.current
                      ? 'bg-accent-soft ring-1 ring-accent/30'
                      : 'bg-surface'
                  } ${band.unlocked ? '' : 'opacity-55'}`}
                >
                  <span
                    className={`w-7 shrink-0 text-sm font-bold ${
                      band.unlocked ? 'text-text' : 'text-muted'
                    }`}
                  >
                    {band.level}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${pct(band.ratio ?? 0)}%` }}
                    />
                  </div>
                  {band.ratio === null ? (
                    <span className="shrink-0 text-xs text-muted/70">
                      no videos yet
                    </span>
                  ) : (
                    <span className="w-9 shrink-0 text-right text-xs font-semibold text-text">
                      {pct(band.ratio)}%
                    </span>
                  )}
                  {band.current && (
                    <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">
                      Current
                    </span>
                  )}
                  {!band.unlocked && (
                    <LockIcon
                      width={14}
                      height={14}
                      className="shrink-0 text-muted/60"
                      aria-label="Locked"
                    />
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-2 px-1 text-xs leading-relaxed text-muted/70">
              A level unlocks once you understand 80% of the videos below it.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
