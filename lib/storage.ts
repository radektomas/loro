import type { Level, SavedWord, Video, WordState } from '@/types';
import { grade, initialSrs } from '@/lib/srs';
import { dayKey } from '@/lib/progress';
import { glossText, lookupGloss } from '@/lib/dictionary';
import { getSupabase, TABLES, type SavedWordRow } from '@/lib/supabase';
import { ensureProfile, getSession, onAuthChange } from '@/lib/auth';
// Seed data is only used to upgrade legacy saved words to per-word glosses.
import videosData from '@/data/videos.json';

const videos = videosData as unknown as Video[];

/**
 * Typed persistence layer for Loro.
 *
 * localStorage is always the synchronous source of truth the UI reads, so the
 * whole API stays promise-free and every caller keeps working unchanged. When
 * a user signs in, a background sync engine mirrors that cache to and from
 * Supabase (loro_saved_words) — optimistic, debounced, and queued on failure —
 * so signing in never blocks the feed, saving, or review. Anonymous users
 * touch localStorage only, exactly as before.
 */

const KEYS = {
  savedWords: 'loro.savedWords',
  watched: 'loro.watchedVideos',
  recallDays: 'loro.recallDays',
  language: 'loro.language',
  onboarded: 'loro.onboarded', // has the user finished (or skipped) the intro
  startLevel: 'loro.startLevel', // CEFR seed from calibration — only seeds order
  syncQueue: 'loro.syncQueue', // pending remote writes (survives reload)
  syncedUser: 'loro.syncedUser', // whose data the cache currently holds
  unmuted: 'loro.session.unmuted', // sessionStorage — per-session only
} as const;

/** Fired on window whenever any learning data changes (same-tab updates). */
const WORDS_CHANGED = 'loro:words-changed';

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

/** Returns true only if the value was actually written. Never throws. */
function writeJSON(key: string, value: unknown): boolean {
  if (!isBrowser) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // Surface it — a swallowed write failure looks like a successful save.
    console.error(`[loro] localStorage write failed for "${key}"`, err);
    return false;
  }
}

function emitWordsChanged(): void {
  if (isBrowser) window.dispatchEvent(new Event(WORDS_CHANGED));
}

/** Fill SRS fields for entries saved before the spaced-repetition schema. */
function migrateWord(raw: Partial<SavedWord>): SavedWord {
  const savedAt = raw.savedAt ?? Date.now();
  return {
    text: raw.text ?? '',
    translation: raw.translation ?? '',
    videoId: raw.videoId ?? '',
    cueIndex: raw.cueIndex ?? 0,
    savedAt,
    ...initialSrs(savedAt),
    ...(typeof raw.box === 'number'
      ? {
          state: raw.state ?? 'new',
          box: raw.box,
          dueAt: raw.dueAt ?? savedAt,
          correct: raw.correct ?? 0,
          incorrect: raw.incorrect ?? 0,
          lastReviewedAt: raw.lastReviewedAt ?? null,
        }
      : {}),
  };
}

/**
 * Words saved before the word-level dictionary stored the WHOLE cue
 * translation. Detect that (the stored translation equals one of its cue's
 * sentence translations) and swap in the per-word gloss.
 */
function upgradeTranslation(word: SavedWord): SavedWord {
  const video = videos.find((v) => v.id === word.videoId);
  const cue = video?.cues[word.cueIndex];
  if (!video || !cue) return word;
  const isCueTranslation = Object.values(cue.translations).includes(
    word.translation
  );
  if (!isCueTranslation && word.translation) return word;
  const gloss = lookupGloss(video, word.text);
  const text = gloss && glossText(gloss, storage.getLanguage());
  return text ? { ...word, translation: text } : word;
}

// ============================================================ sync engine
//
// Everything below drives the optional Supabase mirror. It is inert until a
// session exists: `currentUserId === null` means anonymous, and every hook
// short-circuits. The UI never awaits any of it.

/** Row identity as the app sees it: a word is unique per (text, video). */
function localKey(text: string, videoId: string): string {
  return `${text}\u0000${videoId}`;
}

let currentUserId: string | null = null;
// undefined = never handled yet; distinct from null = handled-as-anonymous.
let lastHandledUserId: string | null | undefined = undefined;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let syncStarted = false;

