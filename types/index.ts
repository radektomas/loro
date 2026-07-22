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

/**
 * CC BY / embed attribution for YouTube-sourced videos. Every field is
 * REQUIRED for a lawful embed slide: name + link is the "A" in TASL, the
 * watch URL is the "S", license drives the visible "CC BY" chip. See the
 * discovery-pipeline section of the README.
 */
export type VideoAttribution = {
  channelTitle: string;
  /** https://www.youtube.com/channel/{channelId} */
  channelUrl: string;
  /** https://www.youtube.com/watch?v={youtubeId} */
  videoUrl: string;
  /** creativeCommon = CC BY 3.0; youtube = standard licence (embed only). */
  license: 'creativeCommon' | 'youtube';
};

/**
 * WHO made a feed slide, and therefore what the attribution line does when
 * tapped. A discriminated union rather than optional fields, because the
 * three cases have genuinely different obligations and must never be
 * collapsed into "maybe there's a handle, maybe there's a channel":
 *
 *  - 'creator'  a Loro creator's own upload. Links INTERNALLY to their
 *               profile at /creator/{handle}.
 *  - 'youtube'  an embedded YouTube video. Links OUT to the channel in a new
 *               tab and NEVER to an internal profile, carries the watch URL
 *               and licence, and its attribution must stay visible — this is
 *               an embed-terms requirement, not a style choice. Carrying the
 *               full TASL set in the variant is what makes it impossible to
 *               render an embed slide with a missing piece.
 *  - 'none'     a static seed clip with no creator behind it. Renders the
 *               plain name with no link — never a dead one.
 */
export type FeedAuthor =
  | {
      kind: 'creator';
      /** loro_creators.user_id — the follow target */
      creatorId: string;
      handle: string;
      displayName: string;
      /** Public avatar URL, or null — the shared Avatar component falls back
          to the initial circle. */
      avatarUrl: string | null;
    }
  | ({ kind: 'youtube' } & VideoAttribution)
  | { kind: 'none' };

export type Video = {
  id: string;
  src: string;
  poster: string;
  /** Display name shown wherever a slide is listed (feed, /progress). Who to
      LINK to is `author` — this is only the label. */
  creator: string;
  author: FeedAuthor;
  level: Level;
  cues: Cue[];
  /** keyed by normalised surface form — see lib/dictionary.ts normalizeSurface() */
  dictionary: Record<string, Gloss>;
  /** Present on YouTube-embed videos; the slide renders the official iframe
      player instead of a <video>, and src is ''. */
  youtubeId?: string;
  /** Known duration for embeds, so the progress bar works before the player
      boots (the iframe reports duration only once created). */
  durationSeconds?: number;
};

/**
 * The minimal media surface the feed actually drives. HTMLVideoElement
 * satisfies it structurally; lib/youtubePlayer.ts implements it over the
 * official YouTube IFrame API. Everything in Feed/SubtitleTrack/ProgressBar
 * is typed against THIS, never against HTMLVideoElement directly — that is
 * what lets one slide play a file and the next play an embed with identical
 * SRS/blank/karaoke behaviour.
 *
 * Contract notes for implementers:
 * - `currentTime` must be readable AND writable, and reads immediately after
 *   a write must reflect the written value (SubtitleTrack re-seats the clock
 *   whenever |currentTime - pauseAt| > 0.05s while paused — an async seek
 *   that lags reads would loop forever).
 * - `play()` must reject with DOMException name 'NotAllowedError' when
 *   playback cannot start without a user gesture (Feed falls back to muted
 *   playback), and 'AbortError' when interrupted by pause() (Feed ignores).
 * - 'play'/'pause'/'loadedmetadata' events must fire like the DOM ones.
 */
export type FeedMedia = {
  currentTime: number;
  readonly paused: boolean;
  muted: boolean;
  readonly duration: number;
  readonly readyState: number;
  readonly preload: string;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  addEventListener(
    type: string,
    listener: () => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(type: string, listener: () => void): void;
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
