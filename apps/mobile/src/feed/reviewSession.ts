import { track } from '../platform/analytics';
import { getPlan } from '../progress/plan';
import { claimDayDone, type DayDoneRaise } from './dayDone';
import type { ReviewSource } from './launchReview';

/**
 * THE REVIEW SESSION — a beginning, a size, and an end.
 *
 * Until 2026-09-07 a Review tap dropped the user into the armed feed and
 * nothing ever said "that's it": the only ending in the app was the
 * day-done card, and on a day whose goal was already met a five-word review
 * ended the way every feed session ended — by putting the phone down. So
 * this gives the launch a session: it is SIZED at the daily goal (Radek:
 * "this should be the limit … the 5 words"), it counts every graded blank
 * — a recall AND a level fill, both are typed production — and it ends in
 * one of two ways:
 *
 *   'size'    the goal's number of blanks has been answered;
 *   'ranOut'  the user swiped past the last of the lifted videos (the
 *             landing plus the due videos the feed put behind it —
 *             liftDueBlock) with fewer than that answered. That is the
 *             feed's honest "no more of your words in a video right now".
 *
 * Either way the card says what happened (DayDoneCard, session face). A
 * session left with NOTHING answered ends silently: "0 reviewed" is not a
 * moment. One that goes quiet for half an hour is forgotten, so a card
 * cannot pop up days later on a stray swipe past an old block.
 *
 * THE PLAIN FEED HAS SESSIONS TOO. The first cut started one only from a
 * Review tap; Radek then filled five level words in the ordinary feed and
 * got nothing — "no congratulations that I filled up 5 words". Five
 * answers is the unit he thinks in, wherever they happen. So a graded
 * blank with no session running starts one (source 'feed', no block — it
 * ends by count or by going stale), and every fifth answer in the feed is
 * a card. A Review tap replaces whatever is running with a sized, blocked
 * one.
 *
 * THE DAY-DONE MOMENT FOLDS IN. While a session is running the goal is
 * usually met by its last answer, and two cards in one sitting is one too
 * many — so RecallHost lets the day-done wait (reviewSessionActive) and the
 * session's end claims it (claimDayDone) and shows it on the same card.
 *
 * MODULE STATE, LIKE reviewTarget.ts: the launch happens on another tab,
 * the answers happen in RecallHost, the swipes in FeedScreen, and none of
 * them share a parent that should re-render for this.
 */
export type SessionWord = { text: string; correct: boolean };

/** Where the session came from: a Review door, or just the feed. */
export type SessionSource = ReviewSource | 'feed';

export type ReviewSessionEnd = {
  source: SessionSource;
  /** The goal the session was sized at. */
  size: number;
  answered: number;
  correct: number;
  /** In the order they were answered. */
  words: SessionWord[];
  reason: 'size' | 'ranOut';
  /**
   * This session also finished the day — shown on the card. Filled in by
   * raiseReviewEnd, NOT when the session finishes: the raise can be a
   * celebration later than the grade, and the first cut claimed the day's
   * one card at the grade, so a raise that never came (a second grade
   * inside the celebration cleared the timer) burned the day silently.
   */
  dayDone: DayDoneRaise | null;
};

type Session = {
  source: SessionSource;
  size: number;
  lastAt: number;
  answered: number;
  correct: number;
  words: SessionWord[];
  /** The lifted videos' ids, once the feed has cut them; null = unknown. */
  block: Set<string> | null;
  /** The feed has reached the block — swipes before that are the jump. */
  landed: boolean;
};

/** A session nobody has touched for this long is over, silently. */
const STALE_MS = 30 * 60 * 1000;

let current: Session | null = null;
const listeners = new Set<(end: ReviewSessionEnd) => void>();

export function startReviewSession(source: SessionSource, size: number): void {
  current = {
    source,
    size: Math.max(1, size),
    lastAt: Date.now(),
    answered: 0,
    correct: 0,
    words: [],
    block: null,
    landed: false,
  };
  console.log(`[loro:session] started from ${source}, size ${current.size}`);
}

/** The feed, after liftDueBlock: which videos the session lives in. */
export function setReviewSessionBlock(ids: readonly string[]): void {
  if (current) current.block = new Set(ids);
}

function alive(now: number): Session | null {
  if (current && now - current.lastAt > STALE_MS) {
    console.log('[loro:session] stale — forgotten');
    current = null;
  }
  return current;
}

export function reviewSessionActive(now: number = Date.now()): boolean {
  return alive(now) !== null;
}

function finish(s: Session, reason: ReviewSessionEnd['reason']): ReviewSessionEnd {
  current = null;
  const end: ReviewSessionEnd = {
    source: s.source,
    size: s.size,
    answered: s.answered,
    correct: s.correct,
    words: s.words,
    reason,
    dayDone: null,
  };
  console.log(
    `[loro:session] ended (${reason}): ${end.correct}/${end.answered} right of ${end.size}`
  );
  return end;
}

/**
 * One graded blank. Returns the session's end when this was its last
 * answer — the caller raises it AFTER the celebration (RecallHost), which
 * is why raising is a separate call.
 */
export function noteReviewAnswer(
  text: string,
  correct: boolean,
  now: number = Date.now()
): ReviewSessionEnd | null {
  let s = alive(now);
  if (!s) {
    // No door was tapped: the feed itself is the session (header note).
    startReviewSession('feed', getPlan().wordsPerDay);
    s = current as Session;
  }
  s.lastAt = now;
  s.answered++;
  if (correct) s.correct++;
  s.words.push({ text, correct });
  if (s.answered < s.size) return null;
  return finish(s, 'size');
}

/**
 * The active slide changed. Inside the block: nothing. Past it: the session
 * ends — with a card if anything was answered, silently if not.
 */
export function noteReviewSlide(videoId: string, now: number = Date.now()): ReviewSessionEnd | null {
  const s = alive(now);
  if (!s || s.block === null) return null;
  if (s.block.has(videoId)) {
    s.landed = true;
    s.lastAt = now;
    return null;
  }
  if (!s.landed) return null; // still on the way to the landing
  if (s.answered === 0) {
    console.log('[loro:session] left the block with nothing answered — no card');
    current = null;
    return null;
  }
  return finish(s, 'ranOut');
}

/**
 * Show the end. THIS is where the day is claimed (see ReviewSessionEnd.
 * dayDone), and where the event is logged, so both describe what the user
 * actually saw.
 */
export function raiseReviewEnd(end: ReviewSessionEnd, now: number = Date.now()): void {
  const shown: ReviewSessionEnd = { ...end, dayDone: claimDayDone(now) };
  track('review_ended', {
    source: shown.source,
    size: shown.size,
    answered: shown.answered,
    correct: shown.correct,
    reason: shown.reason,
    dayDone: shown.dayDone !== null,
  });
  for (const listener of listeners) listener(shown);
}

export function subscribeToReviewEnd(listener: (end: ReviewSessionEnd) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