// ---- SavedWord <-> row mapping. Timestamps are epoch ms locally, ISO in the
// DB (timestamptz columns); reads tolerate a raw number too, in case the
// column is a bigint, so the mapping survives either schema choice.

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

function isoToMs(value: string | number | null): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function toRow(userId: string, w: SavedWord): SavedWordRow {
  return {
    user_id: userId,
    text: w.text,
    translation: w.translation,
    video_id: w.videoId,
    cue_index: w.cueIndex,
    state: w.state,
    box: w.box,
    due_at: msToIso(w.dueAt),
    correct: w.correct,
    incorrect: w.incorrect,
    last_reviewed_at: w.lastReviewedAt != null ? msToIso(w.lastReviewedAt) : null,
    saved_at: msToIso(w.savedAt),
  };
}

function fromRow(r: SavedWordRow): SavedWord {
  const savedAt = isoToMs(r.saved_at) ?? Date.now();
  return {
    text: r.text,
    translation: r.translation ?? '',
    videoId: r.video_id,
    cueIndex: r.cue_index ?? 0,
    savedAt,
    state: (r.state as WordState) ?? 'new',
    box: r.box ?? 0,
    dueAt: isoToMs(r.due_at) ?? savedAt,
    correct: r.correct ?? 0,
    incorrect: r.incorrect ?? 0,
    lastReviewedAt: isoToMs(r.last_reviewed_at),
  };
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/**
 * Transition merge (anon -> signed in): combine two histories for the same
 * word. Higher box wins its schedule; correct/incorrect are SUMMED because the
 * two sides are independent review histories; earliest save and latest review
 * are kept. A box-0 side can never clobber a higher box.
 */
function mergeSum(local: SavedWord, remote: SavedWord): SavedWord {
  const hi = local.box >= remote.box ? local : remote;
  return {
    ...hi,
    box: Math.max(local.box, remote.box),
    correct: local.correct + remote.correct,
    incorrect: local.incorrect + remote.incorrect,
    savedAt: Math.min(local.savedAt, remote.savedAt),
    translation: local.translation || remote.translation || '',
    lastReviewedAt: maxNullable(local.lastReviewedAt, remote.lastReviewedAt),
  };
}

/**
 * Hydrate merge (already-synced user, e.g. refresh or offline edits): remote is
 * the source of truth, but a locally more-advanced word (higher box, edited
 * offline) is preserved rather than overwritten. Counts are max'd, never
 * summed — local is a cache of remote here, so summing would double-count.
 */
function mergePrefer(local: SavedWord, remote: SavedWord): SavedWord {
  const hi = local.box > remote.box ? local : remote; // tie -> remote
  const lo = hi === local ? remote : local;
  return {
    ...hi,
    correct: Math.max(local.correct, remote.correct),
    incorrect: Math.max(local.incorrect, remote.incorrect),
    savedAt: Math.min(local.savedAt, remote.savedAt),
    translation: hi.translation || lo.translation || '',
    lastReviewedAt: maxNullable(local.lastReviewedAt, remote.lastReviewedAt),
  };
}

/** Overwrite the cache and notify the UI in one place. */
function commitWords(words: SavedWord[]): void {
  writeJSON(KEYS.savedWords, words);
  emitWordsChanged();
}

// ---- pending write queue: keyed by (text, video), latest op wins so a burst
// of SRS changes to one word collapses to a single upsert (the debounce).

type SyncOp = { op: 'upsert' | 'delete'; text: string; videoId: string };

function enqueue(op: 'upsert' | 'delete', text: string, videoId: string): void {
  if (!currentUserId) return; // anonymous — nothing to sync
  const key = localKey(text, videoId);
  const queue = readJSON<SyncOp[]>(KEYS.syncQueue, []).filter(
    (i) => localKey(i.text, i.videoId) !== key
  );
  queue.push({ op, text, videoId });
  writeJSON(KEYS.syncQueue, queue);
  scheduleFlush();
}

function scheduleFlush(delayMs = 800): void {
  if (!isBrowser || !currentUserId) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, delayMs);
}

/**
 * Push queued writes to Supabase. Upserts are built from CURRENT local state
 * (so coalesced edits send their final value); a queued word that's since been
 * removed downgrades to a delete. Anything that fails stays on the queue and is
 * retried, so a save is never silently lost.
 */
