import { dayKey } from '@loro/core/progress';
import { storageDriver } from '../platform/storage';

/**
 * "HOW'S LORO SO FAR?" — WHEN IT IS ASKED (Radek, 2026-11-18). The card is
 * FeedbackCard.tsx; the Progress tab's "Send feedback" row opens the same
 * card any time.
 *
 * ON THE FIRST DAY, NOT LATER. From 2026-10-14 to 11-18, 11 of 19 trial
 * users never opened the app after day 0, so an ask on day 2 or a second
 * day-done would only ever hear from the few who stayed. The ones who leave
 * are the ones worth hearing.
 *
 *   first day   after the FIRST_DAY_VIDEOS-th video reached (trial users'
 *               day-0 median was 7, so 4 catches most of them while they
 *               have seen enough to have an opinion)
 *   later day   after the LATER_DAY_VIDEOS-th video of that day, for anyone
 *               who left before the first-day count (it also covers
 *               installs from before this shipped: their "first day" is the
 *               first day on this version, which asks them once too)
 *
 * ONCE PER INSTALL, answered or not ("Not now" is recorded as an answer).
 *
 * THE BUS IS A PENDING FLAG, NOT A MOMENT. The count can land while another
 * card is up or the walkthrough is running; the card waits for the screen to
 * be free (FeedbackCard's `blocked`) and then shows on its own.
 */
const KEYS = {
  firstDay: 'loro.mobile.feedback.firstDay',
  asked: 'loro.mobile.feedback.asked',
  today: 'loro.mobile.feedback.videosToday', // "YYYY-MM-DD:n"
} as const;

const FIRST_DAY_VIDEOS = 4;
const LATER_DAY_VIDEOS = 2;

export type FeedbackFrom = 'day0' | 'progress';

/** A set, so a Progress tap cannot overwrite a day-0 ask still waiting. */
const pending = new Set<FeedbackFrom>();
const listeners = new Set<() => void>();

export function subscribeToFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A card takes the waiting ask if it is the kind that card hosts: the
    feed's card the day-0 ask, Progress's card its own row's. */
export function takeFeedback(kind: FeedbackFrom): boolean {
  return pending.delete(kind);
}

function raise(from: FeedbackFrom): void {
  pending.add(from);
  for (const listener of listeners) listener();
}

function get(key: string): string | null {
  try {
    return storageDriver.local.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string): void {
  try {
    storageDriver.local.setItem(key, value);
  } catch {}
}

/** Videos already counted this launch: swiping back is not another video. */
const counted = new Set<string>();

/** Called when a video takes the screen in the feed (FeedScreen's watched effect). */
export function noteVideoForFeedback(videoId: string, now: number = Date.now()): void {
  if (counted.has(videoId)) return;
  counted.add(videoId);
  if (get(KEYS.asked) !== null) return;
  const today = dayKey(now);
  let firstDay = get(KEYS.firstDay);
  if (firstDay === null) {
    firstDay = today;
    set(KEYS.firstDay, today);
  }
  const [day, raw] = (get(KEYS.today) ?? '').split(':');
  const count = (day === today ? Number(raw) || 0 : 0) + 1;
  set(KEYS.today, `${today}:${count}`);
  const due = firstDay === today ? count >= FIRST_DAY_VIDEOS : count >= LATER_DAY_VIDEOS;
  if (!due) return;
  // Latched at the raise, like the widget card: a crash or a reload between
  // here and the card must not turn one ask into two.
  set(KEYS.asked, String(now));
  raise('day0');
}

/** Progress → "Send feedback". Always opens, any day, any number of times. */
export function openFeedback(): void {
  raise('progress');
}

/** How many videos so far today: logged with the answer, for context. */
export function videosToday(now: number = Date.now()): number {
  const [day, raw] = (get(KEYS.today) ?? '').split(':');
  return day === dayKey(now) ? Number(raw) || 0 : 0;
}

/** DEV: the card now, no latch touched. */
export function devRaiseFeedback(): void {
  raise('day0');
}
