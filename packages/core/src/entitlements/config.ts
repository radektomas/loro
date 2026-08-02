// Relative and extension-ed imports only (there are none yet — this is the
// leaf), so the pure modules that import it load under plain node for their
// tests. Same rule as lib/starterDeck.ts.

/**
 * THE monetization config. Every number the paywall depends on lives here and
 * nowhere else.
 *
 * That is not a style preference. A limit is a product hypothesis, and the only
 * way to test one is to change it in a single place and watch what happens to
 * lib/entitlements/paywallEvents.ts. A "50" copied into a component, a copy
 * string, or a SQL default is a number that will be missed on the day the
 * hypothesis is revised, and the app will then disagree with itself about what
 * a user is allowed to do.
 *
 * WHAT LIVES WHERE:
 *   config.ts   raw values — this file, no logic
 *   plans.ts    getPlans() and every derived price (monthly-equivalent,
 *               discount, formatting). Components read prices from THERE.
 *   limit.ts    the pure limit / grandfathering rules
 *   state.ts    browser tier cache + the paywallActive() runtime verdict
 *   useEntitlements.ts   the single hook components are allowed to ask
 *
 * SHIPPING DARK. PAYWALL_ENABLED is false, so the effective limit is Infinity
 * everywhere and no gate can fire in production. Enabling the paywall is
 * flipping this one line: the columns exist (20260730030000_entitlements.sql),
 * the gate is wired, the modal is built, and the whole surface is exercised in
 * dev via /dev/paywall. Nothing about that flip is a refactor.
 */

/**
 * Saved words at which an ANONYMOUS user is invited to create an account.
 *
 * Not a paywall and never becomes one: it protects progress that already
 * exists (localStorage is evictable — iOS Safari clears it after ~7 days
 * away). lib/savePrompt.ts consumes this; the paywall deliberately starts
 * where this ends, so a user never meets both asks in one step.
 */
export const SAVE_PROMPT_THRESHOLD = 10;

/**
 * Saved words a SIGNED-IN free-tier user may hold.
 *
 * Counts words the USER chose — words we granted are excluded (limit.ts
 * countsTowardLimit, keyed on SavedWord.source). A limit measures growth, and
 * an onboarding gift is not growth: the starter deck hands out up to 9 words,
 * so counting them would spend a fifth of this ceiling before the user had
 * watched a single video.
 */
export const FREE_TIER_SAVED_WORDS_LIMIT = 50;

/**
 * The master switch. `: boolean` rather than an inferred literal on purpose —
 * without the annotation TypeScript narrows this to `false`, and every branch
 * behind the flag becomes dead code the compiler is entitled to complain
 * about, which is a nasty surprise on the day it flips.
 */
export const PAYWALL_ENABLED: boolean = false;

/**
 * Users already above the limit when the paywall is enabled keep unlimited
 * saves — permanently, recorded as loro_profiles.is_grandfathered rather than
 * recomputed, so deleting words can never take it away.
 *
 * The alternative (blocking people who were over the line before the line
 * existed) turns a launch into a punishment for the users who used the product
 * most.
 */
export const GRANDFATHER_EXISTING_USERS: boolean = true;

export type PlanId = 'plus_monthly' | 'plus_annual';
export type PlanInterval = 'month' | 'year';

/** One purchasable plan, as the catalog stores it. Prices are USD. */
export type Plan = {
  id: PlanId;
  interval: PlanInterval;
  priceUsd: number;
  /** Pre-selected and visually emphasised in the paywall. Exactly one. */
  default: boolean;
};

/**
 * The price catalog. USD only today — plans.ts getPlans(region?) is the
 * accessor, and it already takes the region argument it currently ignores, so
 * a per-region table drops in behind it without a single component changing.
 *
 * Nothing derived is stored here. The annual plan's monthly-equivalent and its
 * discount against the monthly plan are computed from these two prices at
 * runtime (plans.ts), because a hardcoded "$5/mo — save 50%" is a copy string
 * that goes quietly wrong the first time a price moves.
 */
export const PLANS: readonly Plan[] = [
  { id: 'plus_monthly', interval: 'month', priceUsd: 9.99, default: false },
  { id: 'plus_annual', interval: 'year', priceUsd: 59.99, default: true },
] as const;

/**
 * Saved-word counts worth an instrumentation event, each fired once ever.
 *
 * Derived from the two thresholds rather than written out, so the funnel's
 * endpoints can never drift from the rules they measure: the first milestone
 * is where the account prompt lands, the last is the wall itself, and 25/40
 * are the interior samples that tell us whether people stall on the way.
 */
export const SAVED_WORDS_MILESTONES: readonly number[] = [
  SAVE_PROMPT_THRESHOLD,
  25,
  40,
  FREE_TIER_SAVED_WORDS_LIMIT,
] as const;