async function flushQueue(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || !currentUserId) return;
  // Hold writes until the initial merge/hydrate has claimed the cache for this
  // user — flushing sooner could push un-merged rows and corrupt the sum-merge.
  if (readJSON<string | null>(KEYS.syncedUser, null) !== currentUserId) return;
  const queue = readJSON<SyncOp[]>(KEYS.syncQueue, []);
  if (queue.length === 0) return;

  const userId = currentUserId;
  const local = new Map(
    storage.getSavedWords().map((w) => [localKey(w.text, w.videoId), w])
  );

  const upsertItems: SyncOp[] = [];
  const deleteItems: SyncOp[] = [];
  for (const item of queue) {
    const word = local.get(localKey(item.text, item.videoId));
    if (item.op === 'delete' || !word) deleteItems.push(item);
    else upsertItems.push(item);
  }

  const stillFailed: SyncOp[] = [];

  if (upsertItems.length > 0) {
    const rows = upsertItems
      .map((i) => local.get(localKey(i.text, i.videoId)))
      .filter((w): w is SavedWord => Boolean(w))
      .map((w) => toRow(userId, w));
    const { error } = await supabase
      .from(TABLES.savedWords)
      .upsert(rows, { onConflict: 'user_id,text,video_id,cue_index' });
    if (error) {
      console.error('[loro] sync upsert failed', error.message);
      stillFailed.push(...upsertItems);
    }
  }

  for (const item of deleteItems) {
    const { error } = await supabase
      .from(TABLES.savedWords)
      .delete()
      .match({ user_id: userId, text: item.text, video_id: item.videoId });
    if (error) {
      console.error('[loro] sync delete failed', error.message);
      stillFailed.push(item);
    }
  }

  writeJSON(KEYS.syncQueue, stillFailed);
  if (stillFailed.length > 0) scheduleFlush(5000); // back off and retry
}

async function fetchRemoteWords(userId: string): Promise<SavedWord[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLES.savedWords)
    .select('*')
    .eq('user_id', userId);
  if (error) {
    console.error('[loro] fetch remote words failed', error.message);
    return null;
  }
  return (data as SavedWordRow[]).map(fromRow);
}

/**
 * First sign-in from anonymous: merge the local words UP into Supabase (summing
 * histories), then adopt the merged set as the cache. On any network failure we
 * leave the local cache intact and stay un-synced, so nothing is lost — the
 * next auth event or flush retries.
 */
async function transitionMergeUp(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const remote = await fetchRemoteWords(userId);
  if (remote === null) return; // couldn't read — keep local, retry later

  const merged = new Map<string, SavedWord>();
  for (const r of remote) merged.set(localKey(r.text, r.videoId), r);
  for (const l of storage.getSavedWords()) {
    const key = localKey(l.text, l.videoId);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeSum(l, existing) : l);
  }
  const words = [...merged.values()];

  const { error } = await supabase
    .from(TABLES.savedWords)
    .upsert(words.map((w) => toRow(userId, w)), {
      onConflict: 'user_id,text,video_id,cue_index',
    });
  if (error) {
    console.error('[loro] merge-up failed', error.message);
    return; // stay un-synced; local cache preserved
  }

  writeJSON(KEYS.syncQueue, []); // the merge supersedes any queued ops
  writeJSON(KEYS.syncedUser, userId);
  commitWords(words);
}

/**
 * Already-synced user (refresh, or a different device): pull remote as the
 * source of truth, but keep any local-only or locally-more-advanced words and
 * push them back. Remote read failure leaves the cache untouched.
 */
async function hydrateFromRemote(userId: string): Promise<void> {
  const remote = await fetchRemoteWords(userId);
  if (remote === null) return;

  const byKey = new Map<string, SavedWord>();
  for (const r of remote) byKey.set(localKey(r.text, r.videoId), r);

  const toPush: SavedWord[] = [];
  for (const l of storage.getSavedWords()) {
    const key = localKey(l.text, l.videoId);
    const r = byKey.get(key);
    if (!r) {
      byKey.set(key, l);
      toPush.push(l); // local-only (saved offline) — send it up
    } else {
      const m = mergePrefer(l, r);
      byKey.set(key, m);
      if (m.box > r.box || m.correct > r.correct || m.incorrect > r.incorrect) {
        toPush.push(m); // local was ahead — reconcile remote
      }
    }
  }

  writeJSON(KEYS.syncedUser, userId);
  commitWords([...byKey.values()]);
  for (const w of toPush) enqueue('upsert', w.text, w.videoId);
}

