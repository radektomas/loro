'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Level, SavedWord, SelfLevel, Video, Word } from '@/types';
import { storage } from '@/lib/storage';
import { normalizeAnswer } from '@/lib/srs';
import {
  STARTER_DECK,
  STARTER_STAGGER_MS,
  STARTER_VIDEO_ID,
  starterIndexOf,
  starterTranslation,
} from '@/lib/starterDeck';
import { glossText, lookupGloss } from '@/lib/dictionary';
import { languageLabel } from '@/lib/languages';
import {
  buildCalibrationWords,
  deriveLevel,
  pickGuidedVideo,
  pickTargetWord,
  type TargetWord,
} from '@/lib/calibration';
import { VideoSlide, type OnboardingControl } from '@/components/Feed';
import { LoroMascot } from '@/components/LoroMascot';
import { staticVideos } from '@/lib/staticVideos';

// The typed seed list, with `author` mapped in — NOT a cast of the raw JSON.
// The previous `videosData as unknown as Video[]` here handed VideoSlide
// videos with no author field and crashed AuthorLine for every onboarding
// user. lib/staticVideos.ts is the one place seed entries become Video.
const videos = staticVideos;

type Phase = 'hook' | 'assess' | 'calibration' | 'result' | 'guide';
type GuideStep = 'watch' | 'tapWord' | 'saveWord' | 'recall' | 'closing';

const MAX_RECALL_RETRIES = 2;

/** The SavedWord shape SubtitleTrack renders as a blank (text = answer,
    translation = the meaning prompt shown as the input placeholder). */
function buildBlankWord(
  video: Video,
  word: Word,
  cueIndex: number,
  language: string
): SavedWord {
  const gloss = lookupGloss(video, word.text);
  const cue = video.cues[cueIndex];
  const translation =
    (gloss && glossText(gloss, language)) ||
    cue?.translations[language] ||
    cue?.translations.en ||
    word.text;
  const now = Date.now();
  return {
    text: word.text,
    translation,
    videoId: video.id,
    cueIndex,
    // The guide's throwaway blank word: it is the user's own save, made a
    // second earlier in the intro, so it is 'user' like any feed save.
    source: 'user',
    savedAt: now,
    state: 'new',
    box: 0,
    dueAt: now, // due now — this is the seeded recall
    correct: 0,
    incorrect: 0,
    lastReviewedAt: null,
  };
}

// tapWord has no entry: its instruction ("Tap this word") is anchored to the
// pulsing word itself inside SubtitleTrack, not floated up here.
const COACH: Record<Exclude<GuideStep, 'closing' | 'tapWord'>, string> = {
  watch: 'The words light up as they’re spoken.',
  saveWord: 'Save it — Loro brings it back.',
  recall: 'Now type it from memory.',
};

