import { storageDriver } from './storage';
import { track } from './analytics';

/**
 * APPLE'S RATING PROMPT, AT A HAPPY MOMENT (Radek, 2026-11-18). Until this
 * the app never asked for a rating at all, and ratings are what App Store
 * search and the product page's conversion run on, so these are free
 * installs.
 *
 * WHEN, and only these two, both right after something went well:
 *   city      the arrival window closed on the 2nd city or later (Sevilla,
 *             stage 1, can land on day 0 before anyone has an opinion)
 *   dayDone   the daily goal met on a SECOND distinct day: they came back
 *             and did it again, which is the person whose stars we want
 *
 * HOW OFTEN: at most once per MIN_GAP_DAYS from our side. Apple caps the
 * system sheet at 3 a year per user and decides on its own whether to show
 * it at all, so a request is a request, not a display. The event logs the
 * request; nothing can tell us whether the sheet appeared or what they gave.
 *
 * NATIVE ONLY, NO PRE-PROMPT. No "Enjoying Loro?" card in front of it:
 * App Store guideline 5.6.1 wants the system API, and filtering who gets
 * asked by a mood question first is the review-gating Apple rejects.
 *
 * Lazy require behind a try, like notifications.ts: a dev client built
 * before expo-store-review was added has no native module, and that must
 * cost a log line, never a crash at a celebration.
 */
declare const require: (id: string) => unknown;

type Seam = typeof import('expo-store-review');

let seam: Seam | null | undefined;
function getSeam(): Seam | null {
  if (seam !== undefined) return seam;
  try {
    seam = require('expo-store-review') as Seam;
  } catch (error) {
    seam = null;
    console.warn('[loro:rating] expo-store-review unavailable (rebuild required?)', String(error));
  }
  return seam;
}

const KEYS = {
  /** ms of our last request. */
  askedAt: 'loro.mobile.rating.askedAt',
  /** Day keys (YYYY-MM-DD, local) on which the daily goal was met, newest last, capped. */
  goalDays: 'loro.mobile.rating.goalDays',
} as const;

const MIN_GAP_DAYS = 120;
const DAY_MS = 86_400_000;
/** The city arrival is a Modal; iOS presents the sheet on the top view
    controller, so wait for the window to be gone. The goal dots' cheer runs
    about as long. */
const SETTLE_MS = 1200;

export type RatingMoment = 'city' | 'dayDone';

function recentlyAsked(now: number): boolean {
  try {
    const raw = storageDriver.local.getItem(KEYS.askedAt);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) && now - at < MIN_GAP_DAYS * DAY_MS;
  } catch {
    return true;
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;

function request(from: RatingMoment, detail: Record<string, number>): void {
  const now = Date.now();
  if (pending || recentlyAsked(now)) return;
  const api = getSeam();
  if (!api) return;
  pending = setTimeout(() => {
    pending = null;
    void (async () => {
      try {
        if (!(await api.isAvailableAsync())) return;
        storageDriver.local.setItem(KEYS.askedAt, String(Date.now()));
        track('rating_requested', { from, ...detail });
        await api.requestReview();
      } catch (error) {
        console.warn('[loro:rating] requestReview failed', String(error));
      }
    })();
  }, SETTLE_MS);
}

/** VocabScreen, when the arrival window closes on `stage`. */
export function noteCityArrivalClosed(stage: number): void {
  if (stage >= 2) request('city', { stage });
}

/** dayDone.ts, when today's goal is claimed (once a day by construction). */
export function noteGoalDay(day: string): void {
  let days: string[] = [];
  try {
    const raw = storageDriver.local.getItem(KEYS.goalDays);
    days = raw ? (JSON.parse(raw) as string[]) : [];
    if (!Array.isArray(days)) days = [];
    if (!days.includes(day)) {
      days = [...days, day].slice(-10);
      storageDriver.local.setItem(KEYS.goalDays, JSON.stringify(days));
    }
  } catch {
    return;
  }
  if (days.length >= 2) request('dayDone', { goalDays: days.length });
}

/** DEV: ask now, every gate skipped but the native one. */
export function devRequestRating(): void {
  void getSeam()?.requestReview();
}