/** React to a sign-in / sign-out. Chooses merge-up vs hydrate vs switch-user. */
async function handleSession(userId: string | null): Promise<void> {
  // Collapse duplicate auth events (INITIAL_SESSION + getSession, token
  // refreshes) for the same user, so the transition merge runs exactly once.
  // Set synchronously, before any await, so a racing second event bails here.
  if (userId === lastHandledUserId) return;
  lastHandledUserId = userId;

  if (userId === null) {
    // Signed out. Keep the cache as an anonymous working copy; just stop
    // syncing. syncedUser is left as-is so this user re-signs in cleanly.
    currentUserId = null;
    return;
  }

  currentUserId = userId;
  void ensureProfile(userId);

  const cacheOwner = readJSON<string | null>(KEYS.syncedUser, null);
  if (cacheOwner === userId) {
    await hydrateFromRemote(userId);
  } else if (cacheOwner === null) {
    await transitionMergeUp(userId); // the anon -> signed-in path
  } else {
    // A different user owned this cache. Don't leak their words upward:
    // drop the local copy and hydrate this user fresh from remote.
    writeJSON(KEYS.savedWords, []);
    writeJSON(KEYS.syncQueue, []);
    await hydrateFromRemote(userId);
  }

  void flushQueue();
}

export const storage = {
  /**
   * Start the Supabase mirror. Safe to call repeatedly; a no-op when Supabase
   * isn't configured (the app just stays anonymous). Call once from a client
   * effect near the app root.
   */
  initSync(): void {
    if (syncStarted || !isBrowser) return;
    syncStarted = true;
    if (!getSupabase()) return; // sync disabled — pure localStorage mode

    void getSession().then((session) =>
      handleSession(session?.user?.id ?? null)
    );
    onAuthChange((session) => {
      void handleSession(session?.user?.id ?? null);
    });

    const flushSoon = () => {
      if (document.visibilityState === 'hidden') void flushQueue();
    };
    document.addEventListener('visibilitychange', flushSoon);
    window.addEventListener('online', () => void flushQueue());
    window.addEventListener('beforeunload', () => void flushQueue());
  },

  getSavedWords(): SavedWord[] {
    return readJSON<Partial<SavedWord>[]>(KEYS.savedWords, [])
      .map(migrateWord)
      .map(upgradeTranslation);
  },

  /**
   * Save a word. Re-saving an existing word keeps its SRS schedule.
   *
   * `ok` is true only after a verified round-trip: the write succeeded AND
   * reading the key back returns the new entry. Callers must not report
   * success to the user unless `ok` is true.
   */
  saveWord(
    word: Pick<SavedWord, 'text' | 'translation' | 'videoId' | 'cueIndex'>
  ): { words: SavedWord[]; ok: boolean } {
    const words = storage.getSavedWords();
    const existing = words.find(
      (w) => w.text === word.text && w.videoId === word.videoId
    );
    const next = existing
      ? words
      : [...words, { ...word, savedAt: Date.now(), ...initialSrs() }];
    const wrote = writeJSON(KEYS.savedWords, next);
    const ok =
      wrote &&
      storage
        .getSavedWords()
        .some((w) => w.text === word.text && w.videoId === word.videoId);
    if (ok) {
      emitWordsChanged();
      enqueue('upsert', word.text, word.videoId);
    }
    return { words: next, ok };
  },

  /** Apply a review result (typed recall) to a word and persist it. */
  gradeWord(
    text: string,
    videoId: string,
    wasCorrect: boolean
  ): { word: SavedWord | null; ok: boolean } {
    const words = storage.getSavedWords();
    const target = words.find(
      (w) => w.text === text && w.videoId === videoId
    );
    if (!target) return { word: null, ok: false };
    const graded = grade(target, wasCorrect);
    const next = words.map((w) => (w === target ? graded : w));
    const ok = writeJSON(KEYS.savedWords, next);
    // The honest streak counts days with a correct recall, so log the day.
    if (ok && wasCorrect) {
      const days = readJSON<string[]>(KEYS.recallDays, []);
      const today = dayKey(Date.now());
      if (!days.includes(today)) {
        writeJSON(KEYS.recallDays, [...days, today].sort());
      }
    }
    if (ok) {
      emitWordsChanged();
      enqueue('upsert', text, videoId);
    }
    return { word: graded, ok };
  },

  /** Record that a video took the screen in the feed. Idempotent. */
  markWatched(videoId: string): void {
    const ids = readJSON<string[]>(KEYS.watched, []);
    if (ids.includes(videoId)) return;
    if (writeJSON(KEYS.watched, [...ids, videoId])) emitWordsChanged();
  },

  /**
   * Videos the user has watched. Words can only be saved from a playing
   * video, so saved words backfill watches from before this log existed.
   */
  getWatchedVideoIds(): string[] {
    const ids = new Set(readJSON<string[]>(KEYS.watched, []));
    for (const w of storage.getSavedWords()) ids.add(w.videoId);
    return [...ids];
  },

  /**
   * Local days ("YYYY-MM-DD") with at least one CORRECT recall — the streak
   * source. Days from before this log existed are recovered from word state:
   * a word that has correct > 0 and isn't lapsed was last reviewed correctly,
   * so its lastReviewedAt day counts. The merge is persisted so a recovered
   * day survives the word being reviewed again later.
   */
  getCorrectRecallDays(): string[] {
    const stored = readJSON<string[]>(KEYS.recallDays, []);
    const days = new Set(stored);
    for (const w of storage.getSavedWords()) {
      if (w.correct > 0 && w.state !== 'lapsed' && w.lastReviewedAt) {
        days.add(dayKey(w.lastReviewedAt));
      }
    }
    const all = [...days].sort();
    if (all.length !== stored.length) writeJSON(KEYS.recallDays, all);
    return all;
  },

  removeWord(text: string, videoId: string): SavedWord[] {
    const next = storage
      .getSavedWords()
      .filter((w) => !(w.text === text && w.videoId === videoId));
    if (writeJSON(KEYS.savedWords, next)) {
      emitWordsChanged();
      enqueue('delete', text, videoId);
    }
    return next;
  },

  /**
   * Subscribe to learning-data changes (saved words, watch log, recall
   * days): same-tab (custom event) and cross-tab (native storage event).
   * Returns an unsubscribe function.
   */
  onWordsChanged(callback: () => void): () => void {
    if (!isBrowser) return () => {};
    const watchedKeys: readonly string[] = [
      KEYS.savedWords,
      KEYS.watched,
      KEYS.recallDays,
    ];
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || watchedKeys.includes(e.key)) callback();
    };
    window.addEventListener(WORDS_CHANGED, callback);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(WORDS_CHANGED, callback);
      window.removeEventListener('storage', onStorage);
    };
  },

  getLanguage(): string {
    if (!isBrowser) return 'en';
    return window.localStorage.getItem(KEYS.language) ?? 'en';
  },

  setLanguage(code: string): void {
    if (!isBrowser) return;
    window.localStorage.setItem(KEYS.language, code);
  },

  /**
   * Has the user finished (or skipped) the intro? First-timers are routed to
   * /welcome. Anyone with prior activity (saved words, watched videos) is
   * grandfathered in — existing users must never be dropped back into
   * onboarding just because the flag postdates their data.
   */
  isOnboarded(): boolean {
    if (!isBrowser) return true; // SSR: never redirect from the server
    if (window.localStorage.getItem(KEYS.onboarded) === '1') return true;
    if (storage.getSavedWords().length > 0) return true;
    if (readJSON<string[]>(KEYS.watched, []).length > 0) return true;
    return false;
  },

  setOnboarded(value = true): void {
    if (!isBrowser) return;
    if (value) window.localStorage.setItem(KEYS.onboarded, '1');
    else window.localStorage.removeItem(KEYS.onboarded);
  },

  /** CEFR level from calibration. Seeds feed order only; behaviour corrects it. */
  getStartLevel(): Level | null {
    if (!isBrowser) return null;
    const v = window.localStorage.getItem(KEYS.startLevel);
    return v === 'A1' || v === 'A2' || v === 'B1' || v === 'B2' ? v : null;
  },

  setStartLevel(level: Level): void {
    if (!isBrowser) return;
    window.localStorage.setItem(KEYS.startLevel, level);
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
