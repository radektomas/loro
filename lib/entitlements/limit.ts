// Relative and extension-ed, not '@/lib/…': this module loads under plain node
// for its test (same rule as lib/starterDeck.ts).
import {
  FREE_TIER_SAVED_WORDS_LIMIT,
  GRANDFATHER_EXISTING_USERS,
  SAVED_WORDS_MILESTONES,
} from './config.ts';
import type { WordSource } from '../../types/index.ts';

/**
 * The entitlement rules, pure.
 *
 * Everything here is a function of explicit inputs — no localStorage, no
 * Supabase, no NODE_ENV — so every rule below is unit-testable and there is
 * exactly one implementation of "can this user save another word". The
 * impure parts (who is signed in, what tier they are, whether the flag is on)
 * live in state.ts and are passed in.
 */

export type Tier = 'free' | 'plus';

/** Everything the limit depends on. */
export type EntitlementInput = {
  /** Is the paywall live at all? PAYWALL_ENABLED, or forced on in dev. */
  paywallActive: boolean;
  /** null = not a gated identity: anonymous, or signed in with the tier not
      yet read. Both resolve to unlimited — see below and state.ts
      paywallIdentity(). */
  tier: Tier | null;
  isGrandfathered: boolean;
};

/**
 * The effective saved-word ceiling. Infinity means "no limit" and is the
 * answer in every case but one.
 *
 * Infinity rather than a sentinel like -1 or null: it makes `count < limit`,
 * `limit - count` and `count / limit` all behave, so no caller needs a special
 * case to avoid rendering "-1 words left".
 *
 * ANONYMOUS USERS ARE NOT PAYWALLED. They already have an ask at
 * SAVE_PROMPT_THRESHOLD — "sign in so you don't lose these" — and stacking a
 * purchase on top of an account prompt asks a stranger for money before the
 * product has proven anything. It would also be unenforceable: localStorage is
 * the user's own. So the paywall applies only to signed-in free-tier users, and
 * that rule lives here rather than in whichever component happens to remember.
 */
export function effectiveLimit(input: EntitlementInput): number {
  if (!input.paywallActive) return Infinity;
  if (input.tier === null) return Infinity; // anonymous / unknown — never gated
  if (input.tier === 'plus') return Infinity;
  if (input.isGrandfathered) return Infinity;
  return FREE_TIER_SAVED_WORDS_LIMIT;
}

/** Slots left. Infinity-safe: unlimited stays unlimited, never NaN or -1. */
export function remainingSaves(savedCount: number, limit: number): number {
  if (!Number.isFinite(limit)) return Infinity;
  return Math.max(0, limit - savedCount);
}

/** May the user add ANOTHER word? The single question the save gate asks. */
export function canSaveMore(savedCount: number, limit: number): boolean {
  return savedCount < limit;
}

/**
 * Does this word count against a gate?
 *
 * Only words the user CHOSE. Words we handed them — the starter deck's rounds
 * and the calibration escape hatch, both `source: 'deck'` — do not count, at
 * either gate. A gate measures demonstrated behaviour, and a gift is not
 * behaviour: the deck grants 9 words and the account prompt fires at 10, so
 * counting grants would make a beginner's very FIRST real save trip the
 * prompt, and (once the paywall is live) would spend a fifth of a 50-word
 * ceiling before they had watched anything.
 *
 * KEYED ON `source`, NOT ON videoId. This used to test
 * `videoId !== STARTER_VIDEO_ID`, which worked only while deck words were
 * saved against a pseudo video id. The reworked deck teaches over real clips,
 * so its words carry real ids and are indistinguishable by video — the whole
 * reason SavedWord.source exists (see types/index.ts).
 */
export function countsTowardLimit(word: { source: WordSource }): boolean {
  return word.source !== 'deck';
}

/**
 * The counted total, from whatever the caller holds.
 *
 * THE one counter behind both gates — the free-tier ceiling here and the
 * account prompt in components/SavePromptSheet.tsx — so the two can never
 * drift into counting different things.
 */
export function countedSaved(
  words: readonly { source: WordSource }[]
): number {
  let n = 0;
  for (const w of words) if (countsTowardLimit(w)) n++;
  return n;
}

/**
 * Should this user be grandfathered into unlimited saves?
 *
 * "Already above the line when the line appeared" — strictly above, so a user
 * sitting exactly at the limit is treated as a normal free user who has used
 * up their allowance, not as a legacy case.
 *
 * The verdict is evaluated once and then STORED (loro_profiles.is_grandfathered)
 * precisely because this function's answer changes when words are deleted. A
 * user who earned unlimited saves and then tidied their vocab list must not
 * quietly lose the entitlement, so nothing may call this to re-decide an
 * existing `true`.
 */
export function shouldGrandfather(input: {
  paywallActive: boolean;
  tier: Tier | null;
  isGrandfathered: boolean;
  /** The counted total — countedSaved(), not words.length. */
  savedCount: number;
}): boolean {
  if (!GRANDFATHER_EXISTING_USERS) return false;
  if (!input.paywallActive) return false;
  if (input.tier !== 'free') return false; // anonymous or already paying
  if (input.isGrandfathered) return true; // already granted — never re-decided
  return input.savedCount > FREE_TIER_SAVED_WORDS_LIMIT;
}

/**
 * Which milestone (if any) a save just crossed.
 *
 * Exact equality on the NEW count, so one save fires at most one milestone and
 * a milestone can only be reached by passing through it. A user who arrives at
 * 52 words via a merge-on-signin jump skips the 50 event rather than firing all
 * four at once, which keeps the funnel a record of saves rather than of syncs.
 */
export function milestoneFor(savedCount: number): number | null {
  return SAVED_WORDS_MILESTONES.includes(savedCount) ? savedCount : null;
}
