'use client';

/**
 * The one-line seam between "a save was refused" and "the paywall is on
 * screen": a window event, and a single host component that listens for it
 * (components/paywall/PaywallHost.tsx, mounted once in app/layout.tsx).
 *
 * WHY AN EVENT RATHER THAN A PROP. The gate lives in storage.saveWord(), which
 * is called from the feed's word sheet, the glossary sheet, and anything added
 * later. Threading a paywall callback down to each of those would mean editing
 * every save surface — including components/Feed.tsx, which is mid-refactor —
 * and would leave the next save site free to forget. With the host mounted at
 * the root, a refused save opens the paywall from wherever it happened, and a
 * new save surface inherits the behaviour by doing nothing at all.
 *
 * The event is a NOTIFICATION, not the decision. storage.saveWord() has already
 * refused and already logged save_blocked_by_limit by the time this fires; the
 * host's only job is presentation. Nothing here can grant or deny anything.
 */

const PAYWALL_REQUESTED = 'loro:paywall-requested';

/**
 * Why the paywall is being shown. The modal's copy branches on it, because the
 * two entry points arrive at very different moments:
 *
 *  - 'save_limit'  a save was just refused. The user wanted to DO something and
 *                  could not; the copy has to say what happened and promise
 *                  that what they already have is untouched.
 *  - 'statistics'  they tapped a locked panel out of curiosity. Nothing was
 *                  taken from them and nothing is broken, so an apology would
 *                  be strange — this is just an offer.
 *
 * One modal with two openings, rather than two modals: the plans, the derived
 * prices and the instrumentation must not be duplicated.
 */
export type PaywallReason = 'save_limit' | 'statistics';

export type PaywallRequest = {
  reason: PaywallReason;
  /** The counted saved-word total. On a block, the number that hit the ceiling. */
  savedCount: number;
  /**
   * The limit in force. Passed rather than re-derived so the modal cannot
   * disagree with the gate that refused the save — and Infinity-safe, because
   * the statistics entry point can be reached by a user who is nowhere near a
   * ceiling.
   */
  limit: number;
};

/** Ask the host to show the paywall. Safe to call outside the browser (no-op)
    and safe to call when no host is mounted (nothing listens; nothing breaks). */
export function requestPaywall(request: PaywallRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PaywallRequest>(PAYWALL_REQUESTED, { detail: request })
  );
}

/** Subscribe to paywall requests. Returns an unsubscribe function. */
export function onPaywallRequested(
  callback: (request: PaywallRequest) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    callback((e as CustomEvent<PaywallRequest>).detail);
  };
  window.addEventListener(PAYWALL_REQUESTED, handler);
  return () => window.removeEventListener(PAYWALL_REQUESTED, handler);
}
