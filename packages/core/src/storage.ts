import type {
  Level,
  SavedWord,
  SelfLevel,
  WordSource,
  WordState,
} from './types.ts';
import {
  BOX_INTERVALS_MS,
  grade,
  initialSrs,
  MAX_BOX,
  stateForBox,
} from './srs.ts';
import {
  applyLevelAnswer,
  INITIAL_LEVEL_STATE,
  MAX_USER_LEVEL,
  type LevelAnswerResult,
  type LevelState,
} from './levels.ts';
import { dayKey, dueCount } from './progress.ts';
import {
  foldDuplicateWords,
  localAhead,
  mergePrefer,
  mergeWordSets,
} from './wordMerge.ts';
import {
  EMPTY_SAVE_PROMPT_STATE,
  type PromptOutcome,
  type SavePromptState,
} from './savePrompt.ts';
import {
  appendStarterEvent,
  mergeStarterEvents,
  parseStarterEvents,
  type StarterEvent,
} from './starterEvents.ts';
import {
  appendPaywallEvent,
  mergePaywallEvents,
  sanitizePaywallLog,
  type PaywallEvent,
} from './entitlements/paywallEvents.ts';
import {
  canSaveMore,
  countedSaved,
  countsTowardLimit,
  effectiveLimit,
  milestoneFor,
} from './entitlements/limit.ts';
// Entitlements are a second local-first cache with the same shape as
// follows, and the same one-way rule: state.ts must never import storage.ts.
// This module owns the cache-owner verdict and drives the tier cache's
// transitions from handleSession.
import {
  entitlementInput,
  handleEntitlementsAuth,
  handleEntitlementsSignOut,
  type EntitlementsAuthMode,
} from './entitlements/state.ts';
import { requestPaywall } from './entitlements/paywallBus.ts';
import {
  EMPTY_PROGRESS,
  mergeProgress,
  rowToSnapshot,
  sameProgress,
  type ProgressRow,
  type ProgressSnapshot,
} from './progressSync.ts';
import { glossText, lookupGloss } from './dictionary.ts';
// Only for the provenance back-fill below: rows written by the OLD linear deck
// and the calibration escape hatch are identifiable by this pseudo video id.
import { STARTER_VIDEO_ID } from './starter/deck.ts';
import { getSupabase, TABLES, type SavedWordRow } from './supabase.ts';
import { ensureProfile, getSession, onAuthChange } from './auth.ts';
// Follow state is its own local-first cache with the same shape, but it
// does NOT observe auth itself: this module owns the single cache-owner
// verdict and drives the follows engine's transitions from handleSession.
// The dependency is one-way (follows.ts must never import storage.ts).
import {
  flushFollowsQueue,
  handleFollowsAuth,
  handleFollowsSignOut,
  type FollowsAuthMode,
} from './follows.ts';
import {
  getPlatformCrypto,
  getStorageDriver,
  onFlushSignal,
} from './platform.ts';
import { createEmitter } from './emitter.ts';
// Read through the catalog SEAM, never a direct catalog import: core must not
// pull the embed-transcript JSON into its own module graph (the web bundles it
// and hands it over at boot; RN serves it from Supabase). Only used to upgrade
// legacy saved words to per-word glosses — see upgradeTranslation.
import { getCatalog } from './catalog.ts';

/**
 * Typed persistence layer for Loro.
 *
 * The driver's persistent layer (localStorage on web, MMKV in RN — see
 * platform.ts) is always the synchronous source of truth the UI reads, so the
 * whole API stays promise-free and every caller keeps working unchanged. When
 * a user signs in, a background sync engine mirrors that cache to and from
 * Supabase (loro_saved_words) — optimistic, debounced, and queued on failure —
 * so signing in never blocks the feed, saving, or review. Anonymous users
 * touch the local cache only, exactly as before.
 */

