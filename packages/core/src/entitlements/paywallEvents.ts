// Relative and extension-ed, not '@/lib/…': this module loads under plain node
// for its test (same rule as lib/starterDeck.ts).

/**
 * Paywall instrumentation — the pure event model and its shaping rules.
 *
 * WHAT THIS IS FOR. FREE_TIER_SAVED_WORDS_LIMIT is 50 because 50 is a round
 * number, not because anyone knows it is right. Without this log there is no
 * way to tell a limit that converts from a limit that quietly ends sessions:
 * both look identical from the outside. Four things have to be distinguishable —
 *
 *   how far people get             saved_words_count milestones
 *   how often the wall is hit      save_blocked_by_limit
 *   whether the offer lands        paywall_shown -> cta_clicked / dismissed
 *   which plan they reach for      cta_clicked carries the plan id
 *
 * — and the milestones matter most: if most users stall at 25 the ceiling is
 * irrelevant, and if most sail past 50 it is too low. A conversion rate alone
 * cannot tell those apart.
 *
 * ANONYMOUS-FIRST, exactly like saved words and the starter deck funnel:
 * localStorage is the truth, storage.ts appends synchronously, and a
 * sign-in mirrors the log to loro_profiles.paywall_events. Anonymous users are
 * the majority of everyone who will ever see a milestone, and they are the
 * population the limit has to be right for, so no event requires an account.
 * Nothing is ever sent from an anonymous session.
 *
 * Persistence lives in storage.ts under a loro.-prefixed key, so the
 * account-deletion prefix wipe (components/DeleteAccountCard.tsx) already
 * covers it. This module stays pure so the rules below are unit-testable.
 */

export type PaywallEventName =
  /** The paywall modal took the screen. */
  | 'paywall_shown'
  /** The primary CTA was tapped. Carries the selected plan. */
  | 'paywall_cta_clicked'
  /** The modal was dismissed without a CTA tap. */
  | 'paywall_dismissed'
  /** A save was refused because it would exceed the limit. */
  | 'save_blocked_by_limit'
  /** The counted saved-word total reached a milestone. Once each, ever. */
  | 'saved_words_count';

export type PaywallEvent = {
  /**
   * Stable identity, generated on this device when the event is created
   * (storage.ts newEventId). THE MERGE KEY, and never reassigned.
   *
   * Content cannot serve as identity here. Two devices can land the same
   * event in the same millisecond, and the same event legitimately recurs —
   * a user who hits the wall twice at 50 words produces two
   * save_blocked_by_limit entries that are identical in every field but this
   * one. Keying on content would silently collapse them, which is the one
   * user the limit most needs to be measured on.
   */
  id: string;
  name: PaywallEventName;
  /** epoch ms */
  at: number;
  /** paywall_cta_clicked: which plan was selected when the CTA was tapped. */
  planId?: string;
  /**
   * The counted saved-word total at the moment of the event. On a block this is
   * the number that hit the ceiling; on the modal events it is the context that
   * makes a dismissal readable (dismissing at 50 is a different act from
   * dismissing at 12 after a merge).
   */
  savedCount?: number;
  /** saved_words_count: which milestone this is. */
  milestone?: number;
};

/**
 * Log ceiling. Generous: unlike the starter deck (one run, ~25 events), the
 * paywall is met repeatedly over a lifetime, and a user who hits the wall
 * twenty times is the single most interesting user in the dataset.
 */
export const PAYWALL_EVENT_CAP = 200;

/**
 * Append one event.
 *
 * Three rules, all in service of a funnel that can be divided by:
 *
 * 1. A MILESTONE FIRES ONCE, EVER — matched anywhere in the log, not just
 *    against the last entry. Milestones are a distribution ("how far do people
 *    get"), and a user who deletes a word and re-saves it must not be counted
 *    as reaching 50 twice, or the histogram is worthless.
 * 2. NO CONSECUTIVE DUPLICATES of the same name. React effects re-run; a
 *    remounted modal would otherwise log paywall_shown twice and inflate the
 *    denominator every conversion rate is divided by. Non-consecutive repeats
 *    are kept — a second block an hour later is real signal.
 * 3. WHEN FULL, DROP THE NEW EVENT, not the oldest. The early events are the
 *    measurement; a ring buffer would evict the first milestones — the
 *    entry point of the funnel — in favour of late noise.
 */
