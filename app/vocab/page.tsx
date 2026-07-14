'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { SavedWord, Video } from '@/types';
import { storage } from '@/lib/storage';
import { LoroMascot } from '@/components/LoroMascot';
import {
  ChevronLeftIcon,
  ReplayIcon,
  TrashIcon,
} from '@/components/icons/Icons';
import videosData from '@/data/videos.json';

const videos = videosData as Video[];

/** Resolve the deep-link target (/?v=...&t=...) for a saved word. */
function replayHref(word: SavedWord): string {
  const video = videos.find((v) => v.id === word.videoId);
  const cueStart = video?.cues[word.cueIndex]?.start ?? 0;
  return `/?v=${encodeURIComponent(word.videoId)}&t=${cueStart}`;
}

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export default function VocabPage() {
  const [words, setWords] = useState<SavedWord[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setWords(storage.getSavedWords());
    setHydrated(true);
  }, []);

  const groups = useMemo(() => {
    const sorted = [...words].sort((a, b) => b.savedAt - a.savedAt);
    const map = new Map<string, SavedWord[]>();
    for (const word of sorted) {
      const label = dayLabel(word.savedAt);
      const list = map.get(label) ?? [];
      list.push(word);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [words]);

  const handleRemove = (word: SavedWord) => {
    setWords(storage.removeWord(word.text, word.videoId));
  };

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
            My words
          </h1>
          {words.length > 0 && (
            <span className="ml-auto rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">
              {words.length}
            </span>
          )}
        </div>
      </header>

      {hydrated && words.length === 0 && (
        <div className="flex flex-col items-center px-8 pt-24 text-center">
          <LoroMascot state="sleeping" size={120} />
          <h2 className="mt-6 text-lg font-semibold text-text">
            No words yet
          </h2>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
            Tap any Spanish word in the feed and Loro will keep it here for
            you.
          </p>
          <Link
            href="/"
            className="mt-8 rounded-2xl bg-accent px-6 py-3 text-base font-semibold text-background transition-transform active:scale-95"
          >
            Watch videos
          </Link>
        </div>
      )}

      <div className="px-4">
        {groups.map(([label, items]) => (
          <section key={label} className="mt-2 mb-6">
            <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              {label}
            </h2>
            <ul className="space-y-2">
              {items.map((word) => (
                <li
                  key={`${word.videoId}-${word.text}`}
                  className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold tracking-tight text-text">
                      {word.text}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-muted">
                      {word.translation}
                    </p>
                  </div>
                  {word.timesSeen > 1 && (
                    <span className="shrink-0 text-xs text-muted/70">
                      ×{word.timesSeen}
                    </span>
                  )}
                  <Link
                    href={replayHref(word)}
                    aria-label={`Replay ${word.text}`}
                    className="shrink-0 rounded-full bg-accent-soft p-2.5 text-accent transition-transform active:scale-90"
                  >
                    <ReplayIcon width={16} height={16} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleRemove(word)}
                    aria-label={`Remove ${word.text}`}
                    className="shrink-0 rounded-full p-2.5 text-muted/50 transition-colors hover:text-text"
                  >
                    <TrashIcon width={16} height={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
