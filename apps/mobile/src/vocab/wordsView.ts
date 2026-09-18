/**
 * WHICH FACE THE WORDS TAB OPENS ON — a request parked by whoever switches
 * to it. The tab is a sibling behind a useState (Shell), so "go to the
 * learned words" is a tab switch plus this. VocabScreen takes the request
 * on the way in and clears it; nothing else reads it.
 */
export type WordsView = 'learning' | 'learned';

let requested: WordsView | null = null;

export function requestWordsView(view: WordsView): void {
  requested = view;
}

export function takeRequestedWordsView(): WordsView | null {
  const view = requested;
  requested = null;
  return view;
}
