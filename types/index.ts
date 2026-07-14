/** A single word with its timing, as produced by Whisper word-level output. */
export type Word = {
  text: string;
  /** seconds */
  start: number;
  /** seconds */
  end: number;
};

/** One subtitle line: timed Spanish words plus full-line translations. */
export type Cue = {
  start: number;
  end: number;
  words: Word[];
  /** language code -> translated line, e.g. { en: "...", cs: "..." } */
  translations: Record<string, string>;
};

export type Level = 'A1' | 'A2' | 'B1' | 'B2';

/**
 * Per-word dictionary entry, built at transcription time. Glosses translate
 * the word AS USED in this video's sentences — short, contextual, per language.
 */
export type Gloss = {
  /** dictionary form: "es" -> "ser" */
  lemma: string;
  /** noun | verb | adj | adv | prep | pron | conj | det | other */
  pos: string;
  /** short learner note (irregular verb, false friend, ...) or null */
  note: string | null;
  /** lang -> short translation, e.g. { en: "girlfriend", cs: "přítelkyně" } */
  glosses: Record<string, string>;
};

export type Video = {
  id: string;
  src: string;
  poster: string;
  creator: string;
  level: Level;
  cues: Cue[];
  /** keyed by normalised surface form — see lib/dictionary.ts normalizeSurface() */
  dictionary: Record<string, Gloss>;
};

/** Lifecycle of a saved word through spaced repetition. */
export type WordState = 'new' | 'learning' | 'known' | 'lapsed';

/**
 * A word the user tapped and saved from the feed, plus its Leitner-box
 * scheduling state. Words are "earned" by typing them back from memory.
 */
export type SavedWord = {
  text: string;
  translation: string;
  videoId: string;
  cueIndex: number;
  /** epoch ms */
  savedAt: number;
  state: WordState;
  /** Leitner box 0-5 */
  box: number;
  /** epoch ms — next moment this word may appear as a blank */
  dueAt: number;
  correct: number;
  incorrect: number;
  lastReviewedAt: number | null;
};
