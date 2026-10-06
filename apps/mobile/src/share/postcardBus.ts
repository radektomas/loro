/**
 * Open the postcard for arriving at `stage` from anywhere inside the Words
 * tab (a city's panel on the trip map). VocabScreen listens and draws the
 * PostcardLayer at its root, where an absolute layer covers the whole screen
 * instead of the scroll view it was tapped in.
 */
const listeners = new Set<(stage: number) => void>();

export function requestPostcard(stage: number): void {
  for (const l of listeners) l(stage);
}

export function subscribeToPostcard(listener: (stage: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
