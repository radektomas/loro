import type { Level, SavedWord, WordState } from '@/types';
import { BOX_INTERVALS_MS, grade, initialSrs } from '@/lib/srs';
import {
  applyLevelAnswer,
  INITIAL_LEVEL_STATE,
  MAX_USER_LEVEL,
  type LevelAnswerResult,
  type LevelState,
} from '@/lib/levels';
import { dayKey, dueCount } from '@/lib/progress';
import {
  foldDuplicateWords,
  localAhead,
  mergePrefer,
  mergeWordSets,
} from '@/lib/wordMerge';
import {
  EMPTY_SAVE_PROMPT_STATE,
  type PromptOutcome,
  type SavePromptState,
} from '@/lib/savePrompt';
import {
  EMPTY_PROGRESS,
  mergeProgress,
  rowToSnapshot,
  sameProgress,
  type ProgressRow,
  type ProgressSnapshot,
} from '@/lib/progressSync';
import { glossText, lookupGloss } from '@/lib/dictionary';
import { getSupabase, TABLES, type SavedWordRow } from '@/lib/supabase';
import { ensureProfile, getSession, onAuthChange } from '@/lib/auth';
// Follow state is its own localStorage-first cache with the same shape, but it
// does NOT observe auth itself: this module owns the single cache-owner
// verdict and drives the follows engine's transitions from handleSession.
// The dependency is one-way (follows.ts must never import storage.ts).
import {
  flushFollowsQueue,
  handleFollowsAuth,
  handleFollowsSignOut,
  type FollowsAuthMode,
} from '@/lib/follows';
// Seed data is only used to upgrade legacy saved words to per-word glosses.
import { localVideos } from '@/lib/localVideos';

// Seed + embed catalog: words saved from either kind must resolve here.
const videos = localVideos;

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
  levelState: 'loro.levelState', // level fill-in mode: current level + meter
  calibrationKnown: 'loro.calibrationKnown', // words tapped as known in calibration
  syncQueue: 'loro.syncQueue', // pending remote writes (survives reload)
  savePrompt: 'loro.savePrompt', // account-nudge state — see lib/savePrompt.ts
  syncedUser: 'loro.syncedUser', // whose data the cache currently holds
  joinPromo: 'loro.joinPromoDismissed', // /profile founding-member row hidden
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

// mergeSum / mergePrefer / mergeWordSets live in lib/wordMerge.ts — pure and
// tested there; this module owns only transport and persistence.

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

// ---- progress sync: streak days, watch history, level meter --------------
//
// Same architecture as words: localStorage is the synchronous truth, the
// loro_progress row is a one-per-user mirror, and merges only ever UNION —
// sync cannot move progress backwards (lib/progressSync.ts). Pushes are
// whole-row and debounced; a lost push self-heals at the next hydrate, which
// runs on every app open with a session.

let progressPushTimer: ReturnType<typeof setTimeout> | null = null;

/** The local progress state, as a mergeable snapshot. levelState is null
    until the meter was ever touched, so a fresh device can't "win" over a
    real level with its INITIAL_LEVEL_STATE. */
function readProgressSnapshot(): ProgressSnapshot {
  return {
    recallDays: readJSON<string[]>(KEYS.recallDays, []),
    watchedIds: readJSON<string[]>(KEYS.watched, []),
    levelState:
      readJSON<Partial<LevelState> | null>(KEYS.levelState, null) === null
        ? null
        : storage.getLevelState(),
  };
}

function writeProgressSnapshot(s: ProgressSnapshot): void {
  writeJSON(KEYS.recallDays, s.recallDays);
  writeJSON(KEYS.watched, s.watchedIds);
  if (s.levelState) writeJSON(KEYS.levelState, s.levelState);
}

async function pushProgress(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const s = readProgressSnapshot();
  const { error } = await supabase.from(TABLES.progress).upsert({
    user_id: userId,
    recall_days: s.recallDays,
    watched_ids: s.watchedIds,
    level_state: s.levelState,
  });
  // Lost pushes are fine: the next hydrate's union-and-push repeats them.
  if (error) console.error('[loro] progress push failed', error.message);
}

/** Debounced whole-row push. Inert while anonymous or before the initial
    merge has claimed the cache for this user (same gate as flushQueue). */
