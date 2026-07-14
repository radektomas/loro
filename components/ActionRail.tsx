'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Video } from '@/types';
import { storage } from '@/lib/storage';
import { BookmarkIcon, ReplayIcon } from '@/components/icons/Icons';

type ActionRailProps = {
  video: Video;
  onReplay: () => void;
};

/**
 * TikTok-style vertical action stack, bottom-right of each slide:
 * saved-word count (links to /vocab filtered to this video), a progress
 * ring of KNOWN words (earned by typed recall) vs. saved words, and replay.
 */
export function ActionRail({ video, onReplay }: ActionRailProps) {
  const [saved, setSaved] = useState({ count: 0, known: 0 });

  useEffect(() => {
    const refresh = () => {
      const words = storage
        .getSavedWords()
        .filter((w) => w.videoId === video.id);
      setSaved({
        count: words.length,
        known: words.filter((w) => w.state === 'known').length,
      });
    };
    refresh();
    return storage.onWordsChanged(refresh);
  }, [video.id]);

  const ratio = saved.count > 0 ? Math.min(saved.known / saved.count, 1) : 0;

  // progress ring geometry
  const R = 14;
  const CIRC = 2 * Math.PI * R;

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-4">
      <Link
        href={`/vocab?video=${encodeURIComponent(video.id)}`}
        aria-label={`${saved.count} words saved from this video`}
        className="flex flex-col items-center gap-1 transition-transform active:scale-90"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-text backdrop-blur-md">
          <BookmarkIcon
            width={19}
            height={19}
            className={saved.count > 0 ? 'text-accent' : undefined}
            fill={saved.count > 0 ? 'currentColor' : 'none'}
          />
        </span>
        <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
          {saved.count}
        </span>
      </Link>

      <div
        aria-label={`${saved.known} of ${saved.count} saved words known`}
        role="img"
        className="flex flex-col items-center gap-1"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur-md">
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
            <circle
              cx="17"
              cy="17"
              r={R}
              fill="none"
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="3"
            />
            <circle
              cx="17"
              cy="17"
              r={R}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - ratio)}
              transform="rotate(-90 17 17)"
              className="transition-[stroke-dashoffset] duration-300"
            />
          </svg>
        </span>
        <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
          {saved.known}/{saved.count}
        </span>
      </div>

      <button
        type="button"
        onClick={onReplay}
        aria-label="Replay video"
        className="flex flex-col items-center gap-1 transition-transform active:scale-90"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-text backdrop-blur-md">
          <ReplayIcon width={18} height={18} />
        </span>
        <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
          Replay
        </span>
      </button>
    </div>
  );
}
