'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { SavedWord, Video, WordState } from '@/types';
import { storage } from '@/lib/storage';
import { formatDue, MAX_BOX } from '@/lib/srs';
import { LoroMascot } from '@/components/LoroMascot';
import {
  ChartIcon,
  ChevronLeftIcon,
  ReplayIcon,
  SearchIcon,
  TrashIcon,
} from '@/components/icons/Icons';
import videosData from '@/data/videos.json';

const videos = videosData as unknown as Video[];

/** Resolve the deep-link target (/?v=...&t=...) for a saved word. */
function replayHref(word: SavedWord): string {
  const video = videos.find((v) => v.id === word.videoId);
  const cueStart = video?.cues[word.cueIndex]?.start ?? 0;
  return `/?v=${encodeURIComponent(word.videoId)}&t=${cueStart}`;
}

/** Display order: problems first, then the pipeline, then the trophies. */
const STATE_ORDER: WordState[] = ['lapsed', 'new', 'learning', 'known'];

const STATE_LABELS: Record<WordState, string> = {
  lapsed: 'Lapsed',
  new: 'New',
  learning: 'Learning',
  known: 'Known',
};

/** Accent-and-case-insensitive haystack for search ("cancion" finds "canción"). */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function filterHref(state: WordState | null, video: string | null): string {
  const params = new URLSearchParams();
  if (state) params.set('state', state);
  if (video) params.set('video', video);
  const qs = params.toString();
  return qs ? `/vocab?${qs}` : '/vocab';
}

/** Leitner progress at a glance: box 3 of 5 renders as ●●●○○. */
function BoxDots({ word }: { word: SavedWord }) {
  return (
    <span
      role="img"
      aria-label={`box ${word.box} of ${MAX_BOX}`}
      className="flex gap-1"
    >
      {Array.from({ length: MAX_BOX }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i < word.box
              ? word.state === 'known'
                ? 'bg-accent'
                : 'bg-muted'
              : 'bg-white/15'
          }`}
        />
      ))}
    </span>
  );
}

function VocabContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const videoFilter = searchParams.get('video');
  const stateParam = searchParams.get('state') as WordState | null;
  const stateFilter =
    stateParam && STATE_ORDER.includes(stateParam) ? stateParam : null;

  const [words, setWords] = useState<SavedWord[]>([]);
  const [query, setQuery] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const refresh = () => setWords(storage.getSavedWords());
    refresh();
    setHydrated(true);
    // stays fresh if words are saved in another tab or after bfcache restores
    return storage.onWordsChanged(refresh);
  }, []);

  // Video and search narrow the scope; the state chips count within it.
  const scopedWords = useMemo(() => {
    const needle = fold(query.trim());
    return words.filter(
      (w) =>
        (!videoFilter || w.videoId === videoFilter) &&
        (!needle ||
          fold(w.text).includes(needle) ||
          fold(w.translation).includes(needle))
    );
  }, [words, videoFilter, query]);

  const stateCounts = useMemo(() => {
    const counts = { lapsed: 0, new: 0, learning: 0, known: 0 };
    for (const w of scopedWords) counts[w.state]++;
    return counts;
  }, [scopedWords]);

  const visibleWords = useMemo(
    () =>
      stateFilter
        ? scopedWords.filter((w) => w.state === stateFilter)
        : scopedWords,
    [scopedWords, stateFilter]
  );

  const groups = useMemo(() => {
    return STATE_ORDER.flatMap((state) => {
      const items = visibleWords
        .filter((w) => w.state === state)
        .sort((a, b) => a.dueAt - b.dueAt);
      return items.length > 0
        ? [[STATE_LABELS[state], items] as [string, SavedWord[]]]
        : [];
    });
  }, [visibleWords]);

  // Only offer video filters that would show something.
  const videoOptions = useMemo(() => {
    const withWords = new Set(words.map((w) => w.videoId));
    return videos.filter((v) => withWords.has(v.id));
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
          <div className="ml-auto flex items-center gap-2">
            {visibleWords.length > 0 && (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">
                {visibleWords.length}
              </span>
            )}
            <Link
              href="/progress"
              aria-label="Progress"
              className="rounded-full bg-surface p-2 text-muted transition-colors hover:text-text"
            >
              <ChartIcon width={18} height={18} />
            </Link>
          </div>
        </div>

        {words.length > 0 && (
          <div className="space-y-2.5 px-4 pb-3">
            <div className="relative">
              <SearchIcon
                width={15}
                height={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted/70"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search words or translations"
                aria-label="Search saved words"
                className="w-full rounded-full bg-surface py-2.5 pl-10 pr-4 text-sm text-text outline-none placeholder:text-muted/60 focus:ring-1 focus:ring-accent/40"
              />
            </div>
            <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
              <Link
                href={filterHref(null, videoFilter)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  stateFilter === null
                    ? 'bg-accent text-background'
                    : 'bg-surface text-muted hover:text-text'
                }`}
              >
                All {scopedWords.length}
              </Link>
              {STATE_ORDER.map((state) => (
                <Link
                  key={state}
                  href={filterHref(state, videoFilter)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    stateFilter === state
                      ? 'bg-accent text-background'
                      : 'bg-surface text-muted hover:text-text'
                  }`}
                >
                  {STATE_LABELS[state]} {stateCounts[state]}
                </Link>
              ))}
              {videoOptions.length > 0 && (
                <select
                  value={videoFilter ?? ''}
                  onChange={(e) =>
                    router.replace(
                      filterHref(stateFilter, e.target.value || null)
                    )
                  }
                  aria-label="Filter by video"
                  className={`shrink-0 appearance-none rounded-full px-3 py-1.5 text-xs font-semibold outline-none transition-colors ${
                    videoFilter
                      ? 'bg-accent text-background'
                      : 'bg-surface text-muted'
                  }`}
                >
                  <option value="">All videos</option>
                  {videoOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.creator} · {v.level} · {v.id}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
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

      {hydrated && words.length > 0 && visibleWords.length === 0 && (
        <p className="px-5 pt-16 text-center text-sm text-muted">
          Nothing matches these filters.
        </p>
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
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={`text-xs ${
                        word.dueAt <= Date.now()
                          ? 'font-semibold text-accent'
                          : 'text-muted/70'
                      }`}
                    >
                      {formatDue(word.dueAt)}
                    </span>
                    <BoxDots word={word} />
                  </div>
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

export default function VocabPage() {
  return (
    <Suspense fallback={<main className="min-h-[100dvh] bg-background" />}>
      <VocabContent />
    </Suspense>
  );
}
