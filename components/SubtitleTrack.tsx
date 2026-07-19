'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Cue, SavedWord, Word } from '@/types';
import { normalizeAnswer } from '@/lib/srs';
import { tierFor, type LevelBlankWord } from '@/lib/levels';
import {
  CaretDownIcon,
  ChartIcon,
  CheckIcon,
  CloseIcon,
} from '@/components/icons/Icons';
import { LoroMascot } from '@/components/LoroMascot';

/** Feather burst offsets for the correct-recall celebration (CSS vars). */
const PARTICLES = [
  { dx: -34, dy: -30, rot: -120 },
  { dx: 26, dy: -38, rot: 90 },
  { dx: -18, dy: -44, rot: -60 },
  { dx: 40, dy: -18, rot: 140 },
  { dx: -42, dy: -6, rot: -160 },
  { dx: 16, dy: -50, rot: 45 },
  { dx: 44, dy: -34, rot: 180 },
];

type BlankResult = 'correct' | 'wrong';

/**
 * One planned blank, from either source. Both kinds share the exact same
 * pause-at-word-end + typed-input interaction; only the accent/label and the
 * grade callback differ, so the user always knows WHY a word popped up:
 * green dashed = your own saved word (SRS recall), blue solid = level practice.
 */
type BlankEntry =
  | { kind: 'recall'; word: SavedWord }
  | { kind: 'level'; word: LevelBlankWord };

type SubtitleTrackProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  cues: Cue[];
  language: string;
  /** Only run the rAF loop while the slide is on screen. */
  active: boolean;
  onWordTap: (word: Word, cue: Cue, cueIndex: number) => void;
  /** cueIndex -> due word to render as a fill-in-the-blank. */
  blanks?: ReadonlyMap<number, SavedWord>;
  /** cueIndex -> level-practice word to render as a fill-in-the-blank. On a
      cue collision the SRS blank wins (the feed plans them disjoint anyway). */
  levelBlanks?: ReadonlyMap<number, LevelBlankWord>;
  /** Fired when a due blank pauses the video — at the blanked word's END. */
  onBlankActive?: () => void;
  /** Fired when the user submits or skips an SRS recall blank. */
  onBlankGrade?: (word: SavedWord, wasCorrect: boolean) => void;
  /** Fired when the user submits or skips a LEVEL blank. */
  onLevelBlankGrade?: (word: LevelBlankWord, wasCorrect: boolean) => void;
  /** Onboarding only: surface form of a word to pulse, drawing the eye to it. */
  pulseWord?: string | null;
};

/**
 * Renders the active cue's Spanish words (tappable, karaoke-highlighted)
 * and the translation line below. Sync is driven by requestAnimationFrame
 * reading video.currentTime — never setInterval.
 *
 * When a cue contains a due saved word, that word renders as an inline
 * typed-recall blank; the translation line stays visible as the prompt.
 */
