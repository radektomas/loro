'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Cue, Word } from '@/types';

type SubtitleTrackProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  cues: Cue[];
  language: string;
  /** Only run the rAF loop while the slide is on screen. */
  active: boolean;
  onWordTap: (word: Word, cue: Cue, cueIndex: number) => void;
};

/**
 * Renders the active cue's Spanish words (tappable, karaoke-highlighted)
 * and the translation line below. Sync is driven by requestAnimationFrame
 * reading video.currentTime — never setInterval.
 */
export function SubtitleTrack({
  videoRef,
  cues,
  language,
  active,
  onWordTap,
}: SubtitleTrackProps) {
  const [cueIndex, setCueIndex] = useState(-1);
  const [wordIndex, setWordIndex] = useState(-1);
  // Keep the last visible cue mounted so it can fade out without layout shift.
  const lastCueIndexRef = useRef(-1);

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

  const visible = cueIndex >= 0;
  const displayIndex = visible ? cueIndex : lastCueIndexRef.current;
  const cue = displayIndex >= 0 ? cues[displayIndex] : null;

  return (
    <div className="pointer-events-none flex min-h-[7.5rem] flex-col justify-end px-5">
      <div
        className={`transition-opacity duration-150 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {cue && (
          <>
            <p className="pointer-events-auto flex flex-wrap gap-x-1.5 gap-y-1 text-[1.35rem] font-semibold leading-snug tracking-tight text-text [text-shadow:0_1px_12px_rgba(0,0,0,0.7)]">
              {cue.words.map((word, i) => (
                <button
                  key={`${displayIndex}-${i}`}
                  type="button"
                  onClick={() => onWordTap(word, cue, displayIndex)}
                  className={`rounded-lg px-1 py-0.5 transition-colors duration-100 active:scale-95 ${
                    visible && i === wordIndex
                      ? 'bg-accent text-background [text-shadow:none]'
                      : 'bg-transparent'
                  }`}
                >
                  {word.text}
                </button>
              ))}
            </p>
            <p className="mt-1.5 px-1 text-[0.95rem] leading-relaxed text-text/60 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
              {cue.translations[language] ?? cue.translations.en}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
