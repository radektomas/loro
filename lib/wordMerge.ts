import type { SavedWord } from '@/types';

/**
 * Pure merge logic for saved-word histories — extracted from lib/storage.ts
 * so the anonymous -> signed-in merge is testable without localStorage or a
 * Supabase client. storage.ts owns transport (fetch, upsert, queues); this
 * module owns only the arithmetic of combining two word sets.
 *
 * Word identity here is (text, videoId) — the same localKey the whole app
 * uses. NOTE the DB's unique constraint is WIDER: (user_id, text, video_id,
 * cue_index). Two devices that saved the same word from different cues of
 * the same video therefore merge locally but upsert as separate rows; see
 * the merge-path notes in storage.ts.
 */

/** Same NUL-separated key as storage.ts localKey — words and video ids can
    both contain spaces, so a printable separator would collide. */
export function wordKey(text: string, videoId: string): string {
  return `${text}\u0000${videoId}`;
}

export function maxNullable(a: number | null, b: number | null): number | null {
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
export function mergeSum(local: SavedWord, remote: SavedWord): SavedWord {
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
export function mergePrefer(local: SavedWord, remote: SavedWord): SavedWord {
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

/**
 * Collapse duplicate rows for the same (text, videoId) into ONE word,
 * deterministically in EVERY field.
 *
 * WHY: the DB unique key is (user_id, text, video_id, cue_index) — wider
 * than the app's word identity — so a storage-evicted browser (or a second
 * device) that re-saved a word from a different cue leaves two server rows
 * for one word. Before this fold, fetchRemoteWords kept whichever row the
 * unordered SELECT returned last: which duplicate a device "saw" flipped
 * per fetch, hiding the other row's progress and re-triggering pushes
 * forever.
 *
 * Rules, in order:
 *   1. higher box wins outright (its schedule, state and cueIndex ride);
 *   2. counts are MAXed, earliest savedAt / latest lastReviewedAt kept
 *      (same semantics as mergePrefer — these are forks of one history,
 *      never independent, so summing would double-count);
 *   3. tie on box: the LOWEST cueIndex survives. Stable by construction,
 *      not by fetch order — cueIndex is the replay seek target and the
 *      blank-arming key, so a flapping winner would move where "replay"
 *      lands between fetches.
 *
 * Idempotent: folding a fold is a no-op, so hydrate cycles converge.
 */
export function foldDuplicateWords(words: readonly SavedWord[]): SavedWord[] {
  const groups = new Map<string, SavedWord[]>();
  for (const w of words) {
    const key = wordKey(w.text, w.videoId);
    const group = groups.get(key);
    if (group) group.push(w);
    else groups.set(key, [w]);
  }
  const folded: SavedWord[] = [];
  for (const group of groups.values()) {
    // Ascending cueIndex, then fold with the accumulator in mergePrefer's
    // tie-winning (second) slot: equal boxes resolve to the earlier — i.e.
    // lowest-cue — row, regardless of input order.
    group.sort((a, b) => a.cueIndex - b.cueIndex);
    folded.push(group.reduce((acc, next) => mergePrefer(next, acc)));
  }
  return folded;
}

/**
 * Is the locally merged word ahead of what remote holds — i.e. does it need
 * pushing? The single predicate hydrateFromRemote uses, exported so the
 * convergence contract (one fold + push cycle, then silence) is testable
 * against the real code.
 */
export function localAhead(merged: SavedWord, remote: SavedWord): boolean {
  return (
    merged.box > remote.box ||
    merged.correct > remote.correct ||
    merged.incorrect > remote.incorrect
  );
}

/**
 * The full anon -> signed-in union: every remote word, every local word,
 * common (text, videoId) pairs combined via mergeSum. This is exactly the
 * set transitionMergeUp() upserts — one entry per key, so the upsert can
 * never write duplicates for the same key.
 */
export function mergeWordSets(
  local: readonly SavedWord[],
  remote: readonly SavedWord[]
): SavedWord[] {
  const merged = new Map<string, SavedWord>();
  for (const r of remote) merged.set(wordKey(r.text, r.videoId), r);
  for (const l of local) {
    const key = wordKey(l.text, l.videoId);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeSum(l, existing) : l);
  }
  return [...merged.values()];
}
