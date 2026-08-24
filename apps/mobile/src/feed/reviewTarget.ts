/**
 * "Review THIS word" — the one-slot channel between the Words tab and the
 * feed.
 *
 * WHY A MODULE-SCOPED BUS rather than props through Shell: this is a
 * navigation intent, not state. It is written once, consumed once, and nobody
 * re-renders because of it — exactly the shape the notification route already
 * uses (platform/notifications.ts subscribeToNotificationRoute), and for the
 * same reason: Shell is three sibling tabs behind a useState, so there is no
 * navigator to hand a param to.
 *
 * WHY IT IS PARKED RATHER THAN JUST EMITTED. The feed may not be mounted, or
 * may not have its catalog yet, at the moment Words asks. So the request sits
 * here until something takes it — the same drain-on-subscribe the notification
 * route needed for a cold start.
 *
 * ONE SLOT, LAST WRITE WINS: a second request before the first is consumed
 * replaces it. Two pending jumps would mean the feed scrolling twice, and the
 * newer tap is always the one the user meant.
 */

export type ReviewTarget = {
  /** The video to scroll to — one that SPEAKS the word, not necessarily the
      one the word was saved from (recall is cross-video). */
  videoId: string;
  /** For logging, and so the feed can say what it jumped for. */
  word: string;
};

let parked: ReviewTarget | null = null;
const listeners = new Set<(target: ReviewTarget) => void>();

/** Ask the feed to jump. Safe to call whether or not the feed is mounted. */
export function requestReviewTarget(target: ReviewTarget): void {
  parked = target;
  for (const listener of listeners) listener(target);
}

/**
 * Take the parked request, if any. Consuming CLEARS it: a jump that already
 * happened must not fire again when the feed remounts or the tab is revisited.
 */
export function consumeReviewTarget(): ReviewTarget | null {
  const target = parked;
  parked = null;
  return target;
}

/** Subscribe/drain pair. Fires immediately if a request is already parked. */
export function subscribeToReviewTarget(
  listener: (target: ReviewTarget) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
