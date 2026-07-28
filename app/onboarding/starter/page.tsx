'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StarterWord } from '@/lib/starterDeck';
import {
  STARTER_DECK,
  STARTER_STAGGER_MS,
  STARTER_VIDEO_ID,
  starterIndexOf,
  starterTranslation,
} from '@/lib/starterDeck';
import { foldDuplicateWords } from '@/lib/wordMerge';
import { normalizeAnswer } from '@/lib/srs';
import { storage } from '@/lib/storage';
import { LoroMascot } from '@/components/LoroMascot';

/**
 * /onboarding/starter — the beginner starter deck. One card at a time; the
 * user sorts each word into "I know it" (SRS box 3, the calm mastery
 * schedule) or "Don't know yet" (box 1, back within minutes as feed blanks).
 *
 * Every answer goes through storage.saveWordAtBox — the same engine as all
 * other saves — which is also the resume mechanism: the queue is the deck
 * minus already-saved words, so a drop-out picks up exactly where they left
 * off (and, signed in, on any device) with no extra progress key. Identity
 * is normalizeAnswer(text) across ALL videoIds: a word met in a real video
 * never reappears here.
 *
 * Never a gate: Skip is always one tap, and leaving marks the user
 * onboarded — the zero path skips /welcome's guided intro, so this screen
 * must set the flag or the feed would bounce them back to onboarding.
 */

const DECK_SIZE = STARTER_DECK.length;

export default function StarterDeckPage() {
  const router = useRouter();
  const [language] = useState(() => storage.getLanguage());

  // null until hydrated — the queue reads localStorage, so it cannot be
  // computed during SSR/first paint. Computed ONCE: answered cards advance
  // `pos` rather than shrinking the queue, keeping the "12 / 74" denominator
  // stable for the whole run.
  const [queue, setQueue] = useState<StarterWord[] | null>(null);
  const [pos, setPos] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    // Fold first: remote fetches can hold duplicate rows per (text, videoId)
    // — one deterministic word each, then one normalized-text identity set.
    const saved = new Set(
      foldDuplicateWords(storage.getSavedWords()).map((w) =>
        normalizeAnswer(w.text)
      )
    );
    setQueue(STARTER_DECK.filter((e) => !saved.has(e.id)));
  }, []);

  const leave = useCallback(() => {
    storage.setStarterDone();
    // The zero path never runs /welcome's finish() — set the flag here or
    // the feed redirects straight back into onboarding.
    storage.setOnboarded();
    if (!storage.getStartLevel()) storage.setStartLevel('A1');
    router.replace('/feed');
  }, [router]);

  const answer = useCallback(
    (knewIt: boolean) => {
      if (!queue || pos >= queue.length) return;
      const entry = queue[pos];
      // Rank in the FULL deck, not this run's queue: stagger and cueIndex
      // must be stable across sessions (a two-session run reviews in the
      // same frequency order as a one-session run).
      const rank = starterIndexOf(entry.word);
      const { ok } = storage.saveWordAtBox(
        {
          text: entry.word,
          translation: starterTranslation(entry, language),
          videoId: STARTER_VIDEO_ID,
          cueIndex: rank,
        },
        knewIt ? 3 : 1,
        rank * STARTER_STAGGER_MS
      );
      // Don't advance past a failed save — a card left behind silently would
      // never come back (the queue only shows unsaved words).
      setSaveFailed(!ok);
      if (ok) setPos((p) => p + 1);
    },
    [queue, pos, language]
  );

  if (queue === null) {
    return <main className="min-h-[100dvh] bg-background" aria-hidden />;
  }

  const done = pos >= queue.length;
  const card = done ? null : queue[pos];

  return (
    <main className="relative flex min-h-[100dvh] flex-col bg-background px-6 pt-safe pb-safe">
      <header className="py-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold tabular-nums text-muted">
            {done ? queue.length : pos + 1} / {queue.length}
          </p>
          <button
            type="button"
            onClick={leave}
            className="rounded-full bg-black/40 px-3.5 py-2 text-xs font-medium text-muted backdrop-blur-md transition-colors hover:text-text"
          >
            Skip
          </button>
        </div>
        {/* Same bar treatment as the profile level meter. Fill = answered
            cards, so it starts empty and lands full exactly at the done
            screen. */}
        <div
          className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={queue.length}
          aria-valuenow={done ? queue.length : pos}
          aria-label="Starter deck progress"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{
              width: `${queue.length === 0 ? 100 : Math.min(100, (pos / queue.length) * 100)}%`,
            }}
          />
        </div>
      </header>

      {done ? (
        <div className="animate-fade-in mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
          <LoroMascot state="happy" size={120} />
          {/* Reaching here means every deck word is saved — answered now or
              met before — so the copy can claim the full count honestly. */}
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-text">
            That’s your base.
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
            The {DECK_SIZE} most common Spanish words are in your pocket. Loro
            brings back the ones you don’t know yet — right before you forget
            them.
          </p>
          <button
            type="button"
            onClick={leave}
            className="mt-9 rounded-2xl bg-accent px-10 py-4 text-lg font-bold text-background transition-transform active:scale-95"
          >
            ¡Vamos!
          </button>
        </div>
      ) : (
        card && (
          <>
            <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
              {/* key remounts the card per word so the fade replays. */}
              <div key={card.id} className="animate-fade-in w-full">
                <p className="text-5xl font-bold tracking-tight text-text">
                  {card.word}
                </p>
                <p className="mt-3 text-xl text-muted">
                  {starterTranslation(card, language)}
                </p>
                <p className="mt-8 rounded-2xl bg-surface px-5 py-4 text-base italic leading-relaxed text-text/80">
                  {card.exampleSentence}
                </p>
              </div>
            </div>

            <div className="mx-auto w-full max-w-md pb-6">
              {saveFailed && (
                <p className="mb-3 text-center text-xs text-red-400" role="alert">
                  Couldn’t save that word — your browser storage may be full.
                </p>
              )}
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => answer(false)}
                  className="flex-1 rounded-2xl bg-surface py-4 text-lg font-bold text-text transition-transform hover:bg-surface-raised active:scale-[0.98]"
                >
                  Don’t know yet
                </button>
                <button
                  type="button"
                  onClick={() => answer(true)}
                  className="flex-1 rounded-2xl bg-accent py-4 text-lg font-bold text-background transition-transform active:scale-[0.98]"
                >
                  I know it
                </button>
              </div>
            </div>
          </>
        )
      )}
    </main>
  );
}
