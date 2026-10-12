import { useEffect, useState } from 'react';
import { storageDriver } from '../platform/storage';
import { track } from '../platform/analytics';

/**
 * THE FIRST-RUN WALKTHROUGH (Radek, 2026-10-12: "they land on the feed, we
 * need to make them save a word after they filled a blue blank, then take
 * him to the words section and show him the blue blanks will be there and
 * the saved words he can practise there, and finally show him the map …
 * smooth as hell").
 *
 * One linear script, each beat advanced by the user DOING the thing — never
 * by a Next button where a real action exists:
 *
 *   blank       feed: fill the first blue gap            (FeedTour)
 *   save        feed: the video stops, one word glows, tap it, Save word
 *   words       feed: "Saved!" and the Words tab glows → tap it   (Shell)
 *   wordsHere   Words: spotlight on the city and its words        (WordsTour)
 *   wordsTrain  Words: spotlight on the next word to train
 *   map         Words: spotlight on the map → ¡Vamos! → feed
 *   done
 *
 * ONLY NEW INSTALLS. The script is armed by onboarding finishing on this
 * build (startTourAfterOnboarding); an existing user updating never has the
 * key and never sees it. Skippable from every beat.
 *
 * Kept in MMKV under loro.mobile.* so it dies with the user's other data
 * (account deletion, dev wipes) and survives a relaunch mid-tour. A relaunch
 * inside the Words beats resumes at "open Words", because the Words overlay
 * needs the tab to be opened to measure what it points at.
 */

export type TourStep = 'off' | 'blank' | 'save' | 'words' | 'wordsHere' | 'wordsTrain' | 'map' | 'done';

const KEY = 'loro.mobile.tour';
const STEPS: TourStep[] = ['off', 'blank', 'save', 'words', 'wordsHere', 'wordsTrain', 'map', 'done'];

/** Which of the four dots a step lights (the strip's "1/4"). */
export const TOUR_STAGE: Record<TourStep, number> = {
  off: 0,
  blank: 1,
  save: 2,
  words: 3,
  wordsHere: 3,
  wordsTrain: 3,
  map: 4,
  done: 0,
};

function read(): TourStep {
  try {
    const raw = storageDriver.local.getItem(KEY) as TourStep | null;
    if (!raw || !STEPS.includes(raw)) return 'off';
    if (raw === 'wordsHere' || raw === 'wordsTrain' || raw === 'map') return 'words';
    return raw;
  } catch {
    return 'off';
  }
}

let current: TourStep = read();
const listeners = new Set<(step: TourStep) => void>();

export function getTourStep(): TourStep {
  return current;
}

export function setTourStep(step: TourStep): void {
  if (step === current) return;
  const from = current;
  current = step;
  try {
    storageDriver.local.setItem(KEY, step);
  } catch {
    // The tour is a nicety; a write that fails just means it may repeat.
  }
  track('tour_step', { step, from });
  for (const l of listeners) l(step);
}

/** Onboarding just finished on this install: the next Shell runs the tour. */
export function startTourAfterOnboarding(): void {
  current = 'blank';
  try {
    storageDriver.local.setItem(KEY, 'blank');
  } catch {
    // See setTourStep.
  }
}

export function skipTour(): void {
  track('tour_skipped', { at: current });
  setTourStep('done');
}

export function isTouring(step: TourStep = current): boolean {
  return step !== 'off' && step !== 'done';
}

export function useTourStep(): TourStep {
  const [step, setStep] = useState(current);
  useEffect(() => {
    setStep(current);
    listeners.add(setStep);
    return () => {
      listeners.delete(setStep);
    };
  }, []);
  return step;
}

/** DEV: run the tour again on the next launch (the dev menu row). */
export function devRestartTour(): void {
  current = 'blank';
  storageDriver.local.setItem(KEY, 'blank');
}
