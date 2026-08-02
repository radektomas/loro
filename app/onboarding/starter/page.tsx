'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StarterEvent, StarterEventName } from '@loro/core/starterEvents';
import { STARTER_STAGGER_MS, starterTranslation } from '@loro/core/starter/deck';
import {
  describeStarterPlan,
  planStarterDeck,
  targetOccurrences,
  STARTER_ROUNDS,
  type StarterRound,
} from '@loro/core/starter/rounds';
import { foldDuplicateWords } from '@loro/core/wordMerge';
import { normalizeAnswer } from '@loro/core/srs';
import { storage } from '@/lib/storage';
import { usePlayer } from '@/lib/playerContext';
import { LoroMascot } from '@/components/LoroMascot';
import { RoundClip } from '@/components/starter/RoundClip';
import { WordCard } from '@/components/starter/WordCard';
import { CheckIcon } from '@/components/icons/Icons';

/**
 * /onboarding/starter — the beginner starter deck, as short interleaved rounds.
 *
 * THE SHAPE. Three rounds. Each round is up to three word cards followed
 * immediately by a real clip in which those exact words are spoken and
 * highlighted, then a one-beat confirmation of what was just heard, then
 * straight into the next round. No interstitials, no continue buttons between
 * rounds, and no completion screen at the end — the feed is the reward.
 *
 * This replaced a linear 87-card word list. The list taught the same words but
 * nothing ever spoke them, so the payoff was theoretical and the counter
 * ("12 / 74") read as a countdown to the end of a chore. Everything below is
 * organised around the opposite framing: progress is always stated as distance
 * to the next clip.
 *
 * WHY THE ROUNDS ARE RESOLVED UP FRONT. planStarterRounds picks all three clips
 * and all their words before the first card renders (lib/starterRounds.ts). A
 * mid-run resolve could fail to find a clip and strand the user between rounds;
 * resolving once also makes the run deterministic, so a re-entry from /profile
 * behaves like an uninterrupted one.
 *
 * PLAYER. The deck never creates a player. It drives the app-level shared
 * instance through usePlayer() (lib/playerContext.tsx) and captures the iOS
 * blessing on the FIRST card tap — a real user gesture, well before the first
 * clip needs to start. The same gesture restores sound and persists that choice,
 * so the feed does not have to ask again with its tap-for-sound pill.
 *
 * ANONYMOUS THROUGHOUT. Every word goes through storage.saveWordAtBox (the same
 * SRS engine as every other save) and every event through storage.logStarterEvent;
 * both are localStorage-first and sync on sign-in. No account, ever.
 *
 * NEVER A GATE. Skip is on screen from the first card and drops the user into
 * the feed with whatever has already been seeded.
 */

/** How long the after-clip beat holds before the next round starts. */
const BEAT_MS = 1_900;

type Phase = 'card' | 'clip' | 'beat';