export function SubtitleTrack({
  videoRef,
  cues,
  language,
  active,
  onWordTap,
  blanks,
  levelBlanks,
  onBlankActive,
  onBlankGrade,
  onLevelBlankGrade,
  pulseWord,
}: SubtitleTrackProps) {
  const [cueIndex, setCueIndex] = useState(-1);
  const [wordIndex, setWordIndex] = useState(-1);
  // Keep the last visible cue mounted so it can fade out without layout shift.
  const lastCueIndexRef = useRef(-1);

  const [resolved, setResolved] = useState<Record<number, BlankResult>>({});
  const [answer, setAnswer] = useState('');
  const [celebrating, setCelebrating] = useState(false);
  const pausedForCueRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
  }, []);

  // Both blank sources merged into one plan the rest of the component runs on.
  // The pause/type/grade machinery is shared; `kind` only picks the accent,
  // the label, and which grade callback fires.
  const allBlanks = useMemo(() => {
    const merged = new Map<number, BlankEntry>();
    if (levelBlanks) {
      for (const [ci, word] of levelBlanks) merged.set(ci, { kind: 'level', word });
    }
    if (blanks) {
      for (const [ci, word] of blanks) merged.set(ci, { kind: 'recall', word });
    }
    return merged;
  }, [blanks, levelBlanks]);

  // Latest values the rAF loop reads, kept in refs so the loop isn't torn down
  // and re-subscribed every time a blank resolves.
  const blanksRef = useRef(allBlanks);
  const resolvedRef = useRef(resolved);
  const onBlankActiveRef = useRef(onBlankActive);
  useEffect(() => {
    blanksRef.current = allBlanks;
  }, [allBlanks]);
  useEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);
  useEffect(() => {
    onBlankActiveRef.current = onBlankActive;
  }, [onBlankActive]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        // Let a due blank PLAY through its word so the user hears it in
        // context, then pause at the word's END. We scan the blank plan rather
        // than only the active cue, so if choppy playback overshoots past the
        // word into the next cue before this fires, it's still caught here —
        // then clamped back to word.end so the moment isn't lost and the next
        // subtitle never bleeds in.
        const plan = blanksRef.current;
        if (plan && plan.size > 0) {
          for (const [blankCue, entry] of plan) {
            if (resolvedRef.current[blankCue] !== undefined) continue;
            const c = cues[blankCue];
            if (!c) continue;
            const bw = c.words.find(
              (w) => normalizeAnswer(w.text) === normalizeAnswer(entry.word.text)
            );
            if (!bw) continue;
            // Hold INSIDE the blank cue's display window, never on its
            // boundary. Pipeline data can carry a word whose end sits exactly
            // on cue.start — pausing there displays the PREVIOUS cue (the
            // boundary instant belongs to it), so the input would never
            // render and the video would freeze with no way out. Clamping a
            // hair into the cue guarantees the input is on screen while we
            // hold.
            const pauseAt = Math.min(c.end, Math.max(bw.end, c.start + 0.02));
            if (pausedForCueRef.current === blankCue) {
              if (!video.paused) {
                // Playback resumed over the unanswered blank (a stray tap, a
                // play() promise that outlived our pause) — re-assert the
                // hold once it reaches the word again, keeping typed text.
                // (Replay deliberately gets to play back UP TO the word.)
                if (video.currentTime >= pauseAt) {
                  if (video.currentTime > pauseAt) video.currentTime = pauseAt;
                  video.pause();
                  onBlankActiveRef.current?.(); // cancels pending auto-resume
                }
              } else if (Math.abs(video.currentTime - pauseAt) > 0.05) {
                // Paused but displaced — e.g. a blank on the video's final
                // word can lose the race with the loop wrap and land at 0,
                // a frozen frame with no input in sight. Re-seat the hold
                // where the blank's cue (and its input) are visible.
                video.currentTime = pauseAt;
              }
              break;
            }
            if (video.currentTime < pauseAt) continue;
            pausedForCueRef.current = blankCue;
            if (video.currentTime > pauseAt) video.currentTime = pauseAt;
            video.pause();
            onBlankActiveRef.current?.();
            setAnswer('');
            // Focus without scrolling — the keyboard must not shift the track.
            requestAnimationFrame(() =>
              inputRef.current?.focus({ preventScroll: true })
            );
            break;
          }
        }

        const t = video.currentTime;
        const ci = cues.findIndex((c) => t >= c.start && t <= c.end);
        setCueIndex(ci);
        if (ci >= 0) {
          lastCueIndexRef.current = ci;
          setWordIndex(cues[ci].words.findIndex((w) => t >= w.start && t < w.end));
        } else {
          setWordIndex(-1);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, cues, videoRef]);

  // A new blank plan (slide re-activated) resets local recall state.
  useEffect(() => {
    setResolved({});
    setAnswer('');
    pausedForCueRef.current = null;
  }, [allBlanks]);

  const visible = cueIndex >= 0;
  const displayIndex = visible ? cueIndex : lastCueIndexRef.current;
  const cue = displayIndex >= 0 ? cues[displayIndex] : null;

  const blankEntry =
    visible && !resolved[displayIndex]
      ? allBlanks.get(displayIndex) ?? null
      : null;
  const blankWord = blankEntry?.word ?? null;
  const resolvedResult = resolved[displayIndex];
  const gradedWord = allBlanks.get(displayIndex)?.word ?? null;

  const blankWordIndex = useMemo(() => {
    const target = blankWord ?? (resolvedResult ? gradedWord : null);
    if (!cue || !target) return -1;
    return cue.words.findIndex(
      (w) => normalizeAnswer(w.text) === normalizeAnswer(target.text)
    );
  }, [cue, blankWord, resolvedResult, gradedWord]);

  // Onboarding: which word in the visible cue to pulse (step "tap a word").
  const pulseIndex = useMemo(() => {
    if (!pulseWord || !cue) return -1;
    return cue.words.findIndex(
      (w) => normalizeAnswer(w.text) === normalizeAnswer(pulseWord)
    );
  }, [pulseWord, cue]);

  // The pause is no longer tied to a cue becoming visible: it happens in the
  // rAF loop above, when currentTime crosses the blanked word's end time. The
  // input renders (masking the word) from the moment the cue is active, so the
  // user sees a blank is coming, hears the word, then the video stops to type.

  const gradeBlank = useCallback(
    (wasCorrect: boolean) => {
      if (!blankEntry) return;
      setResolved((r) => ({
        ...r,
        [displayIndex]: wasCorrect ? 'correct' : 'wrong',
      }));
      // The typed text belongs to this blank only. The next blank's input
      // mounts as soon as its cue is visible — well before the pause handler
      // clears the field — so without this the old answer sits in the new
      // blank (and its check button is enabled) until the video stops.
      setAnswer('');
      if (wasCorrect) {
        setCelebrating(true);
        if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
        celebrationTimer.current = setTimeout(() => setCelebrating(false), 1200);
        // subtle haptic where supported (no-op on iOS Safari)
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(15);
          } catch {
            // some browsers throw without a user-activation flag — ignore
          }
        }
      }
      if (blankEntry.kind === 'recall') {
        onBlankGrade?.(blankEntry.word, wasCorrect);
      } else {
        onLevelBlankGrade?.(blankEntry.word, wasCorrect);
      }
    },
    [blankEntry, displayIndex, onBlankGrade, onLevelBlankGrade]
  );

  const submitAnswer = useCallback(() => {
    if (!blankWord || !answer.trim()) return;
    gradeBlank(normalizeAnswer(answer) === normalizeAnswer(blankWord.text));
  }, [answer, blankWord, gradeBlank]);

  return (
    // min-height fits a two-line Spanish cue plus translation at full size,
    // so cue changes and wraps never shift the layout below. The celebration
    // (mascot hop, particles) is absolute within this box — zero layout shift.
    <div className="pointer-events-none relative flex min-h-[11rem] flex-col justify-end px-4">
      {celebrating && (
        <div className="animate-loro-pop absolute right-6 top-0 flex items-end gap-1.5">
          <LoroMascot state="happy" size={60} />
          <span className="mb-4 rounded-full bg-surface-raised px-2.5 py-1 text-xs font-semibold text-accent shadow-md shadow-black/30">
            ¡Correcto!
          </span>
        </div>
      )}
      <div
        className={`transition-opacity duration-150 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {cue && (
          <>
            <p className="pointer-events-auto flex flex-wrap items-center gap-y-1 text-[1.75rem] font-bold leading-[1.3] tracking-tight text-text [text-shadow:0_1px_16px_rgba(0,0,0,0.75)]">
              {cue.words.map((word, i) => {
                if (i === blankWordIndex && blankWord && blankEntry) {
                  // Same blank interaction for both kinds; the framing says
                  // why it popped up: green dashed = your saved word coming
                  // back (recall), blue solid + tier chip = level practice.
                  const isLevel = blankEntry.kind === 'level';
                  return (
                    <span
                      key={`${displayIndex}-${i}`}
                      className="inline-flex items-center gap-1.5 px-1"
                    >
                      {isLevel && (
                        <span className="flex items-center gap-1 rounded-md bg-level-soft px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-level">
                          <ChartIcon width={11} height={11} />
                          {tierFor(blankEntry.word.level).name}
                        </span>
                      )}
                      <input
                        ref={inputRef}
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitAnswer();
                        }}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        enterKeyHint="done"
                        aria-label={
                          isLevel
                            ? 'Type the level word you just heard'
                            : 'Type the missing Spanish word'
                        }
                        // the word's gloss is the prompt: meaning -> Spanish
                        placeholder={blankWord.translation}
                        style={{
                          width: `${Math.max(
                            4,
                            blankWord.text.length + 1,
                            Math.min(blankWord.translation.length, 14)
                          )}ch`,
                        }}
                        className={`border-b-[3px] bg-transparent px-1 py-0.5 text-center outline-none [font:inherit] [letter-spacing:inherit] placeholder:text-[0.6em] placeholder:font-medium ${
                          isLevel
                            ? 'border-solid border-level text-level caret-level placeholder:text-level/50'
                            : 'border-dashed border-accent text-accent caret-accent placeholder:text-accent/50'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={submitAnswer}
                        aria-label="Check answer"
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-background transition-transform active:scale-90 disabled:opacity-40 ${
                          isLevel ? 'bg-level' : 'bg-accent'
                        }`}
                        disabled={!answer.trim()}
                      >
                        <CheckIcon width={16} height={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => gradeBlank(false)}
                        aria-label="Skip and reveal"
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-muted backdrop-blur-md transition-transform active:scale-90"
                      >
                        <CloseIcon width={14} height={14} />
                      </button>
                    </span>
                  );
                }
                if (i === blankWordIndex && resolvedResult) {
                  return (
                    <span
                      key={`${displayIndex}-${i}-r`}
                      className={`relative rounded-xl px-2 py-1 ${
                        resolvedResult === 'correct'
                          ? 'animate-correct text-accent'
                          : 'animate-wrong'
                      }`}
                    >
                      {word.text}
                      {resolvedResult === 'correct' && celebrating && (
                        <span aria-hidden className="pointer-events-none">
                          {PARTICLES.map((p, k) => (
                            <span
                              key={k}
                              className="celebrate-particle"
                              style={
                                {
                                  '--dx': `${p.dx}px`,
                                  '--dy': `${p.dy}px`,
                                  '--rot': `${p.rot}deg`,
                                  animationDelay: `${k * 18}ms`,
                                } as React.CSSProperties
                              }
                            />
                          ))}
                        </span>
                      )}
                    </span>
                  );
                }
                if (i === pulseIndex) {
                  // The onboarding tap target. The video is frozen on this
                  // word; the pulse + anchored hint must carry the whole
                  // "press this" message on their own.
                  return (
                    <span
                      key={`${displayIndex}-${i}`}
                      className="relative inline-flex"
                    >
                      <button
                        type="button"
                        onClick={() => onWordTap(word, cue, displayIndex)}
                        className="animate-tap-target rounded-xl bg-accent-soft px-2 py-1 text-accent"
                      >
                        {word.text}
                      </button>
                      {/* The step's primary call to action — sized to compete
                          with the subtitle itself, not fine print. */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 flex -translate-x-1/2 flex-col items-center whitespace-nowrap"
                      >
                        <span className="text-[1.375rem] font-bold tracking-tight text-text [text-shadow:0_2px_16px_rgba(0,0,0,0.95),0_0_3px_rgba(0,0,0,0.7)]">
                          Tap this word
                        </span>
                        <CaretDownIcon
                          width={22}
                          height={22}
                          className="animate-tap-hint mt-0.5 text-accent drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]"
                        />
                      </span>
                    </span>
                  );
                }
                return (
                  <button
                    key={`${displayIndex}-${i}`}
                    type="button"
                    // px-2 py-1 puts the hit area at ~44px tall for this type size
                    onClick={() => onWordTap(word, cue, displayIndex)}
                    // While a tap target pulses, the karaoke highlight yields
                    // and the rest of the line steps back — still tappable
                    // (never block a tap), just visually de-emphasised.
                    className={`rounded-xl px-2 py-1 transition-[background-color,color,opacity] duration-100 active:scale-95 ${
                      visible && i === wordIndex && pulseIndex < 0
                        ? 'bg-accent text-background [text-shadow:none]'
                        : 'bg-transparent'
                    } ${pulseIndex >= 0 ? 'opacity-40' : ''}`}
                  >
                    {word.text}
                  </button>
                );
              })}
            </p>
            <p
              className={`mt-2 px-2 text-[1.0625rem] font-normal leading-relaxed text-text/70 transition-opacity duration-100 [text-shadow:0_1px_10px_rgba(0,0,0,0.8)] ${
                pulseIndex >= 0 ? 'opacity-40' : ''
              }`}
            >
              {cue.translations[language] ?? cue.translations.en}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
