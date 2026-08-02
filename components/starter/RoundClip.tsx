'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSurface } from '@loro/core/dictionary';
import { PLAYBACK_STALL_MS, usePlayer } from '@/lib/playerContext';
import { targetOccurrences, type StarterRound } from '@loro/core/starter/rounds';

/**
 * The payoff half of a starter-deck round: the round's clip plays on the
 * SHARED player, and the words the user just sorted light up as they are
 * spoken.
 *
 * PLAYER OWNERSHIP. This component does not create, mount or configure a
 * player — it drives the app-level instance through usePlayer() (see the
 * consumer contract in lib/playerContext.tsx). The video pixels live in the
 * slot below, which is left deliberately EMPTY: the shared player positions
 * itself there.
 *
 * NOTHING IS EVER DRAWN OVER THE PLAYER SLOT. That is an embed-terms
 * requirement, not a style choice, and it is why this is a flex column —
 * spacer, player slot, then the word band in normal flow — mirroring the feed's
 * embed layout. Never give the band a hardcoded height and never let it overlap
 * the slot.
 *
 * SURVIVING A PLAYER THAT NEVER PLAYS. The clock may never advance (the
 * placeholder returns 0 forever; a real player can be blocked or offline). So
 * progress is never conditional on playback: a stall is detected and reported
 * up, and the deck offers a tap to move on. A clip that did not play is
 * reported as such, so the funnel does not count it as watched.
 */

/**
 * No clock movement for this long after loadAndPlay = the clip is not coming.
 *
 * Shared with the feed's fallback play button rather than picked separately:
 * both are answering "is this clip ever going to start?", and two numbers would
 * mean one surface offering a way out while the other was still waiting.
 */
const START_STALL_MS = PLAYBACK_STALL_MS;
/** The clock moved, then froze this long — buffering, or playback was killed. */
const MID_STALL_MS = 9_000;
/** Treat the round as finished a hair early: the planner's word timings and the
    player's clock never agree to the frame. */
const END_EPSILON_S = 0.12;

export type RoundClipProps = {
  round: StarterRound;
  language: string;
  /** A target word's audible span has been passed — it has now been HEARD.
      Called once per word, with its normalizeAnswer identity. */
  onHeard: (wordId: string) => void;
  /** The clip has said everything it teaches (or the player reported ended). */
  onEnded: () => void;
  /** Playback is not happening. The deck surfaces a way forward. */
  onStalled: () => void;
};

