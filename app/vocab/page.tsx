'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { SavedWord, Video, WordState } from '@/types';
import { storage } from '@/lib/storage';
import { formatDue, MAX_BOX } from '@/lib/srs';
import { nextDueAt } from '@/lib/progress';
import { LoroMascot } from '@/components/LoroMascot';
import {
  ChartIcon,
  ChevronLeftIcon,
  PlayIcon,
  ReplayIcon,
  SearchIcon,
  TrashIcon,
} from '@/components/icons/Icons';
import videosData from '@/data/videos.json';

const videos = videosData as unknown as Video[];

const wordKey = (w: SavedWord) => `${w.videoId}-${w.text}`;

/** Resolve the deep-link target (/?v=...&t=...) for a saved word. */
function replayHref(word: SavedWord): string {
  const video = videos.find((v) => v.id === word.videoId);
  const cueStart = video?.cues[word.cueIndex]?.start ?? 0;
  return `/?v=${encodeURIComponent(word.videoId)}&t=${cueStart}`;
}

/**
 * "Review now" target: the video with the most due words wins (most to recall
 * in one place), seeking to its earliest-due word. The feed arms the blanks
 * for every due word on that video once it's on screen.
 */
function reviewHref(due: SavedWord[]): string {
  const byVideo = new Map<string, SavedWord[]>();
  for (const w of due) {
    const list = byVideo.get(w.videoId);
    if (list) list.push(w);
    else byVideo.set(w.videoId, [w]);
  }
  let best: SavedWord[] = due;
  let bestScore = -1;
  for (const list of byVideo.values()) {
    const minDue = Math.min(...list.map((w) => w.dueAt));
    const score = list.length * 1e13 - minDue; // more words, then earliest
    if (score > bestScore) {
      bestScore = score;
      best = list;
    }
  }
  const earliest = best.reduce((a, b) => (a.dueAt <= b.dueAt ? a : b));
  return replayHref(earliest);
}

/** Problems first, then the pipeline, then the trophies. */
const STATE_ORDER: WordState[] = ['lapsed', 'new', 'learning', 'known'];

type StateMeta = {
  /** compact label for filter chips */
  chip: string;
  /** plain-language status a stranger understands */
  human: string;
  /** colour for the human status label + filled meter dots */
  tone: 'red' | 'muted' | 'accent';
};

const STATE_META: Record<WordState, StateMeta> = {
  lapsed: { chip: 'Lapsed', human: 'Slipped — review soon', tone: 'red' },
  new: { chip: 'New', human: 'Just saved', tone: 'muted' },
  learning: { chip: 'Learning', human: 'Getting it', tone: 'accent' },
  known: { chip: 'Learned', human: 'Learned ✓', tone: 'accent' },
};

const TONE_TEXT = {
  red: 'text-[#f87171]',
  muted: 'text-muted',
  accent: 'text-accent',
} as const;

const TONE_DOT = {
  red: 'bg-[#f87171]',
  muted: 'bg-muted',
  accent: 'bg-accent',
} as const;

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

/** Friendly forecast: "Ready now" / "Review in 10 min" / "Review in 2 days". */
function friendlyDue(word: SavedWord, now: number): string {
  if (word.dueAt <= now) return 'Ready now';
  return `Review ${formatDue(word.dueAt, now)}`;
}

/** Calm forecast for the caught-up card. */
function comeBackIn(dueAt: number, now: number): string {
  const diff = dueAt - now;
  const min = Math.round(diff / 60_000);
  if (min < 5) return 'Come back in a few minutes';
  if (min < 60) return `Come back in about ${min} minutes`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24)
    return `Come back in about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(diff / 86_400_000);
  return days <= 1 ? 'Come back tomorrow' : `Come back in about ${days} days`;
}

/** 5-dot Leitner meter, read as "progress toward Learned". */
function BoxMeter({ word }: { word: SavedWord }) {
  const onColor = TONE_DOT[STATE_META[word.state].tone];
  return (
    <span
      role="img"
      aria-label={`${word.box} of ${MAX_BOX} toward learned`}
      className="flex items-center gap-1"
    >
      {Array.from({ length: MAX_BOX }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i < word.box ? onColor : 'bg-white/12'
          }`}
        />
      ))}
    </span>
  );
}

