/**
 * Minimal synchronous event emitter — the platform-agnostic replacement for
 * the window CustomEvent pattern the web modules grew up on. One
 * implementation, used by every in-process bus in core (paywall requests,
 * tier changes, follow changes); do not hand-roll another.
 *
 * The semantics deliberately match DOM event dispatch, because subscribers
 * were written against it:
 *  - emit is SYNCHRONOUS, in subscription order;
 *  - a subscriber added during an emit does not receive the in-flight event;
 *  - a subscriber removed during an emit is not called;
 *  - a throwing subscriber does not stop the rest (the error is reported via
 *    console.error, not rethrown);
 *  - subscribing the same callback twice yields two deliveries, and each
 *    unsubscribe releases exactly one of them.
 */

export type Emitter<T> = {
  emit(value: T): void;
  /** Returns an unsubscribe function. */
  subscribe(callback: (value: T) => void): () => void;
};

export function createEmitter<T>(name: string): Emitter<T> {
  // Each subscription gets its own wrapper, so the same callback subscribed
  // twice yields two deliveries — as two addEventListener handlers did.
  const subscribers = new Set<(value: T) => void>();
  return {
    emit(value: T): void {
      // Snapshot: a subscriber added during dispatch must not see this event.
      for (const subscriber of [...subscribers]) {
        // ...but one removed during dispatch must not be called either.
        if (!subscribers.has(subscriber)) continue;
        try {
          subscriber(value);
        } catch (error) {
          console.error(`${name} subscriber threw`, error);
        }
      }
    },
    subscribe(callback: (value: T) => void): () => void {
      const subscriber = (value: T) => callback(value);
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
}
