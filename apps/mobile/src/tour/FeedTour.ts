import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCatalog } from '@loro/core/catalog';
import { collectionVideos } from '@loro/core/catalog/collectionVideos';
import { lookupGloss, normalizeSurface } from '@loro/core/dictionary';
import { storage } from '@loro/core/storage';
import type { Video } from '@loro/core/types';
import { usePlayerApi, usePlayerClock, usePlayerStatus } from '../player/PlayerHost';
import type { FeedWalkthrough } from '../feed/FeedScreen';
import type { CoachCardContent } from '../feed/WalkthroughCoach';
import { setTourStep, type TourStep } from './tour';

/**
 * The feed half of the walkthrough (tour.ts): the beats that happen on top of
 * the REAL feed, through the seams the onboarding taste reel left in
 * FeedScreen (FeedWalkthrough). Nothing here is a mock: the blank is the
 * planner's own blue blank, the sheet is the real word sheet, the save is a
 * real save. The script only watches, stops the clip at the right moment and
 * rings a word.
 *
 *   blank  the sound card (while muted), then "Fill the blue gap"; the first
 *          graded blank moves on, after its celebration has played.
 *   save   once the clip is playing again, it stops on the line on screen
 *          and rings one word the dictionary can explain. The sheet resumes
 *          playback when it closes, so while the ring is up the clip is held.
 *   words  "Saved!", clip still held; Shell lights the Words tab.
 *
 * A save at ANY beat counts — the user who taps a word before the blank came
 * did the thing the tour was going to ask for.
 */

const COACH: Record<'sound' | 'blank' | 'save' | 'words', CoachCardContent> = {
  sound: { kind: 'sound', title: 'Turn the sound on', body: 'Tap the video once.' },
  blank: { kind: 'fill', title: 'Fill the blue gap', body: 'A word goes missing. Type what you hear.' },
  save: { kind: 'tap', title: 'Tap the glowing word', body: 'See what it means, then tap Save word.' },
  words: { kind: 'saved', title: 'Saved!', body: 'Now tap Words, down below.' },
};

/** Long enough for the answer's own green celebration (Celebration.tsx). */
const AFTER_BLANK_MS = 1600;
/** No blue gap in the first clip after this long: go on to the save beat. */
const BLANK_FALLBACK_MS = 40_000;
/** How long the clip plays after the blank before the save stop. */
const SAVE_LEAD_MS = 1200;

function findVideo(youtubeId: string | null): Video | null {
  if (!youtubeId) return null;
  return [...getCatalog(), ...collectionVideos].find((v) => v.youtubeId === youtubeId) ?? null;
}

/** One word on the line at `t` that the sheet can explain and is not saved yet. */
function pickWord(video: Video, t: number): { cueIndex: number; surface: string } | null {
  const cues = video.cues;
  let idx = cues.findIndex((c) => c.start <= t && t < c.end);
  if (idx < 0) {
    for (let i = cues.length - 1; i >= 0; i--) {
      if (cues[i].start <= t) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return null;
  const saved = new Set(storage.getSavedWords().map((w) => normalizeSurface(w.text)));
  const words = cues[idx].words.filter((w) => {
    const key = normalizeSurface(w.text);
    return key.length >= 3 && !saved.has(key) && lookupGloss(video, w.text) !== null;
  });
  const best = words.find((w) => normalizeSurface(w.text).length >= 4) ?? words[0];
  return best ? { cueIndex: idx, surface: best.text } : null;
}

export function useFeedTour(step: TourStep): FeedWalkthrough | undefined {
  const api = usePlayerApi();
  const clock = usePlayerClock();
  const status = usePlayerStatus();
  const [spotlight, setSpotlight] = useState<{ cueIndex: number; surface: string } | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Through the Words beats too: the feed stays in walkthrough mode (no card,
  // nothing armed) until the tour is over, so opening Words changes nothing
  // on the hidden feed in the same frame.
  const onFeed = step !== 'off' && step !== 'done';

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    []
  );

  // blank: a clip with no early blue gap must not stall the tour.
  useEffect(() => {
    if (step !== 'blank') return;
    const t = setTimeout(() => setTourStep('save'), BLANK_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [step]);

  // save: wait for the clip to be PLAYING (a held blank is paused and must
  // finish first), let it run a beat, then stop on the line and ring a word.
  const enteredSaveAt = useRef(0);
  useEffect(() => {
    if (step !== 'save') {
      setSpotlight(null);
      return;
    }
    enteredSaveAt.current = Date.now();
    const id = setInterval(() => {
      if (Date.now() - enteredSaveAt.current < SAVE_LEAD_MS) return;
      if (!clock.isPlaying.value) return;
      const video = findVideo(status.loadedVideoId);
      if (!video) return;
      const t = clock.anchorTime.value + ((Date.now() - clock.anchorAt.value) / 1000) * clock.rate.value;
      const pick = pickWord(video, t);
      if (!pick) return;
      api.pause();
      setSpotlight(pick);
      clearInterval(id);
    }, 250);
    return () => clearInterval(id);
    // status.loadedVideoId: a swipe to another clip starts the search again.
  }, [step, status.loadedVideoId, api, clock]);

  // A swipe away drops a ring that belonged to the old clip's line.
  useEffect(() => {
    setSpotlight(null);
  }, [status.loadedVideoId]);

  // THE HOLD: while a word is ringed, or the "Saved!" card is up, the clip
  // stays stopped — the sheet resumes playback when it closes, and a moving
  // line would carry the ring away (the taste reel learned this on device).
  useEffect(() => {
    const holding = (step === 'save' && spotlight !== null) || step === 'words';
    if (holding && status.playing) api.pause();
  }, [step, spotlight, status.playing, api]);

  const onBlankResolved = useCallback(() => {
    if (step !== 'blank') return;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => setTourStep('save'), AFTER_BLANK_MS);
  }, [step]);

  const onWordSaved = useCallback(() => {
    if (step !== 'blank' && step !== 'save') return;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setSpotlight(null);
    setTourStep('words');
  }, [step]);

  const coach: CoachCardContent | null =
    step === 'blank'
      ? status.muted
        ? COACH.sound
        : COACH.blank
      : step === 'save'
        ? spotlight
          ? COACH.save
          : null
        : step === 'words'
          ? COACH.words
          : null;

  return useMemo<FeedWalkthrough | undefined>(
    () =>
      onFeed
        ? {
            spotlight: step === 'save' ? spotlight : null,
            coach,
            focusWord: null,
            levelBlanks: true,
            onBlankResolved,
            onWordSaved,
          }
        : undefined,
    [onFeed, step, spotlight, coach, onBlankResolved, onWordSaved]
  );
}