export default function WelcomePage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('hook');
  const [language] = useState(() => storage.getLanguage());

  // Calibration
  const calibrationWords = useMemo(() => buildCalibrationWords(), []);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<Level | null>(null);

  // Guided video + target word, fixed once we enter the guide.
  const [guided, setGuided] = useState<Video | null>(null);
  const targetRef = useRef<TargetWord | null>(null);

  // Guide state
  const [guideStep, setGuideStep] = useState<GuideStep>('watch');
  const [pulseWord, setPulseWord] = useState<string | null>(null);
  const [blanks, setBlanks] = useState<ReadonlyMap<number, SavedWord> | null>(
    null
  );
  const [command, setCommand] = useState<OnboardingControl['command']>(null);
  const [unmuted, setUnmuted] = useState(true);

  const guideStepRef = useRef<GuideStep>('watch');
  const retriesRef = useRef(MAX_RECALL_RETRIES);
  const nonceRef = useRef(0);
  const watchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekRef = useRef<{ videoId: string; time: number } | null>(null);

  const setStep = useCallback((s: GuideStep) => {
    guideStepRef.current = s;
    setGuideStep(s);
  }, []);

  useEffect(
    () => () => {
      if (watchTimer.current) clearTimeout(watchTimer.current);
    },
    []
  );

  const finish = useCallback(() => {
    storage.setOnboarded();
    router.replace('/feed');
  }, [router]);

  // A from-zero user who dropped out of the starter deck resumes there, not
  // back at the questions. Gated on !isOnboarded so "replay the intro" from
  // /progress still replays the intro.
  useEffect(() => {
    if (
      !storage.isOnboarded() &&
      storage.getSelfLevel() === 'zero' &&
      !storage.isStarterDone()
    ) {
      router.replace('/onboarding/starter');
    }
  }, [router]);

  // --- Step 1: self-assessment -> route ---
  const pickSelfLevel = useCallback(
    (level: SelfLevel) => {
      storage.setSelfLevel(level);
      if (level === 'zero') {
        // The deck IS their calibration: seed the feed at the easy end.
        storage.setStartLevel('A1');
        router.push('/onboarding/starter');
      } else {
        setPhase('calibration');
      }
    },
    [router]
  );

  /**
   * Escape hatch from calibration: "I'm actually starting from zero."
   * Selections are COMMITTED, not discarded — each tapped word enters the
   * SRS at box 3 ("I know this"), so the starter deck skips it and the
   * denominator shrinks. Translations resolve through the starter deck,
   * which the deck test guarantees is a superset of the calibration seed —
   * deliberately no fallback (an empty translation is a permanently broken
   * /vocab row). A miss means the lists drifted: skip the word, and the
   * test is the tripwire that catches the drift.
   */
  const escapeToStarter = useCallback(() => {
    for (const text of known) {
      const i = starterIndexOf(text);
      if (i < 0) {
        console.error(
          `[loro] calibration word "${text}" missing from starter deck`
        );
        continue;
      }
      const entry = STARTER_DECK[i];
      storage.saveWordAtBox(
        {
          text: entry.word,
          translation: starterTranslation(entry, language),
          videoId: STARTER_VIDEO_ID,
          cueIndex: i,
        },
        3,
        i * STARTER_STAGGER_MS,
        // A grant, not behaviour: the user said "I know these" in calibration,
        // they did not save them. Excluded from both gate counters.
        'deck'
      );
    }
    storage.setCalibrationKnown([...known]);
    storage.setStartLevel('A1');
    storage.setSelfLevel('zero');
    router.push('/onboarding/starter');
  }, [known, language, router]);

  // --- Step 2: calibration -> derived level ---
  const toggleWord = (text: string) => {
    setKnown((prev) => {
      const next = new Set(prev);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });
  };

  const finishCalibration = () => {
    const derived = deriveLevel(known, calibrationWords);
    setLevel(derived);
    storage.setStartLevel(derived);
    storage.setCalibrationKnown([...known]);

    const video = pickGuidedVideo(videos, derived);
    const knownSurfaces = new Set([...known].map(normalizeAnswer));
    targetRef.current = pickTargetWord(video, knownSurfaces);
    setGuided(video);

    setPhase('result');
  };

  // Result screen holds briefly, then drops into the guided video.
  useEffect(() => {
    if (phase !== 'result') return;
    const t = setTimeout(() => {
      setStep('watch');
      setPhase('guide');
    }, 1900);
    return () => clearTimeout(t);
  }, [phase, setStep]);

  // --- Step 3: guided loop control ---

  const armTapWord = useCallback(() => {
    const target = targetRef.current;
    if (!target || !guided) return;
    setPulseWord(target.word.text);
    setStep('tapWord');
    nonceRef.current += 1;
    // Freeze mid-word, not at the cue start: the target must be the word on
    // screen when the frame stops, and playback waits there until they tap.
    setCommand({
      time: (target.word.start + target.word.end) / 2,
      then: 'pause',
      nonce: nonceRef.current,
    });
  }, [guided, setStep]);

  const handleActive = useCallback(() => {
    // Step (a): let the karaoke play for a beat, then invite the first tap.
    setStep('watch');
    if (watchTimer.current) clearTimeout(watchTimer.current);
    watchTimer.current = setTimeout(armTapWord, 4000);
  }, [armTapWord, setStep]);

  const handleWordTap = useCallback(() => {
    // Accept ANY word (even not the pulsed one) — never block them.
    if (guideStepRef.current === 'watch' || guideStepRef.current === 'tapWord') {
      if (watchTimer.current) clearTimeout(watchTimer.current);
      setPulseWord(null);
      setStep('saveWord');
    }
  }, [setStep]);

  const handleSaved = useCallback(
    (word: Word, cueIndex: number) => {
      const video = guided;
      if (!video) return;
      const savedWord = buildBlankWord(video, word, cueIndex, language);
      // Arm the recall blank in the word's own cue. The slide auto-closes the
      // sheet and resumes, so the just-saved word comes back within its cue.
      setBlanks(new Map([[cueIndex, savedWord]]));
      setPulseWord(null);
      retriesRef.current = MAX_RECALL_RETRIES;
      setStep('recall');
    },
    [guided, language, setStep]
  );

  const handleSheetClose = useCallback(
    (saved: boolean) => {
      // Closed without saving mid-step — re-invite the tap so they don't stall.
      if (!saved && guideStepRef.current === 'saveWord') armTapWord();
    },
    [armTapWord]
  );

  const reBlank = useCallback(
    (word: SavedWord) => {
      const video = guided;
      if (!video) return;
      const cue = video.cues[word.cueIndex];
      // New Map ref resets SubtitleTrack's resolved state so the blank returns.
      setBlanks(new Map([[word.cueIndex, word]]));
      nonceRef.current += 1;
      setCommand({ time: cue.start, then: 'play', nonce: nonceRef.current });
    },
    [guided]
  );

  const handleRecall = useCallback(
    (word: SavedWord, wasCorrect: boolean) => {
      if (wasCorrect) {
        // Let the celebration play, then close on the explanation.
        setTimeout(() => setStep('closing'), 1500);
        return;
      }
      // Never let the first ever recall end in failure: reveal, then re-blank
      // the same word so they land it. Give a couple of tries, then move on.
      if (retriesRef.current > 0) {
        retriesRef.current -= 1;
        setTimeout(() => reBlank(word), 1800);
      } else {
        setTimeout(() => setStep('closing'), 1800);
      }
    },
    [reBlank, setStep]
  );

  const onboarding: OnboardingControl = useMemo(
    () => ({
      pulseWord,
      blanks,
      command,
      onActive: handleActive,
      onWordTap: handleWordTap,
      onSaved: handleSaved,
      onSheetClose: handleSheetClose,
      onRecall: handleRecall,
    }),
    [
      pulseWord,
      blanks,
      command,
      handleActive,
      handleWordTap,
      handleSaved,
      handleSheetClose,
      handleRecall,
    ]
  );

  // ---------------------------------------------------------------- render

  const SkipButton = (
    <button
      type="button"
      onClick={finish}
      className="absolute right-4 top-4 z-50 rounded-full bg-black/40 px-3.5 py-2 text-xs font-medium text-muted backdrop-blur-md transition-colors hover:text-text pt-safe"
    >
      Skip
    </button>
  );

  if (phase === 'hook') {
    return (
      <main className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-background px-8 text-center">
        {SkipButton}
        <LoroMascot state="idle" size={140} />
        <h1 className="mt-8 text-3xl font-bold leading-tight tracking-tight text-text">
          Learn Spanish from real people talking.
        </h1>
        <button
          type="button"
          onClick={() => setPhase('assess')}
          className="mt-10 rounded-2xl bg-accent px-10 py-4 text-lg font-bold text-background transition-transform active:scale-95"
        >
          Empezar
        </button>
      </main>
    );
  }

  if (phase === 'assess') {
    const options: { level: SelfLevel; title: string; body: string }[] = [
      {
        level: 'zero',
        title: 'Starting from zero',
        body: 'We’ll build your first words together before the videos.',
      },
      {
        level: 'some',
        title: 'I know some Spanish',
        body: 'A quick word check tunes where you start.',
      },
      {
        level: 'confident',
        title: 'I want to grow my vocabulary',
        body: 'Jump into real videos and mine them for words.',
      },
    ];
    return (
      <main className="relative flex min-h-[100dvh] flex-col bg-background px-6 pt-safe pb-safe">
        {SkipButton}
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16">
          <h1 className="text-2xl font-bold tracking-tight text-text">
            How much Spanish do you have?
          </h1>
          <p className="mt-2 text-sm text-muted">
            This just picks your starting point — nothing is locked in.
          </p>
          <div className="mt-8 space-y-2.5">
            {options.map((o) => (
              <button
                key={o.level}
                type="button"
                onClick={() => pickSelfLevel(o.level)}
                className="w-full rounded-2xl bg-surface p-5 text-left transition-all hover:bg-surface-raised active:scale-[0.98]"
              >
                <span className="block text-base font-semibold text-text">
                  {o.title}
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                  {o.body}
                </span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (phase === 'calibration') {
    return (
      <main className="relative flex min-h-[100dvh] flex-col bg-background px-6 pt-safe pb-safe">
        {SkipButton}
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16">
          <h1 className="text-2xl font-bold tracking-tight text-text">
            Tap the words you already know.
          </h1>
          <p className="mt-2 text-sm text-muted">
            No timer, no right answers — this just tunes where you start.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            {calibrationWords.map((w) => {
              const on = known.has(w.text);
              return (
                <button
                  key={w.text}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleWord(w.text)}
                  className={`rounded-2xl px-4 py-2.5 text-lg font-semibold transition-all active:scale-95 ${
                    on
                      ? 'bg-accent text-background'
                      : 'bg-surface text-text hover:bg-surface-raised'
                  }`}
                >
                  {w.text}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={finishCalibration}
          className="w-full rounded-2xl bg-accent py-4 text-lg font-bold text-background transition-transform active:scale-[0.98]"
        >
          {known.size > 0 ? 'Continuar' : 'None of these yet'}
        </button>
        {/* Escape hatch — low emphasis on purpose. Selections are kept, not
            thrown away (see escapeToStarter). */}
        <button
          type="button"
          onClick={escapeToStarter}
          className="mb-6 mt-3 w-full py-1 text-center text-sm font-medium text-muted transition-colors hover:text-text"
        >
          I’m actually starting from zero
        </button>
      </main>
    );
  }

  if (phase === 'result') {
    return (
      <main className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-background px-8 text-center">
        {SkipButton}
        <div className="animate-fade-in flex flex-col items-center">
          <LoroMascot state="happy" size={120} />
          <p className="mt-6 text-sm uppercase tracking-widest text-muted">
            Empecemos con
          </p>
          <p className="mt-1 text-5xl font-bold tracking-tight text-accent">
            {level}
          </p>
        </div>
      </main>
    );
  }

  // phase === 'guide'
  return (
    <main className="relative h-[100dvh] overflow-hidden bg-background">
      {guided && (
        <VideoSlide
          video={guided}
          language={language}
          unmuted={unmuted}
          onUnmute={() => setUnmuted(true)}
          onAutoMuted={() => setUnmuted(false)}
          seekRef={seekRef}
          onboarding={onboarding}
        />
      )}

      {SkipButton}

      {/* Coach mark — a soft pulsing line, dismissed by doing the thing.
          Not shown for tapWord: that step's instruction lives on the word. */}
      {guideStep !== 'closing' && guideStep !== 'tapWord' && (
        <div
          key={guideStep}
          className="animate-coach-in pointer-events-none absolute left-1/2 top-[22%] z-40 flex items-center gap-2.5 rounded-full bg-black/55 px-5 py-2.5 backdrop-blur-md"
        >
          <span className="animate-coach h-2 w-2 rounded-full bg-accent" />
          <span className="text-sm font-semibold text-text">
            {COACH[guideStep]}
          </span>
        </div>
      )}

      {/* Step (e): the explanation, now that it means something. */}
      {guideStep === 'closing' && (
        <div className="animate-fade-in absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/75 px-8 text-center backdrop-blur-sm">
          <LoroMascot state="happy" size={110} />
          <p className="mt-6 max-w-sm text-xl font-semibold leading-relaxed text-text">
            That’s Loro. Save what you don’t know, and it’ll come back right
            before you forget it.
          </p>
          {/* The intro teaches translations by showing them, so it also has to
              say where the language is chosen — it now lives two taps deep in
              Profile → Settings instead of on the feed's top bar. */}
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
            Translations are in {languageLabel(language)}. Change that any time
            in Profile → Settings.
          </p>
          <button
            type="button"
            onClick={finish}
            className="mt-9 rounded-2xl bg-accent px-10 py-4 text-lg font-bold text-background transition-transform active:scale-95"
          >
            ¡Vamos!
          </button>
        </div>
      )}
    </main>
  );
}
