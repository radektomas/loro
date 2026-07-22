import { getSupabase, TABLES } from '@/lib/supabase';

/**
 * Follow state for creators — localStorage-first, mirroring the saved-words
 * engine in lib/storage.ts:
 *
 *  - localStorage is the synchronous source of truth the UI reads; the whole
 *    public API is promise-free. Anonymous users touch localStorage only.
 *  - When a user is signed in, writes are queued and pushed to Supabase
 *    (loro_follows) in the background — optimistic, debounced, retried on
 *    failure. The UI never awaits any of it.
 *  - Auth transitions (merge-on-signin, hydrate, switch-user) are DRIVEN BY
 *    storage.ts: its handleSession owns the single cache-owner decision
 *    (loro.syncedUser) and calls handleFollowsAuth with the verdict, so both
 *    caches always agree on whose data localStorage holds. This module must
 *    never import storage.ts — that would be a cycle.
 *
 * One deliberate difference from words: merge-up and hydrate share one
 * implementation. A follow has no per-item history to reconcile (no boxes,
 * no counts) — both directions reduce to a set union pushed up with
 * on-conflict-do-nothing, which is also exactly what the anon -> signed-in
 * spec asks for.
 */

const KEYS = {
  follows: 'loro.follows', // creator ids the user follows — the UI's truth
  queue: 'loro.followsQueue', // pending remote writes (survives reload)
} as const;

/** Fired on window whenever follow state changes (same-tab updates). */
const FOLLOWS_CHANGED = 'loro:follows-changed';

const isBrowser = typeof window !== 'undefined';

// Read/write helpers duplicated from storage.ts on purpose: storage.ts calls
// into this module on auth changes, so importing them back would be circular.

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
    console.error(`[loro] localStorage write failed for "${key}"`, err);
    return false;
  }
}

function emitFollowsChanged(): void {
  if (isBrowser) window.dispatchEvent(new Event(FOLLOWS_CHANGED));
}

function readFollows(): string[] {
  return readJSON<unknown[]>(KEYS.follows, []).filter(
    (id): id is string => typeof id === 'string'
  );
}

// ---- pending write queue: one op per creator, latest wins (a follow/unfollow
// flip-flop collapses to its final state before anything is sent).

type FollowOp = { op: 'follow' | 'unfollow'; creatorId: string };

function readQueue(): FollowOp[] {
  return readJSON<FollowOp[]>(KEYS.queue, []);
}

let currentUserId: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function enqueue(op: 'follow' | 'unfollow', creatorId: string): void {
  if (!currentUserId) return; // anonymous — local only, merged on sign-in
  const queue = readQueue().filter((i) => i.creatorId !== creatorId);
  queue.push({ op, creatorId });
  writeJSON(KEYS.queue, queue);
  scheduleFlush();
}

function scheduleFlush(delayMs = 800): void {
  if (!isBrowser || !currentUserId) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushFollowsQueue();
  }, delayMs);
}

/**
 * Errors no retry can fix: the creator row is gone (foreign key, 23503) or
 * RLS refused the write outright (42501, e.g. the creator lost approved
 * status). Words retry everything forever; follows can't, because a cascade-
 * deleted creator would wedge the queue into a permanent 5-second error loop.
 * The op is dropped and the local follow undone, so the UI matches reality.
 */
const PERMANENT_ERROR_CODES = new Set(['23503', '42501']);

/**
 * Push queued follow ops to Supabase. The effective op comes from CURRENT
 * local state (mirroring words): a queued follow whose creator has since been
 * unfollowed is sent as the unfollow, and vice versa. Ops go one at a time —
 * they are rare, and per-item errors are what lets a single dead creator id
 * be dropped without poisoning the rest of the queue. Failures stay queued
 * and retry with backoff, so a follow is never silently lost.
 */
export async function flushFollowsQueue(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || !currentUserId) return;
  const queue = readQueue();
  if (queue.length === 0) return;

  const userId = currentUserId;
  const local = new Set(readFollows());
  const stillFailed: FollowOp[] = [];

  for (const item of queue) {
    const op: FollowOp['op'] = local.has(item.creatorId)
      ? 'follow'
      : 'unfollow';
    const { error } =
      op === 'follow'
        ? await supabase
            .from(TABLES.follows)
            .upsert(
              { follower_id: userId, creator_id: item.creatorId },
              {
                onConflict: 'follower_id,creator_id',
                ignoreDuplicates: true,
              }
            )
        : await supabase
            .from(TABLES.follows)
            .delete()
            .match({ follower_id: userId, creator_id: item.creatorId });
    if (!error) continue;
    if (PERMANENT_ERROR_CODES.has(error.code)) {
      console.error(
        `[loro] follow sync dropped for ${item.creatorId}`,
        error.message
      );
      if (op === 'follow' && local.delete(item.creatorId)) {
        writeJSON(KEYS.follows, [...local]);
        emitFollowsChanged();
      }
      continue;
    }
    console.error('[loro] follow sync failed', error.message);
    stillFailed.push({ op, creatorId: item.creatorId });
  }

  writeJSON(KEYS.queue, stillFailed);
  if (stillFailed.length > 0) scheduleFlush(5000); // back off and retry
}

