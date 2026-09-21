import type { SavedWord } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { distinctWords, isLearned, learnedThisWeek } from '@loro/core/progress';
import { normalizeAnswer } from '@loro/core/srs';
import { track } from '../platform/analytics';

/**
 * THE WORD-LEARNED MOMENT — a toast the instant a word crosses into learned.
 *
 * Radek, 2026-09-18: "when a user learns a word, meaning he repeated it 3
 * times, it could be a toast that hey you learned this word". The app had
 * every other win covered — the day, the session, the ladder — but the one
 * that happens most, a single word earned, went by in silence: the row
 * quietly moved to the bottom of the Words tab under LEARNED.
 *
 * "Learned" is core's isLearned (right on different days, from memory),
 * folded per SURFACE the way the Progress count folds: "casa" saved from
 * two videos is one word, and it is learned the first time either row
 * crosses. The caller asks before and after a grade, at the surface level,
 * so a second row of an already-learned word cannot raise a second toast.
 */
export type WordLearnedRaise = {
  text: string;
  translation: string;
  /** Distinct words on the Learned face, this one included — the Words
      tab's own total, so Loro and the tab say the same number. */
  learned: number;
  /** Earned this week (Mon..Sun), this one included. */
  week: number;
};

const listeners = new Set<(raise: WordLearnedRaise) => void>();

/**
 * BELONGS ON THE LEARNED FACE. Earned (core isLearned) OR filed as known
 * — a starter-deck word the user said they knew is a word they know, and
 * Radek wants it with the others, not in the Learning list (2026-09-18:
 * "some of the known words are still kept in the learning side"). A
 * slipped word is out until it is earned back, whatever its history: it
 * belongs under Slipped, where it gets fixed. The Progress hero number
 * stays core's isLearned — earned only.
 */
export function onLearnedFace(word: SavedWord): boolean {
  return word.state !== 'lapsed' && (isLearned(word) || word.state === 'known');
}

/** Distinct words on the Learned face — what the Words tab counts. */
export function learnedTotal(words: readonly SavedWord[] = storage.getSavedWords()): number {
  let n = 0;
  for (const w of distinctWords(words)) if (onLearnedFace(w)) n++;
  return n;
}

/** Earned this week — the Progress page's "learned this week". */
export function learnedWeek(words: readonly SavedWord[] = storage.getSavedWords()): number {
  return learnedThisWeek(words, Date.now()).length;
}

/** Is this SURFACE learned through any of its rows? */
export function surfaceLearned(text: string, words: readonly SavedWord[]): boolean {
  const key = normalizeAnswer(text);
  if (!key) return false;
  return words.some((w) => normalizeAnswer(w.text) === key && isLearned(w));
}

/** After a grade: raise the toast for a word that just crossed. */
export function raiseWordLearned(word: Pick<SavedWord, 'text' | 'translation'>): WordLearnedRaise {
  const words = storage.getSavedWords();
  const raise: WordLearnedRaise = {
    text: word.text,
    translation: word.translation,
    learned: learnedTotal(words),
    week: learnedWeek(words),
  };
  track('word_learned', { learned: raise.learned });
  console.log(`[loro:learned] "${word.text}" — ${raise.learned} learned`);
  for (const l of listeners) l(raise);
  return raise;
}

export function subscribeToWordLearned(
  listener: (raise: WordLearnedRaise) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** DEV: show the moment with a made-up word and the REAL counts. */
export function devRaiseWordLearned(): void {
  const words = storage.getSavedWords();
  const raise = {
    text: 'mochila',
    translation: 'backpack',
    learned: learnedTotal(words) + 1,
    week: learnedWeek(words) + 1,
  };
  for (const l of listeners) l(raise);
}