const KEYS = {
  savedWords: 'loro.savedWords',
  watched: 'loro.watchedVideos',
  recallDays: 'loro.recallDays',
  language: 'loro.language',
  onboarded: 'loro.onboarded', // has the user finished (or skipped) the intro
  level: 'loro.level', // onboarding self-assessment: zero | some | confident
  starterDone: 'loro.starterDone', // starter deck finished or skipped
  startLevel: 'loro.startLevel', // CEFR seed from calibration — only seeds order
  levelState: 'loro.levelState', // level fill-in mode: current level + meter
  calibrationKnown: 'loro.calibrationKnown', // words tapped as known in calibration
  syncQueue: 'loro.syncQueue', // pending remote writes (survives reload)
  savePrompt: 'loro.savePrompt', // account-nudge state — see savePrompt.ts
  syncedUser: 'loro.syncedUser', // whose data the cache currently holds
  joinPromo: 'loro.joinPromoDismissed', // /profile founding-member row hidden
  starterEvents: 'loro.starterEvents', // deck funnel — see starterEvents.ts
  paywallEvents: 'loro.paywallEvents', // see entitlements/paywallEvents.ts
  unmuted: 'loro.session.unmuted', // session layer — THIS session's sound state
  soundOn: 'loro.soundOn', // the user's standing sound CHOICE (see below)
} as const;

/** Same-tab change bus for any learning data; cross-tab arrives via the
    driver's external feed. */
const wordsChanged = createEmitter<void>('wordsChanged');

