'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { storage } from '@/lib/storage';
import { BookIcon, ChartIcon, ReplayIcon } from '@/components/icons/Icons';

type FeedEndCardProps = {
  /** Total slides in the feed, for the "you've seen all N" line. */
  totalVideos: number;
  /** Scroll the feed back to the first slide. */
  onRestart: () => void;
};

/**
 * The last slide of the feed.
 *
 * The feed is a finite list that does not repeat, so without this a user who
 * reaches the end is simply stuck on the finalvideo with no signal that they
 * have seen everything and nothing to do next. That dead end is worse the
 * more engaged the user is — it is only reachable by watching the whole feed.
 *
 * It deliberately routes to the vocabulary practice rather than faking more
 * content: finishing the feed is the moment the SRS has the most due words,
 * and re-watching is genuinely useful here (blanks are planned per session
 * from what is due, so a second pass is not the same experience twice).
 */
export function FeedEndCard({ totalVideos, onRestart }: FeedEndCardProps) {
  const [stats, setStats] = useState({ watched: 0, saved: 0, due: 0 });

  useEffect(() => {
    const refresh = () => {
      const words = storage.getSavedWords();
      const now = Date.now();
      setStats({
        watched: storage.getWatchedVideoIds().length,
        saved: words.length,
        due: words.filter((w) => w.dueAt <= now).length,
      });
    };
    refresh();
    return storage.onWordsChanged(refresh);
  }, []);

  return (
    <div className="relative flex h-[100dvh] w-full snap-start flex-col items-center justify-center overflow-hidden bg-background px-6 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
        End of the feed
      </p>
      <h2 className="mt-3 text-2xl font-bold text-text">
        You&rsquo;ve seen all {totalVideos} videos
      </h2>
      <p className="mt-2 max-w-xs text-sm text-muted">
        {stats.due > 0
          ? `${stats.due} of your words ${stats.due === 1 ? 'is' : 'are'} ready to practise right now.`
          : 'Come back later and your saved words will be waiting for review.'}
      </p>

      <div className="mt-7 flex w-full max-w-xs items-stretch gap-3">
        <div className="flex-1 rounded-2xl bg-white/5 px-3 py-3 ring-1 ring-white/10">
          <p className="text-xl font-bold tabular-nums text-text">{stats.watched}</p>
          <p className="mt-0.5 text-[11px] font-medium text-muted">watched</p>
        </div>
        <div className="flex-1 rounded-2xl bg-white/5 px-3 py-3 ring-1 ring-white/10">
          <p className="text-xl font-bold tabular-nums text-text">{stats.saved}</p>
          <p className="mt-0.5 text-[11px] font-medium text-muted">saved</p>
        </div>
        <div className="flex-1 rounded-2xl bg-white/5 px-3 py-3 ring-1 ring-white/10">
          <p className="text-xl font-bold tabular-nums text-accent">{stats.due}</p>
          <p className="mt-0.5 text-[11px] font-medium text-muted">due</p>
        </div>
      </div>

      <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
        <Link
          href="/vocab"
          className="flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 text-sm font-bold text-background transition-transform active:scale-95"
        >
          <BookIcon width={16} height={16} />
          Practise my words
        </Link>
        <button
          type="button"
          onClick={onRestart}
          className="flex items-center justify-center gap-2 rounded-full bg-white/8 px-5 py-3.5 text-sm font-semibold text-text ring-1 ring-white/12 transition-transform active:scale-95"
        >
          <ReplayIcon width={16} height={16} />
          Watch from the top
        </button>
        <Link
          href="/progress"
          className="flex items-center justify-center gap-2 py-1 text-sm font-medium text-muted transition-colors hover:text-text"
        >
          <ChartIcon width={14} height={14} />
          See my progress
        </Link>
      </div>
    </div>
  );
}