export function RoundClip({
  round,
  language,
  onHeard,
  onEnded,
  onStalled,
}: RoundClipProps) {
  const player = usePlayer();
  const [cueIndex, setCueIndex] = useState(-1);
  const [wordIndex, setWordIndex] = useState(-1);
  const [heard, setHeard] = useState<ReadonlySet<string>>(new Set());

  /**
   * Highlight lookup, keyed ACCENT-EXACTLY (normalizeSurface), like the
   * planner's own matching. Keying on the accent-folded identity instead would
   * light up the article "el" in a clip whose target is "él" — a word the user
   * was never taught, popping at the exact moment the design is making its
   * one promise.
   */
  const targetsBySurface = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of round.targets) {
      map.set(normalizeSurface(target.entry.word), target.entry.id);
    }
    return map;
  }, [round]);

  /** deck identity -> where the word is spoken, for the heard bookkeeping. */
  const occurrences = useMemo(() => targetOccurrences(round), [round]);

  // Callbacks the rAF loop reads, so a parent re-render never restarts it.
  const onHeardRef = useRef(onHeard);
  const onEndedRef = useRef(onEnded);
  const onStalledRef = useRef(onStalled);
  useEffect(() => {
    onHeardRef.current = onHeard;
    onEndedRef.current = onEnded;
    onStalledRef.current = onStalled;
  }, [onHeard, onEnded, onStalled]);

  // Start the clip. One effect per round: swapping the video on the shared
  // instance IS the round transition.
  useEffect(() => {
    let cancelled = false;
    void player.loadAndPlay(round.video.youtubeId!).catch(() => {
      // A rejected load is a stall, not a crash: the deck still has to let the
      // user reach the next round.
      if (!cancelled) onStalledRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [player, round]);

  // Advisory state notifications: re-read the clock rather than trusting the
  // argument, which a provider may not send at all.
  useEffect(() => {
    return player.subscribe((state) => {
      if (state === 'ended') onEndedRef.current();
    });
  }, [player]);

  useEffect(() => {
    const cues = round.cues;
    // The ROUND's end, not the clip's: PAYOFF_TAIL_S after the last target word
    // finishes (lib/starterRounds.ts payoffEnd). Every card has lit up as it was
    // spoken by then, which is the whole promise — watching the rest of the
    // video is not part of it, and on the real catalog waiting for the
    // transcript to finish cost 34s across the three rounds.
    const endAt = round.payoffEnd - END_EPSILON_S;
    let raf = 0;
    let settled = false;
    let stalledReported = false;
    let lastTime = -1;
    let lastProgressAt = performance.now();
    const startedAt = performance.now();
    const heardIds = new Set<string>();

    const tick = () => {
      const t = player.getCurrentTime();

      // --- stall watchdog ------------------------------------------------
      if (t > lastTime + 0.01) {
        lastTime = t;
        lastProgressAt = performance.now();
      } else if (!settled && !stalledReported) {
        const idleFor = performance.now() - lastProgressAt;
        const neverStarted = t <= 0.05;
        const limit = neverStarted ? START_STALL_MS : MID_STALL_MS;
        if (performance.now() - startedAt > limit && idleFor > limit) {
          stalledReported = true;
          onStalledRef.current();
        }
      }

      // --- karaoke position ----------------------------------------------
      const ci = cues.findIndex((c) => t >= c.start && t <= c.end);
      setCueIndex(ci);
      setWordIndex(
        ci >= 0 ? cues[ci].words.findIndex((w) => t >= w.start && t < w.end) : -1
      );

      // --- heard bookkeeping: a target is heard once the playhead is past
      //     its audible span, which is what makes the after-clip beat honest.
      for (const [wordId, span] of occurrences) {
        if (heardIds.has(wordId)) continue;
        if (t >= span.end) {
          heardIds.add(wordId);
          setHeard(new Set(heardIds));
          onHeardRef.current(wordId);
        }
      }

      if (!settled && endAt > 0 && t >= endAt) {
        settled = true;
        onEndedRef.current();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player, round, occurrences]);

  const cue = cueIndex >= 0 ? round.cues[cueIndex] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Reserve the top chrome's real height, like the feed's embed slide:
          safe-area inset plus the skip row. */}
      <div
        className="flex-none"
        style={{ height: 'calc(env(safe-area-inset-top, 0px) + 3.25rem)' }}
      />

      {/* THE PLAYER SLOT. Intentionally empty — the shared app-level player
          positions itself over this box, and nothing of ours may ever be placed
          inside or on top of it. min-h-0 lets the row shrink; the band below
          takes what it needs.

          The slot is positioned ABSOLUTELY inside that row rather than sized
          with h-full, because the deck page's container is min-h-[100dvh] — a
          minimum, not a height. Percentage heights resolve against a definite
          parent height, so `h-full` here resolved to auto, and an empty box
          with an aspect ratio and auto height is 0x0: the clip played with the
          player scaled to nothing. inset-y-0 gives the definite height the
          aspect ratio needs. The row still occupies its flex space in normal
          flow, so the band below cannot overlap the player. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          data-loro-player-slot
          className="absolute inset-y-0 left-1/2 max-w-full -translate-x-1/2 overflow-hidden rounded-xl bg-black"
          style={{ aspectRatio: '9 / 16' }}
        />
      </div>

      {/* The band: word highlighting below the player, never over it. */}
      <div className="flex-none px-4 pb-4">
        <div className="min-h-[9.5rem] flex flex-col justify-end">
          {cue ? (
            <>
              <p className="flex flex-wrap items-center gap-y-1 text-[1.75rem] font-bold leading-[1.3] tracking-tight text-text">
                {cue.words.map((word, i) => {
                  const targetId = targetsBySurface.get(
                    normalizeSurface(word.text)
                  );
                  const speaking = i === wordIndex;
                  if (targetId) {
                    // The distinct treatment: a target is always visibly
                    // marked so the user sees it coming, and POPS when spoken
                    // — scaled up, filled, ringed. This is the moment the
                    // whole deck exists to deliver, so it must not be
                    // mistakable for the ordinary karaoke highlight.
                    return (
                      <span
                        key={i}
                        className={`relative inline-flex items-center rounded-xl px-2 py-1 transition-all duration-150 ${
                          speaking
                            ? 'scale-[1.18] bg-accent text-background shadow-[0_0_0_4px_var(--color-accent-soft),0_8px_24px_rgba(0,0,0,0.45)]'
                            : heard.has(targetId)
                              ? 'bg-accent-soft text-accent'
                              : 'bg-accent-soft text-accent ring-1 ring-inset ring-accent/40'
                        }`}
                      >
                        {word.text}
                      </span>
                    );
                  }
                  return (
                    <span
                      key={i}
                      className={`rounded-xl px-2 py-1 transition-colors duration-100 ${
                        speaking ? 'bg-white/12 text-text' : 'text-text/70'
                      }`}
                    >
                      {word.text}
                    </span>
                  );
                })}
              </p>
              <p className="mt-2 px-2 text-[1.0625rem] leading-relaxed text-text/60">
                {cue.translations[language] ?? cue.translations.en}
              </p>
            </>
          ) : (
            // Between cues (and before playback) the band keeps its height, so
            // the player above never resizes mid-clip.
            <p className="px-2 text-[1.0625rem] text-muted">Escucha…</p>
          )}
        </div>
      </div>
    </div>
  );
}
