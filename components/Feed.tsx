'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Cue, Video, Word } from '@/types';
import { storage } from '@/lib/storage';
import { SubtitleTrack } from '@/components/SubtitleTrack';
import { WordSheet, type WordSheetData } from '@/components/WordSheet';
import { LanguagePicker } from '@/components/LanguagePicker';
import { LoroMascot } from '@/components/LoroMascot';
import { BookIcon, VolumeOnIcon } from '@/components/icons/Icons';

const VISIBILITY_THRESHOLD = 0.6;

export function Feed({ videos }: { videos: Video[] }) {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);

  const [language, setLanguage] = useState('en');
  const [unmuted, setUnmuted] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Every translation language present in the seed data.
  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const video of videos)
      for (const cue of video.cues)
        for (const code of Object.keys(cue.translations)) set.add(code);
    return [...set].sort();
  }, [videos]);

  useEffect(() => {
    setLanguage(storage.getLanguage());
    setUnmuted(storage.getSessionUnmuted());
    setHydrated(true);
  }, []);

  const handleLanguageChange = useCallback((code: string) => {
    setLanguage(code);
    storage.setLanguage(code);
  }, []);

  const handleUnmute = useCallback(() => {
    setUnmuted(true);
    storage.setSessionUnmuted(true);
  }, []);

  // Deep link from /vocab: /?v={videoId}&t={cueStart}
  const deepLinkVideoId = searchParams.get('v');
  const deepLinkTime = searchParams.get('t');
  const seekRef = useRef<{ videoId: string; time: number } | null>(
    deepLinkVideoId
      ? { videoId: deepLinkVideoId, time: Number(deepLinkTime) || 0 }
      : null
  );

  useEffect(() => {
    if (!deepLinkVideoId || !containerRef.current) return;
    const index = videos.findIndex((v) => v.id === deepLinkVideoId);
    if (index > 0) {
      containerRef.current.children[index]?.scrollIntoView({ behavior: 'instant' });
    }
  }, [deepLinkVideoId, videos]);

  return (
    <div className="relative h-[100dvh] bg-background">
      <div
        ref={containerRef}
        className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll"
      >
        {videos.map((video, index) => (
          <VideoSlide
            key={video.id}
            video={video}
            language={language}
            isFirst={index === 0}
            unmuted={unmuted}
            onUnmute={handleUnmute}
            seekRef={seekRef}
          />
        ))}
      </div>

      {/* Top chrome — over everything, respects the notch */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 pt-safe">
        <div className="flex items-center justify-between px-4 pt-4">
          <Link
            href="/vocab"
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/40 px-3.5 py-2 text-sm font-medium text-text backdrop-blur-md transition-colors hover:bg-black/55"
          >
            <BookIcon width={15} height={15} className="text-accent" />
            My words
          </Link>
          {hydrated && (
            <LanguagePicker
              languages={languages}
              value={language}
              onChange={handleLanguageChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type VideoSlideProps = {
  video: Video;
  language: string;
  isFirst: boolean;
  unmuted: boolean;
  onUnmute: () => void;
  seekRef: RefObject<{ videoId: string; time: number } | null>;
};

function VideoSlide({
  video,
  language,
  isFirst,
  unmuted,
  onUnmute,
  seekRef,
}: VideoSlideProps) {
  const slideRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [sheet, setSheet] = useState<WordSheetData | null>(null);
  const [sheetSaved, setSheetSaved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Play when >60% visible; pause and reset otherwise.
  useEffect(() => {
    const slide = slideRef.current;
    if (!slide) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const el = videoRef.current;
        if (!el) return;
        if (entry.intersectionRatio > VISIBILITY_THRESHOLD) {
          setActive(true);
          const pending = seekRef.current;
          if (pending && pending.videoId === video.id) {
            el.currentTime = pending.time;
            seekRef.current = null;
          }
          el.play().catch(() => {});
        } else {
          setActive(false);
          setSheet(null);
          el.pause();
          el.currentTime = 0;
        }
      },
      { threshold: [0, VISIBILITY_THRESHOLD, 1] }
    );
    observer.observe(slide);
    return () => observer.disconnect();
  }, [seekRef, video.id]);

  // Keep the element's muted flag in sync with the session choice.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !unmuted;
  }, [unmuted]);

  const handleWordTap = useCallback((word: Word, cue: Cue, cueIndex: number) => {
    videoRef.current?.pause();
    setSheetSaved(false);
    setSheet({ word, cue, cueIndex });
  }, []);

  const handleSheetClose = useCallback(() => {
    setSheet(null);
    if (active) videoRef.current?.play().catch(() => {});
  }, [active]);

  const handleSave = useCallback(() => {
    if (!sheet) return;
    storage.saveWord({
      text: sheet.word.text,
      translation:
        sheet.cue.translations[language] ?? sheet.cue.translations.en,
      videoId: video.id,
      cueIndex: sheet.cueIndex,
    });
    setSheetSaved(true);
    setToast(`"${sheet.word.text}" saved!`);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, [sheet, language, video.id]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  return (
    <div
      ref={slideRef}
      className="relative h-[100dvh] w-full snap-start overflow-hidden bg-background"
    >
      <video
        ref={videoRef}
        src={video.src}
        poster={video.poster}
        playsInline
        loop
        muted
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Soft gradient so subtitles stay legible over any footage */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />

      <ProgressBar videoRef={videoRef} active={active} />

      {/* Creator + level */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pb-safe">
        <div className="px-5 pb-3">
          <span className="mr-2 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-bold tracking-wide text-accent">
            {video.level}
          </span>
          <span className="text-sm font-medium text-text/80">
            {video.creator}
          </span>
        </div>
        <div className="pb-6">
          <SubtitleTrack
            videoRef={videoRef}
            cues={video.cues}
            language={language}
            active={active && !sheet}
            onWordTap={handleWordTap}
          />
        </div>
      </div>

      {/* Tap-to-unmute — prominent, first slide only */}
      {isFirst && !unmuted && (
        <button
          type="button"
          onClick={onUnmute}
          className="absolute inset-0 z-20 flex items-center justify-center"
          aria-label="Unmute"
        >
          <span className="flex items-center gap-2.5 rounded-full bg-black/60 px-6 py-3.5 text-base font-semibold text-text backdrop-blur-md transition-transform active:scale-95">
            <VolumeOnIcon width={20} height={20} className="text-accent" />
            Tap for sound
          </span>
        </button>
      )}

      {sheet && (
        <WordSheet
          data={sheet}
          language={language}
          saved={sheetSaved}
          onSave={handleSave}
          onClose={handleSheetClose}
        />
      )}

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-40 animate-toast-in">
          <div className="flex -translate-x-0 items-center gap-2 rounded-full bg-surface-raised py-2 pl-2 pr-4 shadow-lg shadow-black/40">
            <LoroMascot state="happy" size={32} />
            <span className="text-sm font-medium text-text">{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({
  videoRef,
  active,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const el = videoRef.current;
      const bar = barRef.current;
      if (el && bar && el.duration > 0) {
        bar.style.transform = `scaleX(${el.currentTime / el.duration})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, videoRef]);

  return (
    <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-white/10">
      <div
        ref={barRef}
        className="h-full origin-left bg-accent"
        style={{ transform: 'scaleX(0)' }}
      />
    </div>
  );
}