/** The headline: what to do right now. */
function ReviewCard({ words, now }: { words: SavedWord[]; now: number }) {
  const due = useMemo(() => words.filter((w) => w.dueAt <= now), [words, now]);

  if (due.length > 0) {
    return (
      <div className="rounded-3xl bg-gradient-to-br from-accent/25 via-accent-soft to-surface p-5 ring-1 ring-accent/25">
        <p className="text-2xl font-bold tracking-tight text-text">
          {due.length} {due.length === 1 ? 'word' : 'words'} ready to review
        </p>
        <p className="mt-1 text-sm leading-relaxed text-text/70">
          Recall them in context — Loro shows them as blanks in the video.
        </p>
        <Link
          href={reviewHref(due)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-base font-bold text-background transition-transform active:scale-[0.98]"
        >
          <PlayIcon width={18} height={18} />
          Review now
        </Link>
      </div>
    );
  }

  const next = nextDueAt(words, now);
  return (
    <div className="flex items-center gap-4 rounded-3xl bg-surface p-5">
      <LoroMascot state="sleeping" size={64} />
      <div className="min-w-0">
        <p className="text-base font-semibold text-text">You&apos;re all caught up</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {next
            ? comeBackIn(next, now)
            : 'Save more words from the feed to keep going.'}
        </p>
      </div>
    </div>
  );
}

function WordCard({
  word,
  now,
  celebrating,
  onRemove,
}: {
  word: SavedWord;
  now: number;
  celebrating: boolean;
  onRemove: () => void;
}) {
  const meta = STATE_META[word.state];
  const isLapsed = word.state === 'lapsed';
  const isKnown = word.state === 'known';
  // Felt progress: known reads as complete; otherwise fill by Leitner box.
  const fillPct = isKnown ? 100 : (word.box / MAX_BOX) * 100;
  const edge = isLapsed ? 'bg-[#f87171]' : isKnown ? 'bg-accent' : 'bg-accent/40';
  const fill = isLapsed ? 'bg-[#f87171]' : meta.tone === 'muted' ? 'bg-muted/50' : 'bg-accent';

  return (
    <li
      className={`relative overflow-hidden rounded-2xl bg-surface ${
        isLapsed ? 'ring-1 ring-[#f87171]/40' : ''
      } ${celebrating ? 'animate-card-glow' : ''}`}
    >
      {/* left status edge — pulls the eye to lapsed words */}
      <span className={`absolute inset-y-0 left-0 w-1 ${edge}`} aria-hidden />

      {celebrating && (
        <LoroMascot
          state="happy"
          size={44}
          className="animate-loro-pop pointer-events-none absolute right-3 top-1.5 z-10"
        />
      )}

      <div className="py-3.5 pl-5 pr-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold tracking-tight text-text">
              {word.text}
            </p>
            <p className="mt-0.5 truncate text-sm text-muted">
              {word.translation}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href={replayHref(word)}
              aria-label={`Replay ${word.text} in its video`}
              className="flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-2 text-xs font-semibold text-accent transition-transform active:scale-90"
            >
              <ReplayIcon width={15} height={15} />
              Replay
            </Link>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${word.text}`}
              className="rounded-full p-2 text-muted/40 transition-colors hover:text-[#f87171]"
            >
              <TrashIcon width={15} height={15} />
            </button>
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-2.5">
          <span className={`text-xs font-semibold ${TONE_TEXT[meta.tone]}`}>
            {meta.human}
          </span>
          <BoxMeter word={word} />
          <span
            className={`ml-auto text-xs ${
              word.dueAt <= now ? 'font-semibold text-accent' : 'text-muted/70'
            }`}
          >
            {friendlyDue(word, now)}
          </span>
        </div>
      </div>

      {/* progress fill — grows toward Learned, felt not just read */}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5">
        <div
          className={`h-full ${fill} transition-[width] duration-500`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
    </li>
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
  // Recomputed on load and every minute so "Ready now" and forecasts stay honest.
  const [now, setNow] = useState(0);

  // One-time celebration when a word crosses into 'known' while we're watching.
  const prevStates = useRef<Map<string, WordState>>(new Map());
  const [celebrating, setCelebrating] = useState<Set<string>>(new Set());

  useEffect(() => {
    const refresh = () => setWords(storage.getSavedWords());
    refresh();
    setHydrated(true);
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    // stays fresh if words are saved in another tab or after bfcache restores
    const unsub = storage.onWordsChanged(refresh);
    return () => {
      clearInterval(tick);
      unsub();
    };
  }, []);

  // Detect words that just became 'known' (vs the previous snapshot) and glow.
  useEffect(() => {
    const nextMap = new Map<string, WordState>();
    const justLearned: string[] = [];
    for (const w of words) {
      const k = wordKey(w);
      const prev = prevStates.current.get(k);
      nextMap.set(k, w.state);
      if (w.state === 'known' && prev && prev !== 'known') justLearned.push(k);
    }
    const first = prevStates.current.size === 0;
    prevStates.current = nextMap;
    if (first || justLearned.length === 0) return; // never celebrate on first load
    setCelebrating((prev) => new Set([...prev, ...justLearned]));
    const t = setTimeout(() => {
      setCelebrating((prev) => {
        const n = new Set(prev);
        for (const k of justLearned) n.delete(k);
        return n;
      });
    }, 1800);
    return () => clearTimeout(t);
  }, [words]);

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

  const visibleWords = useMemo(() => {
    const list = stateFilter
      ? scopedWords.filter((w) => w.state === stateFilter)
      : scopedWords;
    return [...list].sort((a, b) => {
      const s = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
      return s !== 0 ? s : a.dueAt - b.dueAt;
    });
  }, [scopedWords, stateFilter]);

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
            {words.length > 0 && (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">
                {words.length}
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
      </header>

      {hydrated && words.length === 0 && (
        <div className="flex flex-col items-center px-8 pt-24 text-center">
          <LoroMascot state="sleeping" size={120} />
          <h2 className="mt-6 text-lg font-semibold text-text">No words yet</h2>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
            Tap any Spanish word in the feed and Loro will keep it here for you.
          </p>
          <Link
            href="/"
            className="mt-8 rounded-2xl bg-accent px-6 py-3 text-base font-semibold text-background transition-transform active:scale-95"
          >
            Watch videos
          </Link>
        </div>
      )}

      {hydrated && words.length > 0 && (
        <div className="space-y-4 px-4 pt-1">
          {/* 1 — lead with the action */}
          <ReviewCard words={words} now={now} />

          {/* 2 — keep: search + filters (restyled) */}
          <div className="space-y-2.5">
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
                  {STATE_META[state].chip} {stateCounts[state]}
                </Link>
              ))}
              {videoOptions.length > 0 && (
                <select
                  value={videoFilter ?? ''}
                  onChange={(e) =>
                    router.replace(filterHref(stateFilter, e.target.value || null))
                  }
                  aria-label="Filter by video"
                  className={`shrink-0 appearance-none rounded-full px-3 py-1.5 text-xs font-semibold outline-none transition-colors ${
                    videoFilter ? 'bg-accent text-background' : 'bg-surface text-muted'
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

          {/* 3 — legend: what the meter means */}
          {visibleWords.length > 0 && (
            <div className="flex items-center gap-2 px-1 text-xs text-muted/70">
              <span className="flex items-center gap-1" aria-hidden>
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/12" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/12" />
              </span>
              Progress toward Learned — a word locks in after 3 correct recalls.
            </div>
          )}

          {visibleWords.length === 0 && (
            <p className="pt-12 text-center text-sm text-muted">
              Nothing matches these filters.
            </p>
          )}

          {/* 4 — the words */}
          <ul className="space-y-2 pb-4">
            {visibleWords.map((word) => (
              <WordCard
                key={wordKey(word)}
                word={word}
                now={now}
                celebrating={celebrating.has(wordKey(word))}
                onRemove={() => handleRemove(word)}
              />
            ))}
          </ul>
        </div>
      )}
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
