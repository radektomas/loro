import { storageDriver } from '../platform/storage';

/**
 * WHERE YOU WERE IN AN EPISODE — device-local, like the shelf choice.
 *
 * Radek, 2026-09-22: "saving where the user last watched, so he sees a
 * progress line and when clicking a video he goes straight to the time he
 * exited last time." Reels never needed this: thirty seconds, swiped past.
 * A shelf of 25 five-minute episodes is a series, and a series that opens
 * on episode 1 every time reads as a pile.
 *
 * Three facts, one key:
 *   - per video: the last position and the length (the line in the list,
 *     the resume point), plus a sticky WATCHED once the end was reached —
 *     sticky so a rewatch from the top does not un-tick it;
 *   - per shelf: the last episode on show, so entering the shelf lands
 *     there instead of at the top.
 *
 * Not synced to the account on purpose: progress sync carries words, and
 * this is a convenience of the phone in hand.
 */
const KEY = 'loro.mobile.episodeProgress';

/** Under this many seconds in, an episode starts from the top again — the
    first seconds are the title card, and "resume at 0:06" is a joke. */
export const RESUME_MIN_S = 15;
/** Past this share of the length the episode counts as watched and the
    next open starts from the top. */
export const WATCHED_SHARE = 0.9;
/** How often the tracker notes the clock while an episode plays. */
export const SAVE_EVERY_MS = 5000;

type Entry = {
  /** Seconds into the video. */
  at: number;
  /** The video's length in seconds, for the share. */
  len: number;
  done: boolean;
  updatedAt: number;
};

type Store = {
  videos: Record<string, Entry>;
  /** shelf id → video id of the episode last on show. */
  last: Record<string, string>;
};

function load(): Store {
  try {
    const raw = storageDriver.local.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>;
      return { videos: parsed.videos ?? {}, last: parsed.last ?? {} };
    }
  } catch {
    // A bad record is not worth a crash on the screen the app opens on.
  }
  return { videos: {}, last: {} };
}

function save(store: Store): void {
  storageDriver.local.setItem(KEY, JSON.stringify(store));
}

export type EpisodeRef = { id: string; durationSeconds?: number };

/**
 * Note the clock. Called every few seconds while an episode plays and once
 * more on the way out (another episode, another tab, the background). A
 * write under a second from the last is skipped: MMKV is cheap, but not
 * free, and the interval already bounds how stale the record can be.
 */
export function noteEpisodePosition(shelf: string, video: EpisodeRef, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const store = load();
  const prev = store.videos[video.id];
  const len = (video.durationSeconds ?? 0) > 0 ? (video.durationSeconds as number) : (prev?.len ?? 0);
  const at = len > 0 ? Math.min(seconds, len) : seconds;
  const done = (prev?.done ?? false) || (len > 0 && at / len >= WATCHED_SHARE);
  const sameLast = store.last[shelf] === video.id;
  if (prev && sameLast && prev.done === done && Math.abs(prev.at - at) < 1) return;
  store.videos[video.id] = { at, len, done, updatedAt: Date.now() };
  store.last[shelf] = video.id;
  save(store);
}

export type EpisodeProgress = {
  /** 0..1 of the length, 1 once watched. */
  share: number;
  done: boolean;
};

/** For the episode list: the line under the thumbnail and the tick. */
export function episodeProgress(videoId: string): EpisodeProgress | null {
  const entry = load().videos[videoId];
  if (!entry) return null;
  if (entry.done) return { share: 1, done: true };
  if (entry.len <= 0 || entry.at < RESUME_MIN_S) return null;
  return { share: Math.min(1, entry.at / entry.len), done: false };
}

/**
 * Where an episode opens: the saved position, unless it is within the first
 * seconds or the episode was watched to the end — both start from the top.
 * A watched episode keeps its tick (the flag is sticky) while its position
 * starts over.
 */
export function resumeSecondsFor(video: EpisodeRef): number {
  const entry = load().videos[video.id];
  if (!entry || entry.at < RESUME_MIN_S) return 0;
  const len = (video.durationSeconds ?? 0) > 0 ? (video.durationSeconds as number) : entry.len;
  if (len > 0 && entry.at / len >= WATCHED_SHARE) return 0;
  return Math.floor(entry.at);
}

/** The episode a shelf was last on, to land there on the way in. */
export function lastEpisodeOf(shelf: string): string | null {
  return load().last[shelf] ?? null;
}

/** The index to open a shelf at: its last episode, or the top. */
export function landingIndexFor(shelf: string, videos: readonly { id: string }[]): number {
  const last = lastEpisodeOf(shelf);
  if (!last) return 0;
  const index = videos.findIndex((v) => v.id === last);
  return index > 0 ? index : 0;
}
