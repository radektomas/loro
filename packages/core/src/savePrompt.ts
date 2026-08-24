// Relative and extension-ed, not '@/lib/…': this module loads under plain node
// for its test (same rule as lib/starterDeck.ts).
import { SAVE_PROMPT_THRESHOLD } from './entitlements/config.ts';

/**
 * The "save your progress" account prompt — pure decision logic.
 *
 * Loro is anonymous-first: this is a NUDGE to protect existing progress
 * (localStorage is evictable — iOS Safari clears it after ~7 days away),
 * never a gate. Three moments may ask, and only the first two are recorded
 * asks that burn the budget:
 *
 *  1. Vocab prompt 1 (savePromptVariant) — at FIRST_AT_WORDS saved words.
 *  2. Vocab prompt 2 (savePromptVariant) — the final automatic vocab ask.
 *  3. The session-complete moment (sessionPromptVariant) — right after a
 *     review session empties the due queue, on platforms that have a session
 *     boundary surface (mobile; web review is inline in the feed and gets
 *     nothing). It only shows while an automatic prompt is still unresolved,
 *     is snoozable for 7 days device-locally, fires at most once per process,
 *     and its "not now" does NOT record a dismissal — the vocab prompts stay
 *     the only surface that burns the two-ask budget.
 *
 * Once both p1 and p2 are resolved the session card can never show either;
 * after the second dismissal the only remaining entry point is the normal one
 * on /profile.
 *
 * Persistence lives in storage.ts under a loro.-prefixed key, so the
 * account-deletion prefix wipe already covers it. (The session snooze is
 * deliberately NOT in that state: it is a fact about one device's rhythm,
 * stored device-locally by the caller, like the notification snooze.) This
 * module is pure so every rule below is unit-testable.
 */

/**
 * Tuning knobs. These are guesses with the current user count; revisit once
 * save_prompt_stats has real data.
 *
 * FIRST_AT_WORDS is NOT one of them — it is re-exported from
 * lib/entitlements/config.ts, which is the single source of truth for every
 * number the monetization ladder depends on. The account prompt and the
 * free-tier ceiling are the two rungs of that ladder and have to be reasoned
 * about together: the prompt must land before the paywall, and a change to
 * either only makes sense in view of the other. Two copies of "10" in two
 * files is how they silently cross.
 */
export const SAVE_PROMPT = {
  /** Prompt 1: anonymous user has at least this many saved words. */
  FIRST_AT_WORDS: SAVE_PROMPT_THRESHOLD,
  /** Prompt 2 (final): this many saved words… */
  SECOND_AT_WORDS: 25,
  /** …or this many completed recall sessions, whichever comes first. */
  SECOND_AT_SESSIONS: 3,
} as const;

/** 'shown' = pending (sheet open / never resolved). A pending prompt may be
    re-shown; it has not been answered. */
export type PromptOutcome = 'shown' | 'dismissed' | 'converted';

export type PromptRecord = {
  shownAt: number;
  /** Saved-word count at the moment of showing — the measurement payload. */
  words: number;
  outcome: PromptOutcome;
};

export type SavePromptState = {
  /** Completed recall sessions: times the due queue was emptied by grading. */
  sessions: number;
  p1: PromptRecord | null;
  p2: PromptRecord | null;
};

export const EMPTY_SAVE_PROMPT_STATE: SavePromptState = {
  sessions: 0,
  p1: null,
  p2: null,
};

export type PromptContext = {
  signedIn: boolean;
  savedCount: number;
  /** Where the caller is. Only 'vocab' may ever show the prompt — the feed
      is the product and is never interrupted. (The vocab screen is also
      where a completed recall session lands: recall itself runs as feed
      blanks, so "after a session completes" can only surface here.) */
  surface: 'vocab' | 'feed' | 'other';
};

/**
 * Which prompt (if any) to show. Null means show nothing — the overwhelmingly
 * common case.
 */
export function savePromptVariant(
  state: SavePromptState,
  ctx: PromptContext
): 1 | 2 | null {
  if (ctx.surface !== 'vocab') return null;
  if (ctx.signedIn) return null;

  // Prompt 1: not yet answered (null or still pending) and threshold met.
  // The session-completion trigger and the never-reviewed fallback both
  // resolve to this same rule because both can only surface on 'vocab'.
  if (!state.p1 || state.p1.outcome === 'shown') {
    return ctx.savedCount >= SAVE_PROMPT.FIRST_AT_WORDS ? 1 : null;
  }
  if (state.p1.outcome === 'converted') return null; // they have an account

  // Prompt 2 — the final automatic ask.
  if (!state.p2 || state.p2.outcome === 'shown') {
    return ctx.savedCount >= SAVE_PROMPT.SECOND_AT_WORDS ||
      state.sessions >= SAVE_PROMPT.SECOND_AT_SESSIONS
      ? 2
      : null;
  }
  return null; // both prompts resolved — never ask automatically again
}

/** How long "not now" on the session-complete card silences it. A week is the
    floor rather than a target — the ask is cheap to repeat and expensive to
    get wrong (same reasoning as the notification snooze). */
export const SESSION_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionPromptContext = {
  signedIn: boolean;
  /** Device-local snooze timestamp (ms) or null. Deliberately not part of
      SavePromptState — see the header. */
  snoozedAt: number | null;
  /** Process-scoped "already shown this session" latch, owned by the caller. */
  shownThisSession: boolean;
  now: number;
};

/**
 * Which prompt (if any) to show at the moment a review session completes —
 * the due queue just went from >0 to 0. No saved-word threshold: completing a
 * session is the qualifying signal, and the reviewed words are the thing
 * being protected.
 *
 * The returned variant number feeds recordSavePromptShown so measurement
 * stays on the same two prompt records; showing here does not consume an ask
 * (only a vocab dismissal resolves a record), and conversion is flipped by
 * sync when the session actually arrives, never by UI.
 */
export function sessionPromptVariant(
  state: SavePromptState,
  ctx: SessionPromptContext
): 1 | 2 | null {
  if (ctx.signedIn) return null;
  if (ctx.shownThisSession) return null;
  if (
    ctx.snoozedAt !== null &&
    ctx.now - ctx.snoozedAt < SESSION_PROMPT_SNOOZE_MS
  ) {
    return null;
  }
  if (state.p1?.outcome === 'converted' || state.p2?.outcome === 'converted') {
    return null; // they have an account
  }
  if (!state.p1 || state.p1.outcome === 'shown') return 1;
  if (!state.p2 || state.p2.outcome === 'shown') return 2;
  return null; // both prompts resolved — the session card never re-asks
}