export function appendPaywallEvent(
  log: readonly PaywallEvent[],
  event: PaywallEvent,
  cap: number = PAYWALL_EVENT_CAP
): PaywallEvent[] {
  if (event.name === 'saved_words_count') {
    const already = log.some(
      (e) => e.name === 'saved_words_count' && e.milestone === event.milestone
    );
    if (already) return log as PaywallEvent[];
  } else {
    const last = log[log.length - 1];
    if (last && last.name === event.name) return log as PaywallEvent[];
  }
  if (log.length >= cap) return log as PaywallEvent[];
  return [...log, event];
}

/**
 * Identity of an event for the merge: its id, nothing else.
 *
 * The fallback covers a log written before ids existed — content is the best
 * available key for those, and it is only ever wrong in the direction of
 * collapsing two genuinely distinct legacy events, which is preferable to
 * treating every id-less entry as the same one. Never synthesised here: a
 * fabricated id would look stable and would not be, so the same event would
 * duplicate on every merge.
 */
function eventKey(e: PaywallEvent): string {
  return e.id
    ? `id:${e.id}`
    : `legacy:${e.name} ${e.milestone ?? ''} ${e.planId ?? ''} ${e.at}`;
}

/**
 * Union two logs, oldest first.
 *
 * A UNION, not a replace — and this is where paywall events differ from
 * save_prompt_stats, which is a small fixed record and can be pushed blind. The
 * paywall is met over a lifetime across every device the user owns, and a
 * phone's blocks are as real as a laptop's; a blind push would delete whichever
 * half went second and understate exactly the number the limit is judged on.
 *
 * IDEMPOTENT by id, which is what makes the sign-in path safe: a retried push,
 * a doubled auth event, or a merge that already ran converges instead of
 * duplicating. First writer wins for a repeated id, so re-merging can never
 * swap a stored event for a different one wearing the same identity.
 *
 * Ties on `at` break by id, so the order is deterministic rather than dependent
 * on which log happened to be passed first.
 */
export function mergePaywallEvents(
  a: readonly PaywallEvent[],
  b: readonly PaywallEvent[],
  cap: number = PAYWALL_EVENT_CAP
): PaywallEvent[] {
  const byKey = new Map<string, PaywallEvent>();
  for (const e of [...a, ...b]) {
    const key = eventKey(e);
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return [...byKey.values()]
    .sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, cap);
}

/** Drop anything that isn't a well-formed event — the stored value is JSON
    from an older build or another device, never trusted shape. */
export function sanitizePaywallLog(raw: unknown): PaywallEvent[] {
  if (!Array.isArray(raw)) return [];
  const names: readonly PaywallEventName[] = [
    'paywall_shown',
    'paywall_cta_clicked',
    'paywall_dismissed',
    'save_blocked_by_limit',
    'saved_words_count',
  ];
  const out: PaywallEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Partial<PaywallEvent>;
    if (typeof e.name !== 'string') continue;
    if (!names.includes(e.name as PaywallEventName)) continue;
    if (typeof e.at !== 'number') continue;
    out.push({
      // An entry with no id keeps '' and merges on the legacy content key.
      // Never synthesised here — see eventKey.
      id: typeof e.id === 'string' ? e.id : '',
      name: e.name as PaywallEventName,
      at: e.at,
      ...(typeof e.planId === 'string' ? { planId: e.planId } : {}),
      ...(typeof e.savedCount === 'number' ? { savedCount: e.savedCount } : {}),
      ...(typeof e.milestone === 'number' ? { milestone: e.milestone } : {}),
    });
  }
  return out;
}
