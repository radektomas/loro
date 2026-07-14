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

export type Video = {
  id: string;
  src: string;
  poster: string;
  creator: string;
  level: Level;
  cues: Cue[];
};

/** A word the user tapped and saved from the feed. */
export type SavedWord = {
  text: string;
  translation: string;
  videoId: string;
  cueIndex: number;
  /** epoch ms */
  savedAt: number;
  timesSeen: number;
};