function readJSON<T>(key: string, fallback: T): T {
  const driver = getStorageDriver();
  if (!driver) return fallback;
  try {
    const raw = driver.local.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Returns true only if the value was actually written. Never throws. */
function writeJSON(key: string, value: unknown): boolean {
  const driver = getStorageDriver();
  if (!driver) return false;
  try {
    driver.local.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // Surface it — a swallowed write failure looks like a successful save.
    console.error(`[loro] local write failed for "${key}"`, err);
    return false;
  }
}

function emitWordsChanged(): void {
  wordsChanged.emit();
}

/**
 * Resolve a stored word's provenance.
 *
 * Three cases, in order: an explicit value wins; otherwise a row saved against
 * the STARTER_VIDEO_ID pseudo id is a grant from the OLD linear deck or the
 * calibration escape hatch (both wrote that id, neither had this field), and
 * back-filling it here keeps a pre-existing user's ~80 granted words out of the
 * gate counters; anything else is a user save, which is the safe default —
 * counting a word toward a gate is recoverable, exempting one silently is not.
 *
 * The same back-fill runs server-side in the source migration, so the two
 * cannot disagree about a row.
 */
function wordSourceOf(
  raw: WordSource | string | undefined,
  videoId: string | undefined
): WordSource {
  if (raw === 'deck') return 'deck';
  if (raw === 'user') return 'user';
  return videoId === STARTER_VIDEO_ID ? 'deck' : 'user';
}

/** Fill SRS fields for entries saved before the spaced-repetition schema. */
function migrateWord(raw: Partial<SavedWord>): SavedWord {
  const savedAt = raw.savedAt ?? Date.now();
  return {
    text: raw.text ?? '',
    translation: raw.translation ?? '',
    videoId: raw.videoId ?? '',
    cueIndex: raw.cueIndex ?? 0,
    source: wordSourceOf(raw.source, raw.videoId),
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
  // Resolved per call, not hoisted to a module constant: the catalog seam is
  // filled at boot and may be replaced later (an RN background refresh), and a
  // snapshot taken at module-evaluation time would pin this to the seed set
  // forever. Words that resolve to nothing are returned untouched, which is
  // also the correct answer for a word saved from a UGC video (never in the
  // catalog) — the same behaviour as before the seam.
  const video = getCatalog().find((v) => v.id === word.videoId);
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
    source: w.source,
  };
}

function fromRow(r: SavedWordRow): SavedWord {
  const savedAt = isoToMs(r.saved_at) ?? Date.now();
  return {
    text: r.text,
    translation: r.translation ?? '',
    videoId: r.video_id,
    cueIndex: r.cue_index ?? 0,
    source: wordSourceOf(r.source ?? undefined, r.video_id),
    savedAt,
    state: (r.state as WordState) ?? 'new',
    box: r.box ?? 0,
    dueAt: isoToMs(r.due_at) ?? savedAt,
    correct: r.correct ?? 0,
    incorrect: r.incorrect ?? 0,
    lastReviewedAt: isoToMs(r.last_reviewed_at),
  };
}

// mergeSum / mergePrefer / mergeWordSets live in wordMerge.ts — pure and
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
  if (!getStorageDriver() || !currentUserId) return;
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
// Same architecture as words: the local cache is the synchronous truth, the
// loro_progress row is a one-per-user mirror, and merges only ever UNION —
// sync cannot move progress backwards (progressSync.ts). Pushes are
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

/**
 * Mirror the onboarding self-assessment to the profile row on sign-in —
 * the merge-on-signin payload for loro.level. Push-only and only when a
 * local value exists: a device that never assessed must not null out a
 * value another device wrote. Until the self_level migration is applied
 * the update fails on the unknown column — logged, harmless, retried at
 * the next auth event (same contract as save_prompt_stats).
 */
async function syncSelfLevel(userId: string): Promise<void> {
  const level = storage.getSelfLevel();
  if (!level) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase
    .from(TABLES.profiles)
    .update({ self_level: level })
    .eq('id', userId);
  if (error) console.error('[loro] self-level sync failed', error.message);
}

/**
 * A fresh, stable id for one logged event — the starter-deck funnel and the
 * paywall funnel both merge on it, and both need the same guarantee.
 *
 * The id source is the platform's injected crypto (platform.ts). The web's
 * implementation carries the load-bearing fallback chain — randomUUID exists
 * only in a SECURE context, and the device-testing path for this app is
 * http://192.168.x.x on a phone, where it is undefined (see lib/platformInit.ts);
 * RN supplies expo-crypto. The last resort here covers no crypto being
 * injected at all (server render, node tests).
 *
 * Uniqueness is the only property asked of the result: it is opaque, never
 * parsed, never compared for order, and only ever used as a merge key.
 */
function newEventId(): string {
  const c = getPlatformCrypto();
  if (c) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Merge the starter-deck funnel with loro_profiles.starter_deck_events.
 *
 * A UNION in both directions, the same shape as saved words and progress — not
 * the blind push that save_prompt_stats uses. Two devices can each hold part of
 * one user's onboarding (ran the deck on a phone, signed in on a laptop), and a
 * push-only mirror would delete whichever half went second.
 *
 * Safe to repeat because mergeStarterEvents is IDEMPOTENT on the event id
 * (starterEvents.ts): a retried push, a second tab, or an auth event that
 * fires twice all converge on the same log rather than duplicating it.
 *
 * An unmigrated DB fails on the unknown column — logged, harmless, retried at
 * the next auth event (same contract as save_prompt_stats and self_level).
 */
async function syncStarterEvents(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  // Same cache-owner gate as every other sync: never merge another user's log
  // into this account.
  if (readJSON<string | null>(KEYS.syncedUser, null) !== userId) return;

  const local = storage.getStarterEvents();
  const { data, error } = await supabase
    .from(TABLES.profiles)
    .select('starter_deck_events')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    // Never guess at remote: keep local and retry at the next auth event.
    console.error('[loro] starter-event fetch failed', error.message);
    return;
  }

  const remote = parseStarterEvents(
    (data as { starter_deck_events?: unknown } | null)?.starter_deck_events ?? []
  );
  const merged = mergeStarterEvents(local, remote);
  if (merged.length === 0) return; // nothing anywhere — no row noise
  if (merged.length !== local.length) writeJSON(KEYS.starterEvents, merged);
  // Push whenever remote is not already the merged result. Cheap, and it is
  // what heals a lost push from an earlier session.
  if (merged.length !== remote.length) {
    const { error: pushError } = await supabase
      .from(TABLES.profiles)
      .update({ starter_deck_events: merged })
      .eq('id', userId);
    if (pushError) {
      console.error('[loro] starter-event push failed', pushError.message);
    }
  }
}

let starterEventsPushTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced merge-and-push for events logged BY a signed-in user (the sign-in
    path covers the anonymous-then-signed-in case). Inert while anonymous or
    before the initial merge claimed the cache — same gate as every other push. */
function scheduleStarterEventsPush(): void {
  if (!currentUserId) return;
  if (readJSON<string | null>(KEYS.syncedUser, null) !== currentUserId) return;
  const userId = currentUserId;
  if (starterEventsPushTimer) clearTimeout(starterEventsPushTimer);
  starterEventsPushTimer = setTimeout(() => {
    starterEventsPushTimer = null;
    void syncStarterEvents(userId);
  }, 4000);
}

// ---- paywall funnel: monetization instrumentation ------------------------
//
// A UNION merge in both directions, unlike the starter-deck log above. The deck
// is one run on one device, so merging two devices' funnels would invent a run
// nobody performed. The paywall is met over a lifetime on every device the user
// owns, and dropping a phone's blocks in favour of a laptop's would understate
// the exact number the limit is being judged on. entitlements/paywallEvents
// owns the union rule; this is transport.

async function syncPaywallEvents(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  if (readJSON<string | null>(KEYS.syncedUser, null) !== userId) return;

  const local = storage.getPaywallEvents();

  const { data, error } = await supabase
    .from(TABLES.profiles)
    .select('paywall_events')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    // Includes the unmigrated-column case. Keep local, retry at the next auth
    // event — never guess at remote, and never drop a local event.
    console.error('[loro] paywall-event fetch failed', error.message);
    return;
  }

  const remote = sanitizePaywallLog(
    (data as { paywall_events?: unknown } | null)?.paywall_events ?? []
  );
  const merged = mergePaywallEvents(local, remote);
  if (merged.length === 0) return; // nothing anywhere — no row noise

  if (merged.length !== local.length) writeJSON(KEYS.paywallEvents, merged);
  if (merged.length === remote.length) return; // remote already has everything

  const { error: pushError } = await supabase
    .from(TABLES.profiles)
    .update({ paywall_events: merged })
    .eq('id', userId);
  if (pushError) {
    console.error('[loro] paywall-event push failed', pushError.message);
  }
}

let paywallEventsPushTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced push for events logged BY a signed-in user (the sign-in merge
    covers the anonymous-then-signed-in case). Inert while anonymous or before
    the initial merge claimed the cache — same gate as every other push. */
function schedulePaywallEventsPush(): void {
  if (!currentUserId) return;
  if (readJSON<string | null>(KEYS.syncedUser, null) !== currentUserId) return;
  const userId = currentUserId;
  if (paywallEventsPushTimer) clearTimeout(paywallEventsPushTimer);
  paywallEventsPushTimer = setTimeout(() => {
    paywallEventsPushTimer = null;
    void syncPaywallEvents(userId);
  }, 4000);
}

// ---- the save gate -------------------------------------------------------

/**
 * Should this NEW word be refused because it would exceed the free-tier limit?
 *
 * Side-effecting on purpose, and this is the only place those side effects
 * happen: a refusal logs save_blocked_by_limit and asks the paywall host to
 * open (@loro/core entitlements/paywallBus). Putting both here means every save
 * surface — the feed's word sheet, the glossary sheet, and whatever is added
 * next — gets the identical behaviour without knowing the paywall exists.
 *
 * WHAT IS NOT GATED, deliberately:
 *   - re-saving a word the user already has (checked by the caller): not
 *     growth, and the word is already theirs;
 *   - words we granted rather than the user choosing — the starter deck and the
 *     calibration escape hatch, i.e. source: 'deck' (countsTowardLimit);
 *   - saveWordAtBox / saveLevelWord: the deck, the welcome guide, and the
 *     feed's blue level-blanks. Gating the last of those would stall the level
 *     meter, which is core usage;
 *   - gradeWord, i.e. all SRS review of existing words. A user at the limit
 *     keeps every word they have and keeps progressing on them. The limit
 *     blocks growth; it never touches the loop.
 */
function refuseSave(words: SavedWord[]): boolean {
  // Every save that reaches this gate is a 'user' save by construction —
  // saveWord is the only caller, and grants go through saveWordAtBox, which is
  // not gated at all. The check stays as the explicit statement of that rule.
  if (!countsTowardLimit({ source: 'user' })) return false;
  const limit = effectiveLimit(entitlementInput());
  if (!Number.isFinite(limit)) return false; // the production default today
  const count = countedSaved(words);
  if (canSaveMore(count, limit)) return false;

  storage.logPaywallEvent({
    name: 'save_blocked_by_limit',
    at: Date.now(),
    savedCount: count,
  });
  requestPaywall({ reason: 'save_limit', savedCount: count, limit });
  return true;
}

/**
 * Called after any successful save that may have changed the counted total.
 * Fires the saved-word milestone events, which are the measurement that tells
 * us whether FREE_TIER_SAVED_WORDS_LIMIT is set anywhere near right — a
 * conversion rate alone cannot distinguish a limit nobody reaches from one
 * everybody resents. Once each, ever (appendPaywallEvent enforces it).
 */
function noteSavedCountChanged(): void {
  const count = countedSaved(storage.getSavedWords());
  const milestone = milestoneFor(count);
  if (milestone === null) return;
  storage.logPaywallEvent({
    name: 'saved_words_count',
    at: Date.now(),
    savedCount: count,
    milestone,
  });
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
    // The tier cache is DROPPED, not kept as an anonymous working copy the way
    // saved words are: an entitlement is not the user's data. A stale 'plus'
    // would hand a signed-out browser unlimited saves, and a stale 'free'
    // would gate whoever signs in next.
    handleEntitlementsSignOut();
    return;
  }

  currentUserId = userId;
  void ensureProfile(userId);

  // Read the cache owner ONCE, before any branch writes syncedUser: it is the
  // single verdict on whose data the local cache holds, and every local-
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
    getStorageDriver()?.local.removeItem(KEYS.levelState);
    // Same for the self-assessment: without this, syncSelfLevel would push
    // the PREVIOUS owner's answer up into this account's profile row.
    getStorageDriver()?.local.removeItem(KEYS.level);
    getStorageDriver()?.local.removeItem(KEYS.starterDone);
    // The deck funnel is the PREVIOUS owner's run. Left in place, it would be
    // pushed up under this account's id and misattribute their onboarding.
    getStorageDriver()?.local.removeItem(KEYS.starterEvents);
    // Same for the paywall funnel: the previous owner's blocks and milestones
    // would be unioned into this account's log and describe a user who never
    // existed.
    getStorageDriver()?.local.removeItem(KEYS.paywallEvents);
    // Drop the previous owner's tier NOW, synchronously, rather than leaving it
    // to handleEntitlementsAuth below: that call is awaited on a network round
    // trip, and until it lands anything reading the cache would be reading
    // someone else's entitlement.
    handleEntitlementsSignOut();
    await hydrateFromRemote(userId);
  }

  // After the words branch: progress rides the same cache-owner verdict
  // (no-ops internally if the branch above failed to claim the cache).
  void syncProgress(userId);
  void syncSavePrompt(userId);
  void syncSelfLevel(userId);
  void syncStarterEvents(userId);
  void syncPaywallEvents(userId);

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

  // Entitlements ride the SAME cache-owner verdict as follows — the tier cache
  // and the word cache must never disagree about which account they belong to.
  //
  // Deliberately last, and deliberately after the awaited words branch: the
  // counted total passed here is the trigger for grandfathering, and before the
  // merge it would be this device's partial view rather than the account's real
  // vocabulary. A user with 200 words on another device would be measured at
  // whatever this browser happened to hold. (The server recounts before
  // granting, so this is a trigger and not the decision — but a trigger that
  // never fires grants nothing.)
  const entitlementsMode: EntitlementsAuthMode = followsMode;
  void handleEntitlementsAuth(
    userId,
    entitlementsMode,
    storage.getCountedSavedWords()
  );
}

