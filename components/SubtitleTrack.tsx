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
import { CheckIcon, CloseIcon } from '@/components/icons/Icons';
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

type SubtitleTrackProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  cues: Cue[];
  language: string;
  /** Only run the rAF loop while the slide is on screen. */
  active: boolean;
  onWordTap: (word: Word, cue: Cue, cueIndex: number) => void;
  /** cueIndex -> due word to render as a fill-in-the-blank. */
  blanks?: ReadonlyMap<number, SavedWord>;
  /** Fired once when a blank becomes visible — the parent pauses the video. */
  onBlankActive?: () => void;
  /** Fired when the user submits or skips a blank. */
  onBlankGrade?: (word: SavedWord, wasCorrect: boolean) => void;
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
  onBlankActive,
  onBlankGrade,
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

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
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
  }, [blanks]);

  const visible = cueIndex >= 0;
  const displayIndex = visible ? cueIndex : lastCueIndexRef.current;
  const cue = displayIndex >= 0 ? cues[displayIndex] : null;

  const blankWord =
    visible && blanks && !resolved[displayIndex]
      ? blanks.get(displayIndex) ?? null
      : null;
  const resolvedResult = resolved[displayIndex];
  const gradedWord = blanks?.get(displayIndex) ?? null;

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

  // Pause the video the moment an unresolved blank becomes visible.
  useEffect(() => {
    if (
      blankWord &&
      blankWordIndex >= 0 &&
      pausedForCueRef.current !== displayIndex
    ) {
      pausedForCueRef.current = displayIndex;
      setAnswer('');
      onBlankActive?.();
      // focus after paint so the keyboard comes up with the blank
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [blankWord, blankWordIndex, displayIndex, onBlankActive]);

  const gradeBlank = useCallback(
    (wasCorrect: boolean) => {
      if (!blankWord) return;
      setResolved((r) => ({
        ...r,
        [displayIndex]: wasCorrect ? 'correct' : 'wrong',
      }));
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
      onBlankGrade?.(blankWord, wasCorrect);
    },
    [blankWord, displayIndex, onBlankGrade]
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
                if (i === blankWordIndex && blankWord) {
                  return (
                    <span
                      key={`${displayIndex}-${i}`}
                      className="inline-flex items-center gap-1.5 px-1"
                    >
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
                        aria-label="Type the missing Spanish word"
                        // the word's gloss is the recall prompt: meaning -> Spanish
                        placeholder={blankWord.translation}
                        style={{
                          width: `${Math.max(
                            4,
                            blankWord.text.length + 1,
                            Math.min(blankWord.translation.length, 14)
                          )}ch`,
                        }}
                        className="border-b-[3px] border-dashed border-accent bg-transparent px-1 py-0.5 text-center text-accent caret-accent outline-none [font:inherit] [letter-spacing:inherit] placeholder:text-[0.6em] placeholder:font-medium placeholder:text-accent/50"
                      />
                      <button
                        type="button"
                        onClick={submitAnswer}
                        aria-label="Check answer"
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-background transition-transform active:scale-90 disabled:opacity-40"
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
                const isPulsing = i === pulseIndex;
                return (
                  <button
                    key={`${displayIndex}-${i}`}
                    type="button"
                    // px-2 py-1 puts the hit area at ~44px tall for this type size
                    onClick={() => onWordTap(word, cue, displayIndex)}
                    className={`rounded-xl px-2 py-1 transition-colors duration-100 active:scale-95 ${
                      visible && i === wordIndex
                        ? 'bg-accent text-background [text-shadow:none]'
                        : isPulsing
                          ? 'animate-coach bg-accent-soft text-accent'
                          : 'bg-transparent'
                    }`}
                  >
                    {word.text}
                  </button>
                );
              })}
            </p>
            <p className="mt-2 px-2 text-[1.0625rem] font-normal leading-relaxed text-text/70 [text-shadow:0_1px_10px_rgba(0,0,0,0.8)]">
              {cue.translations[language] ?? cue.translations.en}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