export default function StarterDeckPage() {
  const router = useRouter();
  const player = usePlayer();
  const [language] = useState(() => storage.getLanguage());

  // null until the plan resolves (it reads localStorage and dynamically imports
  // the catalog, so it cannot be computed during SSR/first paint).
  const [plan, setPlan] = useState<StarterRound[] | null>(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [cardIndex, setCardIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('card');
  const [heardIds, setHeardIds] = useState<ReadonlySet<string>>(new Set());
  const [clipStalled, setClipStalled] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const round = plan && roundIndex < plan.length ? plan[roundIndex] : null;

  // ------------------------------------------------------ instrumentation

  const logEvent = useCallback(
    (
      name: StarterEventName,
      extra?: Partial<
        Pick<StarterEvent, 'card' | 'videoId' | 'word' | 'knewIt' | 'played'>
      >
    ) => {
      storage.logStarterEvent({
        name,
        // 1-based rounds read straight in a funnel query. Round 0 means "no
        // round was ever reached" — an empty plan, or a skip before resolve.
        round: plan && plan.length > 0 ? roundIndex + 1 : 0,
        card: extra?.card ?? null,
        at: Date.now(),
        // The round's card count travels with every event, so a two-card round
        // (forced by a thin clip) is never read as a card-3 drop-off.
        ...(round ? { cards: round.targets.length } : {}),
        ...(extra?.videoId ? { videoId: extra.videoId } : {}),
        ...(extra?.word ? { word: extra.word } : {}),
        ...(extra?.knewIt !== undefined ? { knewIt: extra.knewIt } : {}),
        ...(extra?.played !== undefined ? { played: extra.played } : {}),
      });
    },
    [plan, roundIndex, round]
  );

  // ---------------------------------------------------------- plan resolve

  useEffect(() => {
    let cancelled = false;
    // Dynamic import: the catalog carries every embed transcript (~5.4MB of
    // JSON) and this is an ONBOARDING route. Statically importing it would put
    // the whole catalog in the first bundle a brand-new user downloads — the
    // same reason /welcome imports staticVideos directly instead of localVideos.
    void import('@loro/core/catalog/localVideos').then(({ localVideos }) => {
      if (cancelled) return;
      // Fold first: remote fetches can hold duplicate rows per (text, videoId).
      // Identity is normalizeAnswer(text) across ALL videoIds, so a word met in
      // a real video is never taught here again.
      const saved = new Set(
        foldDuplicateWords(storage.getSavedWords()).map((w) =>
          normalizeAnswer(w.text)
        )
      );
      // Words tapped as known during calibration count as had, too — they were
      // an explicit "I know this" and re-teaching them would read as amnesia.
      for (const text of storage.getCalibrationKnown()) {
        saved.add(normalizeAnswer(text));
      }
      const result = planStarterDeck({
        videos: localVideos,
        savedIds: saved,
        seenIds: new Set(storage.getWatchedVideoIds()),
      });
      // Which rounds the curated allowlist filled, which fell back to the
      // ranking, and why any curated entry was passed over. Development only:
      // the deck's three clips are a hand-tuned editorial choice, and a curated
      // pick that silently loses to a constraint would otherwise be invisible —
      // the deck still plays, just not the clips someone chose. NODE_ENV is
      // inlined at build time, so this whole block is dropped from production.
      if (process.env.NODE_ENV !== 'production') {
        console.info(
          ['[loro] starter deck plan', ...describeStarterPlan(result)].join('\n')
        );
      }
      setPlan(result.rounds);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------- exits

  /** Leave for the feed, keeping whatever has been seeded. */
  const leave = useCallback(() => {
    storage.setStarterDone();
    // The zero path never runs /welcome's finish(), so the flag has to be set
    // here or the feed bounces straight back into onboarding.
    storage.setOnboarded();
    if (!storage.getStartLevel()) storage.setStartLevel('A1');
    router.replace('/feed');
  }, [router]);

  const skip = useCallback(() => {
    logEvent('skipped', { card: phase === 'card' ? cardIndex + 1 : null });
    leave();
  }, [logEvent, leave, phase, cardIndex]);

  // Nothing left to teach (every deck word already known, or no clip in the
  // catalog can back a round): go straight to the feed rather than show an
  // empty deck. Not logged as a skip — there was no deck to skip.
  useEffect(() => {
    if (plan && plan.length === 0) leave();
  }, [plan, leave]);

  // --------------------------------------------------------- card handling

  const targets = round?.targets ?? [];
  const target = phase === 'card' ? targets[cardIndex] : undefined;

  // Card shown. Deliberately an effect rather than part of the advance
  // handlers: this must fire for the first card of the run too, which no
  // handler precedes.
  useEffect(() => {
    if (!round || phase !== 'card') return;
    const shown = round.targets[cardIndex];
    if (!shown) return;
    logEvent('card_shown', {
      // 1-BASED card index: "card 1 of 3" reads directly in a funnel query,
      // and a 0 can then only mean "not on a card".
      card: cardIndex + 1,
      word: shown.entry.word,
      videoId: round.video.id,
    });
    // logEvent changes identity with the round, which is exactly when a re-log
    // would be legitimate; consecutive duplicates are dropped in starterEvents.
  }, [round, phase, cardIndex, logEvent]);

  /** Cue the word is spoken in — the SavedWord.cueIndex, so /vocab's replay
      lands on the line where the user heard it. */
  const occurrences = useMemo(
    () => (round ? targetOccurrences(round) : new Map()),
    [round]
  );

  const blessed = useRef(false);

  const answer = useCallback(
    (knewIt: boolean) => {
      if (!round || !target) return;

      // FIRST TAP OF THE RUN, inside the gesture, before anything async: this
      // is the only moment iOS will hand over playback and audio for the page
      // load. By the time the first clip starts, the shared instance is
      // already blessed and unmuted.
      if (!blessed.current) {
        blessed.current = true;
        player.bless();
        player.unmute();
        storage.setSessionUnmuted(true);
      }

      const { ok } = storage.saveWordAtBox(
        {
          text: target.entry.word,
          translation: starterTranslation(target.entry, language),
          // A REAL video id, not the 'starter' pseudo id: the word was heard in
          // this clip, so /vocab can replay it and the feed can review it there
          // like any other save. (The calibration escape hatch still uses the
          // pseudo id — it has no clip behind it.)
          videoId: round.video.id,
          cueIndex: occurrences.get(target.entry.id)?.cueIndex ?? 0,
        },
        // Known words seed into the calm mastery schedule, unknown ones into
        // box 1 so they come back within minutes as feed blanks. Same engine
        // and the same rank-keyed stagger the linear deck used.
        knewIt ? 3 : 1,
        target.deckIndex * STARTER_STAGGER_MS,
        // A grant: we chose this word and handed it over. Deck words are
        // normal in every other respect (SRS, /vocab, review, delete) but are
        // invisible to the account prompt and the free-tier ceiling — see
        // WordSource in types/index.ts.
        'deck'
      );

      // Don't advance past a failed save — the word would be silently lost.
      setSaveFailed(!ok);
      if (!ok) return;

      logEvent('card_answered', {
        card: cardIndex + 1,
        word: target.entry.word,
        knewIt,
        videoId: round.video.id,
      });

      if (cardIndex + 1 < targets.length) {
        setCardIndex(cardIndex + 1);
        return;
      }
      // Third card answered: straight into the clip, no tap in between.
      setHeardIds(new Set());
      setClipStalled(false);
      setPhase('clip');
      logEvent('clip_started', { videoId: round.video.id });
    },
    [
      round,
      target,
      targets.length,
      cardIndex,
      language,
      occurrences,
      player,
      logEvent,
    ]
  );

  // --------------------------------------------------------- clip handling

  const handleHeard = useCallback((wordId: string) => {
    setHeardIds((prev) => {
      if (prev.has(wordId)) return prev;
      const next = new Set(prev);
      next.add(wordId);
      return next;
    });
  }, []);

  /** The clip is done — either it played out, or the user tapped past one that
      never played. `played` keeps the funnel honest about which. */
  const finishClip = useCallback(
    (played: boolean) => {
      if (phase !== 'clip') return;
      logEvent('clip_completed', { videoId: round?.video.id, played });
      setPhase('beat');
    },
    [phase, logEvent, round]
  );

  const handleEnded = useCallback(() => finishClip(true), [finishClip]);
  const handleStalled = useCallback(() => setClipStalled(true), []);

  // The beat holds briefly, then the next round starts on its own.
  useEffect(() => {
    if (phase !== 'beat' || !plan) return;
    const timer = setTimeout(() => {
      logEvent('round_completed', { videoId: round?.video.id });
      if (roundIndex + 1 < plan.length) {
        setRoundIndex(roundIndex + 1);
        setCardIndex(0);
        setPhase('card');
      } else {
        // Round 3 done: into the feed with 7-9 words seeded. No completion
        // screen — the feed itself is the payoff.
        leave();
      }
    }, BEAT_MS);
    return () => clearTimeout(timer);
  }, [phase, plan, roundIndex, round, logEvent, leave]);

  // ---------------------------------------------------------------- render

  if (plan === null || plan.length === 0) {
    return <main className="min-h-[100dvh] bg-background" aria-hidden />;
  }
  if (!round) return <main className="min-h-[100dvh] bg-background" aria-hidden />;

  const totalRounds = Math.min(plan.length, STARTER_ROUNDS);

  return (
    <main className="relative flex min-h-[100dvh] flex-col bg-background pt-safe pb-safe">
      {/* Persistent chrome: round position and Skip, from the very first card.
          Never a total word count — see the framing note at the top. */}
      <header className="flex flex-none items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          {Array.from({ length: totalRounds }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i < roundIndex
                  ? 'w-6 bg-accent/60'
                  : i === roundIndex
                    ? 'w-9 bg-accent'
                    : 'w-6 bg-white/10'
              }`}
            />
          ))}
          <span className="ml-1.5 text-xs font-semibold tabular-nums text-muted">
            {roundIndex + 1} of {totalRounds}
          </span>
        </div>
        <button
          type="button"
          onClick={skip}
          className="rounded-full bg-black/40 px-3.5 py-2 text-xs font-medium text-muted backdrop-blur-md transition-colors hover:text-text"
        >
          Skip
        </button>
      </header>

      {phase === 'card' && target && (
        <div className="flex flex-1 flex-col px-6">
          <WordCard
            word={target.entry.word}
            translation={starterTranslation(target.entry, language)}
            remainingAfter={targets.length - 1 - cardIndex}
            saveFailed={saveFailed}
            onAnswer={answer}
          />
        </div>
      )}

      {phase === 'clip' && (
        <>
          <RoundClip
            round={round}
            language={language}
            onHeard={handleHeard}
            onEnded={handleEnded}
            onStalled={handleStalled}
          />
          {/* The tap-to-advance escape hatch. Only appears when playback is not
              happening (blocked, offline, or the shared player is not wired up
              yet) — the deck must never be able to trap a user behind a clip
              that will not play. */}
          {clipStalled && (
            <div className="animate-fade-in flex-none px-6 pb-6">
              <button
                type="button"
                onClick={() => finishClip(false)}
                className="w-full rounded-2xl bg-surface py-4 text-base font-bold text-text transition-transform active:scale-[0.98]"
              >
                Continue
              </button>
            </div>
          )}
        </>
      )}

      {phase === 'beat' && (
        <div className="animate-fade-in mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 text-center">
          <LoroMascot state={heardIds.size > 0 ? 'happy' : 'idle'} size={92} />
          <p className="mt-5 text-sm font-medium text-muted">
            {heardIds.size > 0
              ? 'You just heard these:'
              : 'Words from this round:'}
          </p>
          <ul className="mt-4 flex w-full flex-col gap-2">
            {round.targets.map((t) => {
              const wasHeard = heardIds.has(t.entry.id);
              return (
                <li
                  key={t.entry.id}
                  className={`flex items-center justify-between rounded-2xl px-4 py-3 text-left ${
                    wasHeard ? 'bg-accent-soft' : 'bg-surface'
                  }`}
                >
                  <span className="flex flex-col">
                    <span
                      className={`text-lg font-bold ${
                        wasHeard ? 'text-accent' : 'text-text'
                      }`}
                    >
                      {t.entry.word}
                    </span>
                    <span className="text-xs text-muted">
                      {starterTranslation(t.entry, language)}
                    </span>
                  </span>
                  {wasHeard && (
                    <CheckIcon width={16} height={16} className="text-accent" />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </main>
  );
}
