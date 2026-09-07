import type { SavedWord } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { answeredCorrectToday, computeStreaks, dayKey } from '@loro/core/progress';
import { track } from '../platform/analytics';
import { storageDriver } from '../platform/storage';
import { getPlan } from '../progress/plan';

/**
 * THE WIN — "your day is done", raised once, the moment it becomes true.
 *
 * Nothing in the app had an end before this (2026-09-07). A user answered
 * blanks until they stopped, and the only thing that ever said "enough" was
 * the clock. The daily goal gives the day a finish line, and this is the
 * moment it is crossed: the correct answer that takes today's tally to the
 * plan's number raises the card (DayDoneCard), and the same moment is
 * reported so the dashboard can count days finished rather than days
 * opened.
 *
 * DECISION PLUMBING ONLY, the exact shape of saveProgressAsk.ts: the latch
 * and the raise live here, the card subscribes, and RecallHost owns the
 * timing because "after the celebration" is a fact about the feed's
 * animation.
 *
 * ONCE PER LOCAL DAY, persisted. A process latch would re-raise the card on
 * every launch of a day already finished (the sixth correct answer of the
 * evening is not a second win), and a day key rather than a timestamp means
 * a phone that crosses midnight mid-session gets tomorrow's card tomorrow.
 * Under the loro. prefix so the account-deletion and switch-user sweeps take
 * it; '.mobile.' because core does not know it (same convention as the
 * notification keys).
 */
const SHOWN_FOR_KEY = 'loro.mobile.dayDone.shownFor';

export type DayDoneRaise = {
  goal: number;
  /** Today's correct answers at the moment of the raise. */
  count: number;
  /** The streak, today included. */
  streak: number;
  /** Words answered right today, freshest first, one per distinct word. */
  words: SavedWord[];
};

const listeners = new Set<(raise: DayDoneRaise) => void>();

export function subscribeToDayDone(
  listener: (raise: DayDoneRaise) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The latch. Consumes today's one raise if this moment completed the goal:
 * the plumbing shared by the plain celebration below and the review
 * session's end (reviewSession.ts), which shows the day on its own card
 * rather than raising a second one.
 */
export function claimDayDone(now: number = Date.now()): DayDoneRaise | null {
  const { wordsPerDay } = getPlan();
  const count = storage.getTodayCorrect(now);
  if (count < wordsPerDay) return null;

  const today = dayKey(now);
  if (storageDriver.local.getItem(SHOWN_FOR_KEY) === today) return null;
  storageDriver.local.setItem(SHOWN_FOR_KEY, today);

  // Today is in recallDays by now: core logs the day on the answer that
  // reaches the goal (storage noteCorrectToday), so the streak counts it.
  const streak = computeStreaks(storage.getCorrectRecallDays(), now).current;
  const words = answeredCorrectToday(storage.getSavedWords(), now);
  track('goal_met', { goal: wordsPerDay, count, streak });
  console.log(`[loro:day] goal met: ${count}/${wordsPerDay}, streak ${streak}`);
  return { goal: wordsPerDay, count, streak, words };
}

/**
 * Called by RecallHost after the celebration for a CORRECT answer outside
 * a review session. Raises the card if this answer completed today's goal
 * and today has not been celebrated yet; returns whether it raised, so the
 * caller can let the two asks that share the moment (save-progress,
 * notifications) have it instead when it did not.
 */
export function maybeCelebrateDayDone(now: number = Date.now()): boolean {
  const raise = claimDayDone(now);
  if (!raise) return false;
  for (const listener of listeners) listener(raise);
  return true;
}

/** Has today's card already been shown? For the Progress page's copy. */
export function dayDoneShownToday(now: number = Date.now()): boolean {
  return storageDriver.local.getItem(SHOWN_FOR_KEY) === dayKey(now);
}
