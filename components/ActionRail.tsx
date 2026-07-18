'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Video } from '@/types';
import { storage } from '@/lib/storage';
import {
  BookmarkIcon,
  ListIcon,
  ReplayIcon,
  VolumeOffIcon,
  VolumeOnIcon,
} from '@/components/icons/Icons';

type ActionRailProps = {
  video: Video;
  unmuted: boolean;
  /** Deliberate sound toggle — muting here is a persisted user choice. */
  onToggleSound: () => void;
  onReplay: () => void;
  onOpenGlossary: () => void;
};

/**
 * TikTok-style vertical action stack, bottom-right of each slide:
 * sound toggle, saved-word count (links to /vocab filtered to this video),
 * the per-video glossary sheet (every word, coloured by knowledge), replay.
 */
export function ActionRail({
  video,
  unmuted,
  onToggleSound,
  onReplay,
  onOpenGlossary,
}: ActionRailProps) {
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    const refresh = () =>
      setSavedCount(
        storage.getSavedWords().filter((w) => w.videoId === video.id).length
      );
    refresh();
    return storage.onWordsChanged(refresh);
  }, [video.id]);

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-4">
      <button
        type="button"
        onClick={onToggleSound}
        aria-label={unmuted ? 'Mute' : 'Unmute'}
        className="flex flex-col items-center gap-1 transition-transform active:scale-90"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-text backdrop-blur-md">
          {unmuted ? (
            <VolumeOnIcon width={19} height={19} />
          ) : (
            <VolumeOffIcon width={19} height={19} className="text-muted" />
          )}
        </span>
        <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
          {unmuted ? 'Sound' : 'Muted'}
        </span>
      </button>

      <Link
        href={`/vocab?video=${encodeURIComponent(video.id)}`}
        aria-label={`${savedCount} words saved from this video`}
        className="flex flex-col items-center gap-1 transition-transform active:scale-90"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-text backdrop-blur-md">
          <BookmarkIcon
            width={19}
            height={19}
            className={savedCount > 0 ? 'text-accent' : undefined}
            fill={savedCount > 0 ? 'currentColor' : 'none'}
          />
        </span>
        <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
          {savedCount}
        </span>
      </Link>

      <button
        type="button"
        onClick={onOpenGlossary}
        aria-label="All words in this video"
        className="flex flex-col items-center gap-1 transition-transform active:scale-90"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-text backdrop-blur-md">
          <ListIcon width={19} height={19} />
        </span>
        <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
          Words
        </span>
      </button>

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
