import type { SavedWord } from '@/types';

/**
 * Typed persistence layer for Loro.
 *
 * Everything goes through this module so the localStorage backend can be
 * swapped for Supabase (or any remote store) later without touching UI code.
 * Keep the API promise-free for now; when the backend becomes async, callers
 * are few and easy to migrate.
 */

const KEYS = {
  savedWords: 'loro.savedWords',
  language: 'loro.language',
  unmuted: 'loro.session.unmuted', // sessionStorage — per-session only
} as const;

const isBrowser = typeof window !== 'undefined';

function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable — silently drop, this is best-effort
  }
}

export const storage = {
  getSavedWords(): SavedWord[] {
    return readJSON<SavedWord[]>(KEYS.savedWords, []);
  },

  /**
   * Save a word. If the same word from the same video already exists,
   * bump its timesSeen instead of duplicating.
   */
  saveWord(word: Omit<SavedWord, 'savedAt' | 'timesSeen'>): SavedWord[] {
    const words = storage.getSavedWords();
    const existing = words.find(
      (w) => w.text === word.text && w.videoId === word.videoId
    );
    let next: SavedWord[];
    if (existing) {
      next = words.map((w) =>
        w === existing ? { ...w, timesSeen: w.timesSeen + 1 } : w
      );
    } else {
      next = [...words, { ...word, savedAt: Date.now(), timesSeen: 1 }];
    }
    writeJSON(KEYS.savedWords, next);
    return next;
  },

  removeWord(text: string, videoId: string): SavedWord[] {
    const next = storage
      .getSavedWords()
      .filter((w) => !(w.text === text && w.videoId === videoId));
    writeJSON(KEYS.savedWords, next);
    return next;
  },

  getLanguage(): string {
    if (!isBrowser) return 'en';
    return window.localStorage.getItem(KEYS.language) ?? 'en';
  },

  setLanguage(code: string): void {
    if (!isBrowser) return;
    window.localStorage.setItem(KEYS.language, code);
  },

  /** Unmute choice lives in sessionStorage — it only persists for the session. */
  getSessionUnmuted(): boolean {
    if (!isBrowser) return false;
    return window.sessionStorage.getItem(KEYS.unmuted) === '1';
  },

  setSessionUnmuted(value: boolean): void {
    if (!isBrowser) return;
    window.sessionStorage.setItem(KEYS.unmuted, value ? '1' : '0');
  },
};
