'use client';

import { useMemo, useRef, useState } from 'react';
import type { Cue, Word } from '@/types';
import { videoPublicUrl, type CreatorVideo } from '@/lib/creators';
import { normalizeSurface } from '@/lib/dictionary';
import { SubtitleTrack } from '@/components/SubtitleTrack';
import { WordSheet, type WordSheetData } from '@/components/WordSheet';
import { FilmIcon } from '@/components/icons/Icons';

/**
 * The admin's word-timing check: the uploaded video with the SAME
 * SubtitleTrack the feed uses, so the reviewer sees exactly what learners
 * would see — karaoke highlight riding each word. If the highlight drifts off
 * the audio, the timestamps are wrong and the clip gets rejected.
 *
 * Native <video> controls stay on: scrubbing back over a suspect line is the
 * core reviewing gesture. Tapping a word opens the normal WordSheet so the
 * glosses can be spot-checked too (the save button is inert here).
 *
 * Media handling is explicit because UGC files are hostile: iPhone .mov is
 * HEVC, which Chromium browsers often can't decode (Safari can) — that must
 * surface as a readable message, never a black box with a dead play button.
 * The pipeline also doesn't fill poster_path yet, so before the first frame
 * decodes we show our own placeholder instead of relying on a poster.
 */
export function ReviewPlayer({
  video,
  src,
}: {
  video: CreatorVideo;
  src: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sheet, setSheet] = useState<WordSheetData | null>(null);
  const [language, setLanguage] = useState('en');
  const [media, setMedia] = useState<'loading' | 'ready' | 'error'>('loading');

  const cues = useMemo<Cue[]>(() => video.cues ?? [], [video.cues]);
  const posterUrl = video.posterPath ? videoPublicUrl(video.posterPath) : null;
  const isMov = /\.mov(\?|$)/i.test(video.storagePath);

  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const cue of cues)
      for (const code of Object.keys(cue.translations ?? {})) set.add(code);
    return [...set].sort();
  }, [cues]);

  const handleWordTap = (word: Word, cue: Cue, cueIndex: number) => {
    videoRef.current?.pause();
    setSheet({
      word,
      cue,
      cueIndex,
      gloss: video.dictionary?.[normalizeSurface(word.text)] ?? null,
    });
  };

  return (
    <div className="relative min-h-56 overflow-hidden rounded-2xl bg-black">
      <video
        ref={videoRef}
        src={src}
        poster={posterUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        onLoadedData={() => setMedia('ready')}
        onError={() => setMedia('error')}
        className="max-h-[70vh] w-full bg-black"
      />

      {/* No poster from the pipeline: our own placeholder until the first
          frame decodes, so the wait never looks like a dead player. */}
      {media === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-raised">
          <FilmIcon width={26} height={26} className="animate-pulse text-muted" />
          <p className="text-xs text-muted">Loading video…</p>
        </div>
      )}

      {/* Decode/load failure — say what's wrong instead of a dead button. */}
      {media === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-raised px-6 text-center">
          <FilmIcon width={26} height={26} className="text-muted" />
          <p className="text-sm font-semibold text-text">
            This browser can&apos;t play this file
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-muted">
            {isMov
              ? 'iPhone .mov recordings are HEVC-encoded, which Chrome and Firefox usually can’t decode. Open this page in Safari to review it here, or open the file directly below.'
              : 'The media failed to load or decode. Check that the storage object still exists, or open the file directly below.'}
          </p>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl bg-accent px-5 py-2.5 text-sm font-semibold text-background transition-transform active:scale-95"
          >
            Open file directly
          </a>
        </div>
      )}

      {media !== 'error' &&
        (cues.length > 0 ? (
          // Sits above the native control bar so scrubbing stays reachable.
          <div className="pointer-events-none absolute inset-x-0 bottom-16">
            <SubtitleTrack
              videoRef={videoRef}
              cues={cues}
              language={language}
              active
              onWordTap={handleWordTap}
            />
          </div>
        ) : (
          <p className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-black/60 px-3 py-1.5 text-xs text-amber-300">
            No cues on this video yet
          </p>
        ))}

      {media === 'ready' && languages.length > 1 && (
        <div className="absolute right-3 top-3 flex gap-1">
          {languages.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLanguage(code)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase backdrop-blur-md transition-colors ${
                code === language
                  ? 'bg-accent text-background'
                  : 'bg-black/50 text-muted'
              }`}
            >
              {code}
            </button>
          ))}
        </div>
      )}

      {sheet && (
        <WordSheet
          data={sheet}
          language={language}
          saved
          onSave={() => {}}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