function scheduleProgressPush(): void {
  if (!currentUserId) return;
  if (readJSON<string | null>(KEYS.syncedUser, null) !== currentUserId) return;
  const userId = currentUserId;
  if (progressPushTimer) clearTimeout(progressPushTimer);
  progressPushTimer = setTimeout(() => {
    progressPushTimer = null;
    void pushProgress(userId);
  }, 3000);
}

/**
 * Merge local and remote progress at sign-in / app open. Runs AFTER the word
 * sync so it can ride the same cache-owner verdict: if the word branch failed
 * (syncedUser not claimed), progress waits for the next auth event too.
 */
async function syncProgress(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  if (readJSON<string | null>(KEYS.syncedUser, null) !== userId) return;

  const { data, error } = await supabase
    .from(TABLES.progress)
    .select('user_id, recall_days, watched_ids, level_state')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    // Keep local, retry at the next auth event — never guess at remote.
    console.error('[loro] progress fetch failed', error.message);
    return;
  }

  const remote = rowToSnapshot((data as ProgressRow | null) ?? null);
  const local = readProgressSnapshot();
  const merged = mergeProgress(local, remote);
  writeProgressSnapshot(merged);
  emitWordsChanged(); // open /progress and /profile pages re-read

  if (!sameProgress(merged, remote)) await pushProgress(userId);
}

/**
 * After sign-in: resolve pending prompts as conversions and mirror the
 * measurement counters to the user's profile row so they're queryable
 * server-side (loro_profiles.save_prompt_stats).
 *
 * 'converted' is strict: only a prompt still PENDING when the session
 * arrives counts — the magic-link flow finishes in whatever tab opens the
 * link, so this is the one reliable place to observe it. A prompt already
 * dismissed stays dismissed even if the user signs in later from /profile;
 * that sign-in wasn't this prompt's doing.
 *
 * Until the save_prompt_stats migration is applied the update fails on the
 * unknown column — logged, harmless, retried at the next auth event.
 */
