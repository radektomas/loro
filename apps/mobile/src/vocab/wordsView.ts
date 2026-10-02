/**
 * WHICH FACE THE WORDS TAB OPENS ON — a request parked by whoever switches
 * to it. The tab is a sibling behind a useState (Shell), so "go to the
 * learned words" is a tab switch plus this. VocabScreen takes the request
 * on the way in and clears it; nothing else reads it.
 */
export type WordsView = 'saved' | 'practice' | 'missed' | 'learned';

let requested: WordsView | null = null;

export function requestWordsView(view: WordsView): void {
  requested = view;
}

export function takeRequestedWordsView(): WordsView | null {
  const view = requested;
  requested = null;
  return view;
}

/**
 * LAND ON THE WORD, not on the city sign — a one-shot request, like the view
 * above. The Words tab normally opens on the sign (the city and its ten
 * words are the view); Progress's "4 words to Barcelona" button asks for
 * the word you are on, because that is what it sends you to do (Radek,
 * 2026-10-02: "it should appear on the word and not on the start of the
 * city").
 */
let focusWord = false;

export function requestWordFocus(): void {
  focusWord = true;
}

export function takeWordFocus(): boolean {
  const v = focusWord;
  focusWord = false;
  return v;
}