/**
 * Reconcile local follows with the user's loro_follows rows: adopt the union,
 * except ids with a pending unfollow (queued offline — the remote copy must
 * not resurrect them), and queue local-only ids for upload. The actual upload
 * rides flushFollowsQueue, so merge and steady-state pushes share one code
 * path — including the per-item dead-creator handling. A failed remote read
 * leaves the cache and queue untouched; the next auth event or flush retries.
 */
async function syncWithRemote(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { data, error } = await supabase
    .from(TABLES.follows)
    .select('creator_id')
    .eq('follower_id', userId);
  if (error) {
    console.error('[loro] fetch remote follows failed', error.message);
    return;
  }

  const local = readFollows();
  const localSet = new Set(local);
  const pendingUnfollow = new Set(
    readQueue()
      .map((i) => i.creatorId)
      .filter((id) => !localSet.has(id))
  );
  const remote = (data as { creator_id: string }[])
    .map((r) => r.creator_id)
    .filter((id) => !pendingUnfollow.has(id));

  const merged = [...new Set([...local, ...remote])];
  writeJSON(KEYS.follows, merged);
  emitFollowsChanged();

  const remoteSet = new Set(remote);
  for (const id of local) {
    if (!remoteSet.has(id)) enqueue('follow', id);
  }
}

// ---------------------------------------------------------- auth transitions
// Called ONLY by storage.ts's handleSession, which owns event dedup and the
// cache-owner decision. The modes mirror the words engine's three branches;
// hydrate and merge-up intentionally share syncWithRemote (see module docs).

export type FollowsAuthMode = 'hydrate' | 'merge-up' | 'switch-user';

/** Signed out: keep the cache as an anonymous working copy, stop syncing. */
export function handleFollowsSignOut(): void {
  currentUserId = null;
}

export async function handleFollowsAuth(
  userId: string,
  mode: FollowsAuthMode
): Promise<void> {
  currentUserId = userId;
  if (mode === 'switch-user') {
    // A different user owned this cache — never leak their follows into
    // this account. Drop the local copy and hydrate fresh from remote.
    writeJSON(KEYS.follows, []);
    writeJSON(KEYS.queue, []);
    emitFollowsChanged();
  }
  await syncWithRemote(userId);
  void flushFollowsQueue();
}

// ------------------------------------------------------------------- the API

export const follows = {
  getFollowedCreatorIds(): string[] {
    return readFollows();
  },

  isFollowing(creatorId: string): boolean {
    return readFollows().includes(creatorId);
  },

  /**
   * Follow a creator. `ok` is true only after a verified round-trip (write
   * succeeded AND reads back) — the follow button reverts unless `ok` is
   * true. Network sync is queued and retried; it never blocks or reverts
   * the UI, exactly like word saves.
   */
  follow(creatorId: string): { ok: boolean } {
    const ids = readFollows();
    const next = ids.includes(creatorId) ? ids : [...ids, creatorId];
    const ok = writeJSON(KEYS.follows, next) && follows.isFollowing(creatorId);
    if (ok) {
      emitFollowsChanged();
      enqueue('follow', creatorId);
    }
    return { ok };
  },

  unfollow(creatorId: string): { ok: boolean } {
    const next = readFollows().filter((id) => id !== creatorId);
    const ok = writeJSON(KEYS.follows, next) && !follows.isFollowing(creatorId);
    if (ok) {
      emitFollowsChanged();
      enqueue('unfollow', creatorId);
    }
    return { ok };
  },

  /**
   * Subscribe to follow changes: same-tab (custom event) and cross-tab
   * (native storage event). Returns an unsubscribe function.
   */
  onFollowsChanged(callback: () => void): () => void {
    if (!isBrowser) return () => {};
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === KEYS.follows) callback();
    };
    window.addEventListener(FOLLOWS_CHANGED, callback);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(FOLLOWS_CHANGED, callback);
      window.removeEventListener('storage', onStorage);
    };
  },
};