export const storage = {
  /**
   * Start the Supabase mirror. Safe to call repeatedly; a no-op when Supabase
   * isn't configured (the app just stays anonymous). Call once from a client
   * effect near the app root.
   */
  initSync(): void {
    if (syncStarted || !getStorageDriver()) return;
    syncStarted = true;
    if (!getSupabase()) return; // sync disabled — pure local-cache mode

    void getSession().then((session) =>
      handleSession(session?.user?.id ?? null)
    );
    onAuthChange((session) => {
      void handleSession(session?.user?.id ?? null);
    });

    // Both queues flush on the same signals — a pending follow is as easy to
    // strand on a backgrounded tab as a pending word. The signals themselves
    // are the platform's (platform.ts onFlushSignal): on web, today's three
    // events — visibilitychange-hidden, online, beforeunload — unchanged.
    onFlushSignal(() => {
      void flushQueue();
      void flushFollowsQueue();
    });
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
   *
   * `blocked` distinguishes the two ways `ok` can be false: the free-tier
   * limit refused the word (blocked), or the write itself failed (storage
   * evicted, quota exceeded). Both must look unsuccessful in the UI, but only
   * one of them is the user's to fix, so a caller that shows a message should
   * branch on it. Nothing is persisted either way.
   */
  saveWord(
    word: Pick<SavedWord, 'text' | 'translation' | 'videoId' | 'cueIndex'>
  ): { words: SavedWord[]; ok: boolean; blocked: boolean } {
    const words = storage.getSavedWords();
    const existing = words.find(
      (w) => w.text === word.text && w.videoId === word.videoId
    );
    // The gate runs before the write, and only for a genuinely new word, so a
    // blocked save leaves the local cache byte-identical — there is no partial
    // state to undo and nothing for the sync engine to push.
    if (!existing && refuseSave(words)) {
      return { words, ok: false, blocked: true };
    }
    const next = existing
      ? words
      : [
          ...words,
          // 'user': a save through this path is always the user choosing a word
          // (the feed's word sheet, the glossary). Grants come in through
          // saveWordAtBox instead.
          {
            ...word,
            source: 'user' as WordSource,
            savedAt: Date.now(),
            ...initialSrs(),
          },
        ];
    const wrote = writeJSON(KEYS.savedWords, next);
    const ok =
      wrote &&
      storage
        .getSavedWords()
        .some((w) => w.text === word.text && w.videoId === word.videoId);
    if (ok) {
      emitWordsChanged();
      enqueue('upsert', word.text, word.videoId);
      noteSavedCountChanged();
    }
    return { words: next, ok, blocked: false };
  },

  /**
   * Saved words that count toward the free-tier limit — starter-deck and
   * calibration words excluded (entitlements/limit.ts countsTowardLimit).
   *
   * The one number the entitlement seam reads. It lives here rather than in the
   * hook because the save gate needs it synchronously inside saveWord(), and
   * because /profile's capacity meter and the milestone events must be counting
   * the same thing the gate counts.
   */
  getCountedSavedWords(): number {
    return countedSaved(storage.getSavedWords());
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
    // second save-prompt threshold; see savePrompt.ts.
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
    // 'user': a level blank is the user typing a word back from memory in the
    // feed. It is behaviour, not a grant, so it counts toward the gates.
    const base = {
      ...word,
      source: 'user' as WordSource,
      savedAt: now,
      ...initialSrs(now),
    };
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
      noteSavedCountChanged();
    }
    return { ok };
  },

  /**
   * Save a word directly INTO a Leitner box — the starter deck's "Znám"/
   * "Neznám" sorting (box 3 / box 1) and the calibration escape hatch's
   * box-3 commits. Same engine as every other save: verified round-trip,
   * words-changed event, sync enqueue. NOT for feed saves — those start at
   * box 0 via saveWord so the schedule is earned, not granted.
   *
   * `staggerMs` shifts dueAt past the box interval. The deck passes
   * deckIndex * STARTER_STAGGER_MS so a full run comes due as a rolling,
   * frequency-ordered wave instead of ~80 words hitting one cliff and
   * pinning every feed video at computeBlankPlan's blank cap.
   *
   * `source` is EXPLICIT and has no default: every caller of this function is
   * currently a seeding surface passing 'deck', and the day one is not, that
   * has to be a decision someone makes rather than a default they inherit —
   * getting it wrong hands out free words that silently dodge both gates.
   * Note the source rides on the WORD, not on this function: the deck's words
   * now carry real clip videoIds, so nothing downstream can identify a grant
   * by its video any more (which is exactly what countsTowardLimit used to do).
   *
   * A word that already exists keeps its schedule untouched (ok: true) —
   * the deck skips saved words anyway, so an existing entry here means two
   * surfaces raced; the earlier one owns the history.
   */
  saveWordAtBox(
    word: Pick<SavedWord, 'text' | 'translation' | 'videoId' | 'cueIndex'>,
    box: number,
    staggerMs = 0,
    source: WordSource = 'deck'
  ): { ok: boolean } {
    const words = storage.getSavedWords();
    const exists = words.some(
      (w) => w.text === word.text && w.videoId === word.videoId
    );
    if (exists) return { ok: true };

    const target = Math.min(Math.max(0, Math.round(box)), MAX_BOX);
    const now = Date.now();
    const entry: SavedWord = {
      ...word,
      source,
      savedAt: now,
      ...initialSrs(now),
      box: target,
      state: stateForBox(target),
      dueAt: now + BOX_INTERVALS_MS[target] + staggerMs,
    };

    const wrote = writeJSON(KEYS.savedWords, [...words, entry]);
    const ok =
      wrote &&
      storage
        .getSavedWords()
        .some((w) => w.text === word.text && w.videoId === word.videoId);
    if (ok) {
      emitWordsChanged();
      enqueue('upsert', word.text, word.videoId);
      // A no-op for starter-deck words, which do not count toward the limit;
      // the welcome guide's one real-video save does move the total.
      noteSavedCountChanged();
    }
    return { ok };
  },

  // ---- account-nudge state (savePrompt.ts owns the rules) ------------

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
   * days): same-tab (bus) and, where the platform has one, cross-context
   * (the driver's external feed — the browser 'storage' event).
   * Returns an unsubscribe function.
   */
  onWordsChanged(callback: () => void): () => void {
    const watchedKeys: readonly string[] = [
      KEYS.savedWords,
      KEYS.watched,
      KEYS.recallDays,
      KEYS.levelState,
    ];
    const offBus = wordsChanged.subscribe(callback);
    const offExternal = getStorageDriver()?.onExternalChange?.((key) => {
      if (key === null || watchedKeys.includes(key)) callback();
    });
    return () => {
      offBus();
      offExternal?.();
    };
  },

  getLanguage(): string {
    const driver = getStorageDriver();
    if (!driver) return 'en';
    return driver.local.getItem(KEYS.language) ?? 'en';
  },

  setLanguage(code: string): void {
    getStorageDriver()?.local.setItem(KEYS.language, code);
  },

  /**
   * Has the user finished (or skipped) the intro? First-timers are routed to
   * /welcome. Anyone with prior activity (saved words, watched videos) is
   * grandfathered in — existing users must never be dropped back into
   * onboarding just because the flag postdates their data.
   */
  isOnboarded(): boolean {
    const driver = getStorageDriver();
    if (!driver) return true; // SSR: never redirect from the server
    if (driver.local.getItem(KEYS.onboarded) === '1') return true;
    if (storage.getSavedWords().length > 0) return true;
    if (readJSON<string[]>(KEYS.watched, []).length > 0) return true;
    return false;
  },

  setOnboarded(value = true): void {
    const driver = getStorageDriver();
    if (!driver) return;
    if (value) driver.local.setItem(KEYS.onboarded, '1');
    else driver.local.removeItem(KEYS.onboarded);
  },

  /** Onboarding self-assessment. Distinct from getStartLevel (CEFR): this is
      what the user SAID, and it routes onboarding ('zero' -> starter deck). */
  getSelfLevel(): SelfLevel | null {
    const driver = getStorageDriver();
    if (!driver) return null;
    const v = driver.local.getItem(KEYS.level);
    return v === 'zero' || v === 'some' || v === 'confident' ? v : null;
  },

  setSelfLevel(level: SelfLevel): void {
    getStorageDriver()?.local.setItem(KEYS.level, level);
  },

  /** Has the starter deck been finished or skipped? Gates only the resume
      forward from /welcome — never access to the feed. */
  isStarterDone(): boolean {
    const driver = getStorageDriver();
    if (!driver) return true; // SSR: never redirect from the server
    return driver.local.getItem(KEYS.starterDone) === '1';
  },

  setStarterDone(): void {
    getStorageDriver()?.local.setItem(KEYS.starterDone, '1');
  },

  /** CEFR level from calibration. Seeds feed order only; behaviour corrects it. */
  getStartLevel(): Level | null {
    const driver = getStorageDriver();
    if (!driver) return null;
    const v = driver.local.getItem(KEYS.startLevel);
    return v === 'A1' || v === 'A2' || v === 'B1' || v === 'B2' ? v : null;
  },

  setStartLevel(level: Level): void {
    getStorageDriver()?.local.setItem(KEYS.startLevel, level);
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
    const driver = getStorageDriver();
    if (!driver) return true; // SSR: render nothing until hydrated
    return driver.local.getItem(KEYS.joinPromo) === '1';
  },

  dismissJoinPromo(): void {
    getStorageDriver()?.local.setItem(KEYS.joinPromo, '1');
  },

  // ---- starter-deck funnel (starterEvents.ts owns the shaping rules) ---

  getStarterEvents(): StarterEvent[] {
    return parseStarterEvents(readJSON<unknown>(KEYS.starterEvents, []));
  },

  /**
   * Record one deck event. The caller supplies everything but the id, which is
   * minted here — the id is what makes the sign-in merge idempotent, so it has
   * to come from the one place that also does the writing.
   *
   * Fire-and-forget by design: instrumentation must never be able to interrupt
   * the deck, so a failed write is dropped rather than surfaced (unlike a word
   * save, which the user is promised).
   */
  logStarterEvent(event: Omit<StarterEvent, 'id'>): void {
    const log = storage.getStarterEvents();
    const next = appendStarterEvent(log, { ...event, id: newEventId() });
    if (next === log) return; // duplicate or capped — nothing to write
    if (writeJSON(KEYS.starterEvents, next)) scheduleStarterEventsPush();
  },

  // ---- paywall funnel (entitlements/paywallEvents.ts owns the rules) ---

  getPaywallEvents(): PaywallEvent[] {
    return sanitizePaywallLog(readJSON<unknown>(KEYS.paywallEvents, []));
  },

  /**
   * Record one paywall event. Fire-and-forget by design, exactly like
   * logStarterEvent: instrumentation must never be able to break a save or hold a
   * modal closed, so a failed write is dropped rather than surfaced.
   */
  logPaywallEvent(event: Omit<PaywallEvent, 'id'>): void {
    const log = storage.getPaywallEvents();
    const next = appendPaywallEvent(log, { ...event, id: newEventId() });
    if (next === log) return; // duplicate, already-fired milestone, or capped
    if (writeJSON(KEYS.paywallEvents, next)) schedulePaywallEventsPush();
  },

  /**
   * Sound state for THIS session.
   *
   * Two layers, deliberately. The driver's session layer holds what is true
   * right now — including a mute the user chose ten seconds ago, which must
   * survive a navigation but not the session. The persistent layer holds
   * their standing CHOICE, so a user who turned sound on in the starter deck
   * is not asked again on their next visit; without it, the feed's
   * tap-for-sound pill greets every returning user who has already answered
   * that question.
   *
   * Persisting the choice is safe only because YouTubeMedia always starts
   * muted and restores sound on the first touch of the page load (see the
   * hasUserActivation note there): a stored "sound on" can therefore never
   * turn into an unmuted autoplay attempt, which is what phones refuse.
   */
  getSessionUnmuted(): boolean {
    const driver = getStorageDriver();
    if (!driver) return false;
    const session = driver.session.getItem(KEYS.unmuted);
    if (session !== null) return session === '1';
    return driver.local.getItem(KEYS.soundOn) === '1';
  },

  /**
   * Write the sound state. EVERY caller is a real user gesture — the feed's
   * tap-for-sound overlay, its rail toggle, the starter deck's first card tap
   * — which is exactly why this may persist the choice. The autoplay-policy
   * fallback (Feed's onAutoMuted) deliberately does NOT come through here: the
   * browser refusing sound is not the user choosing silence.
   */
  setSessionUnmuted(value: boolean): void {
    const driver = getStorageDriver();
    if (!driver) return;
    driver.session.setItem(KEYS.unmuted, value ? '1' : '0');
    driver.local.setItem(KEYS.soundOn, value ? '1' : '0');
  },
};