async function syncSavePrompt(userId: string): Promise<void> {
  const state = readJSON<SavePromptState>(KEYS.savePrompt, EMPTY_SAVE_PROMPT_STATE);
  let changed = false;
  const resolved: SavePromptState = { ...state };
  for (const key of ['p1', 'p2'] as const) {
    const record = resolved[key];
    if (record && record.outcome === 'shown') {
      resolved[key] = { ...record, outcome: 'converted' };
      changed = true;
    }
  }
  if (changed) writeJSON(KEYS.savePrompt, resolved);

  // Nothing shown yet -> nothing to measure, and no row noise for the
  // majority who sign in without ever meeting a prompt.
  if (!resolved.p1 && !resolved.p2) return;

  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase
    .from(TABLES.profiles)
    .update({
      save_prompt_stats: {
        sessions: resolved.sessions,
        p1: resolved.p1,
        p2: resolved.p2,
      },
    })
    .eq('id', userId);
  if (error) console.error('[loro] save-prompt stats sync failed', error.message);
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
  // Fold BEFORE either merge path sees the rows: the DB unique key includes
  // cue_index, so one word can legitimately exist as two rows (a re-save
  // from a different cue after storage eviction, or a second device). The
  // fold is deterministic in every field — without it, the map-by-key in
  // the merge paths kept whichever row the unordered SELECT returned last.
  return foldDuplicateWords((data as SavedWordRow[]).map(fromRow));
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

  const words = mergeWordSets(storage.getSavedWords(), remote);

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
      if (localAhead(m, r)) {
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
    handleFollowsSignOut();
    return;
  }

  currentUserId = userId;
  void ensureProfile(userId);

  // Read the cache owner ONCE, before any branch writes syncedUser: it is the
  // single verdict on whose data localStorage holds, and every localStorage-
  // first feature transitions on it. Follows ride the same verdict rather than
  // keeping their own owner key, so the two caches can never disagree about
  // which account they belong to.
  const cacheOwner = readJSON<string | null>(KEYS.syncedUser, null);
  const followsMode: FollowsAuthMode =
    cacheOwner === userId
      ? 'hydrate'
      : cacheOwner === null
        ? 'merge-up'
        : 'switch-user';

  if (cacheOwner === userId) {
    await hydrateFromRemote(userId);
  } else if (cacheOwner === null) {
    await transitionMergeUp(userId); // the anon -> signed-in path
  } else {
    // A different user owned this cache. Don't leak their words upward:
    // drop the local copy and hydrate this user fresh from remote. Progress
    // is wiped with them — before progress synced, the previous owner's
    // streak/watched/level silently bled into the next account here.
    writeJSON(KEYS.savedWords, []);
    writeJSON(KEYS.syncQueue, []);
    writeProgressSnapshot(EMPTY_PROGRESS);
    // writeProgressSnapshot leaves levelState alone when null — remove the
    // key outright so the new account starts untouched, not at the previous
    // owner's level.
    window.localStorage.removeItem(KEYS.levelState);
    await hydrateFromRemote(userId);
  }

  // After the words branch: progress rides the same cache-owner verdict
  // (no-ops internally if the branch above failed to claim the cache).
  void syncProgress(userId);
  void syncSavePrompt(userId);

  void flushQueue();
  // Independent of the word sync: a failure above must not skip follows, and
  // follows has its own retry queue. Not awaited — nothing in the UI waits.
  //
  // The fire-and-forget is only safe because the follows engine's merge-up
  // and hydrate are THE SAME union-push: local and remote are unioned, local-
  // only ids are queued upward, and nothing is ever dropped from the local
  // cache. A merge that fails (or never runs, because the tab closed) is
  // therefore self-healing — the next hydrate performs the identical union
  // and the pending ids are still queued. If hydrate is ever changed to a
  // pure remote -> local read, that stops being true: an un-merged local
  // follow would be silently overwritten, and this call must then become
  // awaited and error-handled before the merge-up branch can be trusted.
  void handleFollowsAuth(userId, followsMode);
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

    // Both queues flush on the same signals — a pending follow is as easy to
    // strand on a backgrounded tab as a pending word.
    const flushAll = () => {
      void flushQueue();
      void flushFollowsQueue();
    };
    const flushSoon = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    document.addEventListener('visibilitychange', flushSoon);
    window.addEventListener('online', flushAll);
    window.addEventListener('beforeunload', flushAll);
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
    // A completed recall session = the grading that empties the due queue
    // (the graded word reschedules into the future either way). Feeds the
    // second save-prompt threshold; see lib/savePrompt.ts.
    if (ok) {
      const nowMs = Date.now();
      if (dueCount(words, nowMs) > 0 && dueCount(next, nowMs) === 0) {
        const s = storage.getSavePromptState();
        writeJSON(KEYS.savePrompt, { ...s, sessions: s.sessions + 1 });
      }
    }
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
      scheduleProgressPush(); // a correct recall may have logged a streak day
    }
    return { word: graded, ok };
  },

  /** Level fill-in mode: current level (1..MAX_USER_LEVEL) + meter (0-100). */
  getLevelState(): LevelState {
    const raw = readJSON<Partial<LevelState>>(KEYS.levelState, {});
    const level = Math.min(
      MAX_USER_LEVEL,
      Math.max(1, Math.round(raw.level ?? INITIAL_LEVEL_STATE.level))
    );
    const meter = Math.min(
      100,
      Math.max(0, Math.round(raw.meter ?? INITIAL_LEVEL_STATE.meter))
    );
    return { level, meter };
  },

  /** Apply one level-blank answer to the meter/level and persist it. */
  applyLevelAnswer(wasCorrect: boolean): LevelAnswerResult {
    const result = applyLevelAnswer(storage.getLevelState(), wasCorrect);
    if (writeJSON(KEYS.levelState, { level: result.level, meter: result.meter })) {
      emitWordsChanged();
      scheduleProgressPush();
    }
    return result;
  },

  /**
   * Save a word the user answered as a LEVEL blank into the SRS, routed by
   * result: a miss enters at the bottom (box 0 — a genuine unknown that comes
   * back within minutes), a correct fill is filed as already known (box 4,
   * 7 days) so obvious words never flood the active recall queue. A word
   * that's already saved just takes a normal review grade instead — one word,
   * one schedule.
   */
  saveLevelWord(
    word: Pick<SavedWord, 'text' | 'translation' | 'videoId' | 'cueIndex'>,
    wasCorrect: boolean
  ): { ok: boolean } {
    const words = storage.getSavedWords();
    const existing = words.find(
      (w) => w.text === word.text && w.videoId === word.videoId
    );
    if (existing) {
      return { ok: storage.gradeWord(word.text, word.videoId, wasCorrect).ok };
    }

    const LEVEL_KNOWN_BOX = 4;
    const now = Date.now();
    const base = { ...word, savedAt: now, ...initialSrs(now) };
    const entry: SavedWord = wasCorrect
      ? {
          ...base,
          box: LEVEL_KNOWN_BOX,
          state: 'known',
          dueAt: now + BOX_INTERVALS_MS[LEVEL_KNOWN_BOX],
          correct: 1,
          lastReviewedAt: now,
        }
      : { ...base, incorrect: 1, lastReviewedAt: now };

    const wrote = writeJSON(KEYS.savedWords, [...words, entry]);
    const ok =
      wrote &&
      storage
        .getSavedWords()
        .some((w) => w.text === word.text && w.videoId === word.videoId);
    if (ok) {
      // A correct level fill is a correct typed production — it counts toward
      // the streak exactly like a correct recall does.
      if (wasCorrect) {
        const days = readJSON<string[]>(KEYS.recallDays, []);
        const today = dayKey(now);
        if (!days.includes(today)) {
          writeJSON(KEYS.recallDays, [...days, today].sort());
        }
      }
      emitWordsChanged();
      enqueue('upsert', word.text, word.videoId);
      scheduleProgressPush();
    }
    return { ok };
  },

  // ---- account-nudge state (lib/savePrompt.ts owns the rules) ------------

  getSavePromptState(): SavePromptState {
    return readJSON<SavePromptState>(KEYS.savePrompt, EMPTY_SAVE_PROMPT_STATE);
  },

  /** Mark a prompt as shown. Idempotent: a re-show of a still-pending prompt
      keeps the ORIGINAL shownAt and word count — the measurement wants the
      first exposure, not the latest reload. */
  recordSavePromptShown(variant: 1 | 2, words: number): void {
    const s = storage.getSavePromptState();
    const key = variant === 1 ? 'p1' : 'p2';
    if (s[key]) return;
    writeJSON(KEYS.savePrompt, {
      ...s,
      [key]: { shownAt: Date.now(), words, outcome: 'shown' },
    });
  },

  /** Resolve a pending prompt. Only 'shown' can transition — a prompt never
      flips between dismissed and converted after the fact. */
  recordSavePromptOutcome(variant: 1 | 2, outcome: PromptOutcome): void {
    const s = storage.getSavePromptState();
    const key = variant === 1 ? 'p1' : 'p2';
    const record = s[key];
    if (!record || record.outcome !== 'shown') return;
    writeJSON(KEYS.savePrompt, { ...s, [key]: { ...record, outcome } });
  },

  /** Record that a video took the screen in the feed. Idempotent. */
  markWatched(videoId: string): void {
    const ids = readJSON<string[]>(KEYS.watched, []);
    if (ids.includes(videoId)) return;
    if (writeJSON(KEYS.watched, [...ids, videoId])) {
      emitWordsChanged();
      scheduleProgressPush();
    }
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
      KEYS.levelState,
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

  /** Words the user marked as already-known during CEFR calibration. The
      per-video glossary renders them as known so they never flood "unknown". */
  getCalibrationKnown(): string[] {
    return readJSON<string[]>(KEYS.calibrationKnown, []);
  },

  setCalibrationKnown(words: string[]): void {
    writeJSON(KEYS.calibrationKnown, words);
  },

  /** Has the /profile founding-member row been dismissed? Dismissal is
      final on this device — the pre-launch offer never nags twice. */
  isJoinPromoDismissed(): boolean {
    if (!isBrowser) return true; // SSR: render nothing until hydrated
    return window.localStorage.getItem(KEYS.joinPromo) === '1';
  },

  dismissJoinPromo(): void {
    if (!isBrowser) return;
    window.localStorage.setItem(KEYS.joinPromo, '1');
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
