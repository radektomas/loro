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
  /**
   * 'vertical' (default) is the TikTok stack over full-bleed video.
   * 'horizontal' is for YouTube-embed slides, where every pixel of vertical
   * space in the band is taken from the player: the stack is ~316px tall,
   * the row ~40px.
   *
   * The horizontal row also drops the text captions under each icon — on an
   * embed slide that second line costs ~20px of band, which is ~20px off the
   * video, and the four glyphs (speaker, bookmark, list, replay) carry their
   * own meaning. The saved-word COUNT is the one label with information in
   * it, so it survives as a badge on the bookmark.
   */
  orientation?: 'vertical' | 'horizontal';
};

/**
 * Action controls for a slide: sound toggle, saved-word count (links to
 * /vocab filtered to this video), the per-video glossary sheet (every word,
 * coloured by knowledge), replay.
 */
export function ActionRail({
  video,
  unmuted,
  onToggleSound,
  onReplay,
  onOpenGlossary,
  orientation = 'vertical',
}: ActionRailProps) {
  const [savedCount, setSavedCount] = useState(0);
  const compact = orientation === 'horizontal';
  // One circle size for both layouts' hit targets; only the caption goes.
  const circle = compact ? 'h-10 w-10' : 'h-11 w-11';

  useEffect(() => {
    const refresh = () =>
      setSavedCount(
        storage.getSavedWords().filter((w) => w.videoId === video.id).length
      );
    refresh();
    return storage.onWordsChanged(refresh);
  }, [video.id]);

  return (
    <div
      className={
        compact
          ? 'pointer-events-auto flex flex-row items-center justify-center gap-8'
          : 'pointer-events-auto flex flex-col items-center gap-4'
      }
    >
      <button
        type="button"
        onClick={onToggleSound}
        aria-label={unmuted ? 'Mute' : 'Unmute'}
        className="flex flex-col items-center gap-1 transition-transform active:scale-90"
      >
        <span className={`flex ${circle} items-center justify-center rounded-full bg-black/40 text-text backdrop-blur-md`}>
          {unmuted ? (
            <VolumeOnIcon width={19} height={19} />
          ) : (
            <VolumeOffIcon width={19} height={19} className="text-muted" />
          )}
        </span>
        {!compact && (
          <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
            {unmuted ? 'Sound' : 'Muted'}
          </span>
        )}
      </button>

      <Link
        href={`/vocab?video=${encodeURIComponent(video.id)}`}
        aria-label={`${savedCount} words saved from this video`}
        className="flex flex-col items-center gap-1 transition-transform active:scale-90"
      >
        <span className={`relative flex ${circle} items-center justify-center rounded-full bg-black/40 text-text backdrop-blur-md`}>
          <BookmarkIcon
            width={19}
            height={19}
            className={savedCount > 0 ? 'text-accent' : undefined}
            fill={savedCount > 0 ? 'currentColor' : 'none'}
          />
          {compact && savedCount > 0 && (
            <span className="absolute -right-1 -top-1 min-w-[1.15rem] rounded-full bg-accent px-1 text-[10px] font-bold leading-[1.15rem] text-background">
              {savedCount}
            </span>
          )}
        </span>
        {!compact && (
          <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
            {savedCount}
          </span>
        )}
      </Link>

      <button
        type="button"
        onClick={onOpenGlossary}
        aria-label="All words in this video"
        className="flex flex-col items-center gap-1 transition-transform active:scale-90"
      >
        <span className={`flex ${circle} items-center justify-center rounded-full bg-black/40 text-text backdrop-blur-md`}>
          <ListIcon width={19} height={19} />
        </span>
        {!compact && (
          <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
            Words
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onReplay}
        aria-label="Replay video"
        className="flex flex-col items-center gap-1 transition-transform active:scale-90"
      >
        <span className={`flex ${circle} items-center justify-center rounded-full bg-black/40 text-text backdrop-blur-md`}>
          <ReplayIcon width={18} height={18} />
        </span>
        {!compact && (
          <span className="text-xs font-semibold text-text [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
            Replay
          </span>
        )}
      </button>
    </div>
  );
}
