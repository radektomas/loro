'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Cue, SavedWord, Video, Word } from '@/types';
import { storage } from '@/lib/storage';
import { computeBlankPlan } from '@/lib/srs';
import { computeLevelBlankPlan, tierFor, type LevelBlankWord } from '@/lib/levels';
import { glossText, lookupGloss } from '@/lib/dictionary';
import type { LoroMascotState } from '@/components/LoroMascot';
import { SubtitleTrack } from '@/components/SubtitleTrack';
import { WordSheet, type WordSheetData } from '@/components/WordSheet';
import { GlossarySheet } from '@/components/GlossarySheet';
import { LanguagePicker } from '@/components/LanguagePicker';
import { LoroMascot } from '@/components/LoroMascot';
import { ActionRail } from '@/components/ActionRail';
import { CreatorPill } from '@/components/creator/CreatorEntryCard';
import { orderVideosForLevel } from '@/lib/calibration';
import {
  BookIcon,
  ChartIcon,
  PlayIcon,
  VolumeOnIcon,
} from '@/components/icons/Icons';

const VISIBILITY_THRESHOLD = 0.6;

export function Feed({ videos }: { videos: Video[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);

  const [language, setLanguage] = useState('en');
  const [unmuted, setUnmuted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // First-time visitors are routed to the guided intro before the feed. Render
  // nothing until this resolves so the feed never flashes behind /welcome.
  const [gate, setGate] = useState<'checking' | 'open'>('checking');
  // Feed order is seeded by the calibrated level (client-only; SSR keeps the
  // source order, and we only paint the feed after the gate opens — no mismatch).
  const [feedVideos, setFeedVideos] = useState(videos);

  useEffect(() => {
    if (!storage.isOnboarded()) {
      router.replace('/welcome');
      return;
    }
    const level = storage.getStartLevel();
    setFeedVideos(level ? orderVideosForLevel(videos, level) : videos);
    setGate('open');
  }, [router, videos]);

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

  // The ONLY places a sound choice is persisted: both are real user gestures
  // (the tap-for-sound overlay, the rail's mute toggle).
  const handleUnmute = useCallback(() => {
    setUnmuted(true);
    storage.setSessionUnmuted(true);
  }, []);

  const handleUserMute = useCallback(() => {
    setUnmuted(false);
    storage.setSessionUnmuted(false);
  }, []);

  // Browsers reject unmuted autoplay without a fresh gesture (e.g. scrolling
  // to a new slide, or a timer-driven resume). When that happens the slide
  // falls back to muted playback and the sound overlay resurfaces.
  //
  // Deliberately does NOT call storage.setSessionUnmuted: this is the
  // browser's autoplay policy talking, not the user. Persisting it here made
  // a one-off rejection stick across the session as if the user had chosen
  // mute. Only a user gesture may write the stored choice.
  const handleAutoMuted = useCallback(() => {
    setUnmuted(false);
  }, []);

  // Deep link from /vocab: /?v={videoId}&t={cueStart}
  const deepLinkVideoId = searchParams.get('v');
  const deepLinkTime = searchParams.get('t');
  const seekRef = useRef<{ videoId: string; time: number } | null>(
    deepLinkVideoId
      ? { videoId: deepLinkVideoId, time: Number(deepLinkTime) || 0 }
      : null
  );

  // Scroll the deep-linked video into view once the feed is actually mounted.
  // This must wait for the gate to open: while it's still 'checking' the scroll
  // container isn't rendered, and feedVideos can keep the same reference, so
  // without the gate dependency the effect would run too early and never retry.
  useEffect(() => {
    if (gate !== 'open' || !deepLinkVideoId || !containerRef.current) return;
    const index = feedVideos.findIndex((v) => v.id === deepLinkVideoId);
    if (index > 0) {
      containerRef.current.children[index]?.scrollIntoView({ behavior: 'instant' });
    }
  }, [deepLinkVideoId, feedVideos, gate]);

  if (gate === 'checking') return <div className="h-[100dvh] bg-background" />;

  return (
    <div className="relative h-[100dvh] bg-background">
      <div
        ref={containerRef}
        className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll"
      >
        {feedVideos.map((video) => (
          <VideoSlide
            key={video.id}
            video={video}
            language={language}
            unmuted={unmuted}
            onUnmute={handleUnmute}
            onUserMute={handleUserMute}
            onAutoMuted={handleAutoMuted}
            seekRef={seekRef}
          />
        ))}
      </div>

      {/* Top chrome — over everything, respects the notch */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 pt-safe">
        <div className="flex items-center justify-between px-4 pt-4">
          <div className="flex items-center gap-2">
            <Link
              href="/vocab"
              className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/40 px-3.5 py-2 text-sm font-medium text-text backdrop-blur-md transition-colors hover:bg-black/55"
            >
              <BookIcon width={15} height={15} className="text-accent" />
              My words
            </Link>
            <Link
              href="/progress"
              className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/40 px-3.5 py-2 text-sm font-medium text-text backdrop-blur-md transition-colors hover:bg-black/55"
            >
              <ChartIcon width={15} height={15} className="text-accent" />
              Progress
            </Link>
            <CreatorPill />
          </div>
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

/**
 * Drives the guided intro on a real feed slide (see /welcome). Everything is
 * optional and inert unless VideoSlide gets an `onboarding` prop, so the normal
 * feed is unaffected. The overlay/coach-marks live in the /welcome page; this
 * is just the hooks it needs into the slide's internals.
 */
export type OnboardingControl = {
  /** Word to pulse in the subtitles (step "tap a word"). */
  pulseWord?: string | null;
  /** Force these blanks, bypassing SRS scheduling (the recall payoff). */
  blanks?: ReadonlyMap<number, SavedWord> | null;
  /** A seek instruction; a new object (bumped nonce) re-runs it. */
  command?: { time: number; then: 'pause' | 'play'; nonce: number } | null;
  /** Slide became active — the video is playing and subtitles are live. */
  onActive?: () => void;
  onWordTap?: (word: Word, cueIndex: number) => void;
  onSaved?: (word: Word, cueIndex: number) => void;
  onSheetClose?: (saved: boolean) => void;
  onRecall?: (word: SavedWord, wasCorrect: boolean) => void;
};

type VideoSlideProps = {
  video: Video;
  language: string;
  unmuted: boolean;
  onUnmute: () => void;
  /** Deliberate mute from the rail toggle — a user CHOICE, so the parent
      persists it. Optional: the onboarding slide has no rail. */
  onUserMute?: () => void;
  onAutoMuted: () => void;
  seekRef: RefObject<{ videoId: string; time: number } | null>;
  onboarding?: OnboardingControl;
};

export function VideoSlide({
  video,
  language,
  unmuted,
  onUnmute,
  onUserMute,
  onAutoMuted,
  seekRef,
  onboarding,
}: VideoSlideProps) {
  const slideRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [sheet, setSheet] = useState<WordSheetData | null>(null);
  const [sheetSaved, setSheetSaved] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    /** Optional second line — used by tier announcements for the meaning. */
    sub?: string;
    mood: LoroMascotState;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A recall/level blank has paused the video and is waiting for an answer.
  // While true, the paused indicator hides and video taps don't resume —
  // the check / skip buttons are the only way forward.
  const [blankWaiting, setBlankWaiting] = useState(false);
  // cueIndex -> due word rendered as a typed-recall blank
  const [blanks, setBlanks] = useState<Map<number, SavedWord> | null>(null);
  // cueIndex -> level-practice word rendered as a level blank (same UI)
  const [levelBlanks, setLevelBlanks] =
    useState<Map<number, LevelBlankWord> | null>(null);

  // play() that survives autoplay policy: if unmuted playback is rejected,
  // drop to muted playback and tell the feed so the sound overlay returns.
  //
  // onAutoMuted goes through a ref so safePlay's identity NEVER changes.
  // Parents may pass inline handlers (/welcome does); if safePlay were
  // recreated on their renders, the IntersectionObserver effect below would
  // re-subscribe — and a fresh observer immediately reports "visible", which
  // calls safePlay and silently resumes a video the onboarding guide had
  // just paused.
  const onAutoMutedRef = useRef(onAutoMuted);
  useEffect(() => {
    onAutoMutedRef.current = onAutoMuted;
  }, [onAutoMuted]);

  const safePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.play().catch((err: unknown) => {
      // Only the autoplay-policy rejection earns the muted retry. A pending
      // play() that gets interrupted by pause() rejects with AbortError —
      // retrying THAT would silently resume a video something just paused
      // (e.g. a recall blank holding the frame for the answer).
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' && !el.muted) {
        el.muted = true;
        onAutoMutedRef.current();
        el.play().catch(() => {});
      }
    });
  }, []);

  // Play when >60% visible; pause and reset otherwise.
  useEffect(() => {
    const slide = slideRef.current;
    if (!slide) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const el = videoRef.current;
        if (!el) return;
        if (entry.intersectionRatio > VISIBILITY_THRESHOLD) {
          activeRef.current = true;
          setActive(true);
          const pending = seekRef.current;
          if (pending && pending.videoId === video.id) {
            seekRef.current = null;
            // Seek to the word's cue — but a video seeks only once it has
            // metadata. Setting currentTime while readyState is HAVE_NOTHING is
            // silently dropped and playback starts at 0 (the deep-link bug), so
            // defer the seek to loadedmetadata when the media isn't ready yet.
            const HAVE_METADATA = 1; // readyState with duration/dimensions known
            const seekAndPlay = () => {
              if (!activeRef.current) return;
              el.currentTime = pending.time;
              safePlay();
            };
            if (el.readyState >= HAVE_METADATA) {
              seekAndPlay();
            } else {
              el.addEventListener('loadedmetadata', seekAndPlay, { once: true });
              if (el.preload === 'none') el.load();
            }
          } else {
            safePlay();
          }
        } else {
          activeRef.current = false;
          setActive(false);
          setSheet(null);
          setGlossaryOpen(false);
          setBlankWaiting(false);
          el.pause();
          el.currentTime = 0;
        }
      },
      { threshold: [0, VISIBILITY_THRESHOLD, 1] }
    );
    observer.observe(slide);
    return () => observer.disconnect();
  }, [safePlay, seekRef, video.id]);

  // Keep the element's muted flag in sync with the session choice.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !unmuted;
  }, [unmuted]);

  // Mirror the element's play state so the paused indicator stays honest
  // no matter what paused it (tap, word sheet, or the observer).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
    };
  }, []);

  // Watch tracking feeds the Progress screen's comprehension average.
  useEffect(() => {
    if (active) storage.markWatched(video.id);
  }, [active, video.id]);

  // Plan which cues become blanks each time this slide takes the screen.
  // Graded words get a future dueAt, so replans never repeat them.
  // Level blanks are planned after the SRS plan and never take its cues —
  // recall of the user's own saved words always wins a collision.
  // Onboarding drives its own blanks (onboarding.blanks), so skip the planner.
  useEffect(() => {
    if (onboarding) return;
    if (active) {
      const saved = storage.getSavedWords();
      const srsPlan = computeBlankPlan(video, saved, Date.now());
      setBlanks(srsPlan);
      setLevelBlanks(
        computeLevelBlankPlan(
          video,
          storage.getLevelState().level,
          saved,
          language,
          new Set(srsPlan.keys())
        )
      );
    } else {
      setBlanks(null);
      setLevelBlanks(null);
    }
  }, [active, video, onboarding, language]);

  const effectiveBlanks = onboarding
    ? onboarding.blanks ?? undefined
    : blanks ?? undefined;

  // Onboarding: announce the slide is live once, so the guide can start step a.
  const announcedActive = useRef(false);
  useEffect(() => {
    if (active && onboarding && !announcedActive.current) {
      announcedActive.current = true;
      onboarding.onActive?.();
    }
  }, [active, onboarding]);

  // Onboarding: execute a seek command (rewind to a cue, then pause or play).
  useEffect(() => {
    const cmd = onboarding?.command;
    if (!cmd) return;
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = cmd.time;
    if (cmd.then === 'pause') el.pause();
    else safePlay();
  }, [onboarding?.command, safePlay]);

  const handleBlankActive = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    setBlankWaiting(true);
    videoRef.current?.pause();
  }, []);

  const handleBlankGrade = useCallback(
    (word: SavedWord, wasCorrect: boolean) => {
      setBlankWaiting(false);
      storage.gradeWord(word.text, word.videoId, wasCorrect);
      onboarding?.onRecall?.(word, wasCorrect);
      // In onboarding the guide controls resume/rewind (it may re-blank on a
      // miss), so don't fight it with the normal auto-resume.
      if (onboarding) return;
      // Correct-answer feedback lives in SubtitleTrack's celebration —
      // no top-of-screen toast on top of it.
      // Resume quickly on success; leave time to read the reveal on a miss.
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(
        () => {
          if (activeRef.current) safePlay();
        },
        wasCorrect ? 600 : 1500
      );
    },
    [safePlay, onboarding]
  );

  // A level blank was answered: save the word into the SRS routed by result
  // (miss -> bottom box, hit -> known box), move the meter, and resume with
  // the same rhythm as recall. Level changes get a toast — the meter itself
  // lives on the Progress screen.
  const handleLevelBlankGrade = useCallback(
    (word: LevelBlankWord, wasCorrect: boolean) => {
      setBlankWaiting(false);
      storage.saveLevelWord(
        {
          text: word.text,
          translation: word.translation,
          videoId: word.videoId,
          cueIndex: word.cueIndex,
        },
        wasCorrect
      );
      const result = storage.applyLevelAnswer(wasCorrect);
      const tier = tierFor(result.level);
      if (result.leveledUp) {
        // The hop-and-feathers celebration already fires in the subtitle
        // track (this was a correct fill); the toast names the new tier —
        // and teaches it, meaning underneath.
        setToast({
          message: `You're now ${tier.name}`,
          sub: `"${tier.meaning}"`,
          mood: 'happy',
        });
      } else if (result.leveledDown) {
        // Quiet by design — just reflect the drop, no drama.
        setToast({ message: `Back to ${tier.name} for now`, mood: 'idle' });
      }
      if (result.leveledUp || result.leveledDown) {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(
          () => setToast(null),
          result.leveledUp ? 3200 : 2200
        );
      }
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(
        () => {
          if (activeRef.current) safePlay();
        },
        wasCorrect ? 600 : 1500
      );
    },
    [safePlay]
  );

  const togglePlayback = useCallback(() => {
    // While onboarding holds the frame on the tap target (pulseWord set), a
    // stray tap on the video must not resume playback — the step waits,
    // frozen, until a subtitle word is tapped. Same while a blank is waiting
    // for an answer: answering or skipping is the only way to move on.
    if (onboarding?.pulseWord || blankWaiting) return;
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) safePlay();
    else el.pause();
  }, [safePlay, onboarding?.pulseWord, blankWaiting]);

  const handleReplay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    safePlay();
  }, [safePlay]);

  // Unmute inside the tap's own user activation: set the element directly
  // and resume, so autoplay policy can never re-reject it — THEN update
  // state. This is the reliable recovery after an auto-mute.
  const handleUnmuteTap = useCallback(() => {
    const el = videoRef.current;
    if (el) {
      el.muted = false;
      if (el.paused && activeRef.current) safePlay();
    }
    onUnmute();
  }, [onUnmute, safePlay]);

  // Rail toggle: deliberate mute (a persisted user choice) or unmute.
  const handleToggleSound = useCallback(() => {
    const el = videoRef.current;
    if (unmuted) {
      if (el) el.muted = true;
      onUserMute?.();
    } else {
      handleUnmuteTap();
    }
  }, [unmuted, onUserMute, handleUnmuteTap]);

  // The glossary sheet pauses like the word sheet: open holds the video,
  // close resumes it if the slide is still on screen.
  const handleOpenGlossary = useCallback(() => {
    videoRef.current?.pause();
    setGlossaryOpen(true);
  }, []);

  const handleGlossaryClose = useCallback(() => {
    setGlossaryOpen(false);
    if (activeRef.current) safePlay();
  }, [safePlay]);

  const handleWordTap = useCallback(
    (word: Word, cue: Cue, cueIndex: number) => {
      videoRef.current?.pause();
      setSheetSaved(false);
      setSheet({ word, cue, cueIndex, gloss: lookupGloss(video, word.text) });
      onboarding?.onWordTap?.(word, cueIndex);
    },
    [video, onboarding]
  );

  const handleSheetClose = useCallback(() => {
    setSheet(null);
    onboarding?.onSheetClose?.(sheetSaved);
    if (active) safePlay();
  }, [active, safePlay, onboarding, sheetSaved]);

  const handleSave = useCallback(() => {
    if (!sheet) return;
    // Store the per-word gloss — it becomes the recall prompt in the SRS
    // blanks. Sentence translation only as a last-resort fallback.
    const wordGloss = sheet.gloss && glossText(sheet.gloss, language);
    const { ok } = storage.saveWord({
      text: sheet.word.text,
      translation:
        wordGloss ??
        sheet.cue.translations[language] ??
        sheet.cue.translations.en ??
        '',
      videoId: video.id,
      cueIndex: sheet.cueIndex,
    });
    // In onboarding the save flows straight into the recall payoff: mark it
    // saved, tell the guide (which arms the blank), then close the sheet and
    // resume so the just-saved word comes back as a blank in its own cue.
    if (onboarding) {
      if (ok) {
        setSheetSaved(true);
        onboarding.onSaved?.(sheet.word, sheet.cueIndex);
        setTimeout(() => {
          setSheet(null);
          if (activeRef.current) safePlay();
        }, 900);
      }
      return;
    }
    // Only celebrate a verified write — a failed save must look failed.
    // Loro stays 'idle' here: 'happy' is earned by recalling, not saving.
    if (ok) {
      setSheetSaved(true);
      setToast({ message: `"${sheet.word.text}" saved!`, mood: 'idle' });
    } else {
      setToast({ message: 'Could not save — storage unavailable', mood: 'idle' });
    }
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, [sheet, language, video.id, onboarding, safePlay]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
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
        onClick={togglePlayback}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Soft scrim so the subtitle track stays legible over bright footage —
          transparent at the top, dark at the bottom, never a hard bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

      <ProgressBar videoRef={videoRef} active={active} />

      {/* Paused indicator — taps fall through to the video, which resumes.
          Hidden during onboarding: the guide pauses deliberately. */}
      {paused && active && !sheet && !onboarding && !blankWaiting && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center animate-fade-in">
          <span className="rounded-full bg-black/40 p-5 text-text backdrop-blur-md">
            <PlayIcon width={30} height={30} />
          </span>
        </div>
      )}

      {/* Bottom stack: action rail, then creator + subtitles. The wrapper is
          pointer-events-none so taps between controls reach the video;
          the rail and word buttons re-enable their own pointer events. */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 pb-safe">
        {!onboarding && (
          <div className="flex justify-end px-3 pb-3">
            <ActionRail
              video={video}
              unmuted={unmuted}
              onToggleSound={handleToggleSound}
              onReplay={handleReplay}
              onOpenGlossary={handleOpenGlossary}
            />
          </div>
        )}
        <div className="px-5 pb-3">
          <span className="mr-2 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-bold tracking-wide text-accent">
            {video.level}
          </span>
          <span className="text-sm font-medium text-text/80">
            {video.creator}
          </span>
        </div>
        <div className="pb-10">
          <SubtitleTrack
            videoRef={videoRef}
            cues={video.cues}
            language={language}
            active={active && !sheet && !glossaryOpen}
            onWordTap={handleWordTap}
            blanks={effectiveBlanks}
            levelBlanks={onboarding ? undefined : levelBlanks ?? undefined}
            onBlankActive={handleBlankActive}
            onBlankGrade={handleBlankGrade}
            onLevelBlankGrade={handleLevelBlankGrade}
            pulseWord={onboarding?.pulseWord}
          />
        </div>
      </div>

      {/* Tap-to-unmute — on WHICHEVER slide is active while sound is off, so
          an auto-mute mid-feed always has a recovery right where it happened
          (the tap is a real user gesture on the element that failed). Only
          the pill itself is tappable: muted watching stays fully interactive
          — word taps, rail, pause — around it. Suppressed in onboarding so
          nothing but the loop is on screen, and while a blank is waiting for
          an answer so it never competes with typing. */}
      {active && !unmuted && !onboarding && !blankWaiting && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <button
            type="button"
            onClick={handleUnmuteTap}
            aria-label="Unmute"
            className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-black/60 px-6 py-3.5 text-base font-semibold text-text backdrop-blur-md transition-transform active:scale-95"
          >
            <VolumeOnIcon width={20} height={20} className="text-accent" />
            Tap for sound
          </button>
        </div>
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

      {glossaryOpen && (
        <GlossarySheet
          video={video}
          language={language}
          onClose={handleGlossaryClose}
        />
      )}

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-40 animate-toast-in">
          <div className="flex -translate-x-0 items-center gap-2 rounded-full bg-surface-raised py-2 pl-2 pr-4 shadow-lg shadow-black/40">
            <LoroMascot state={toast.mood} size={toast.sub ? 44 : 32} />
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-text">
                {toast.message}
              </span>
              {toast.sub && (
                <span className="text-xs text-muted">{toast.sub}</span>
              )}
            </span>
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
