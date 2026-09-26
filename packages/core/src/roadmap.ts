import type { SavedWord } from './types.ts';
import { distinctWords, isLearned } from './progress.ts';
import { normalizeAnswer } from './srs.ts';

/**
 * THE WORD ROADMAP (Radek, 2026-09-26, branch words-roadmap — an idea on
 * trial, not a shipped rule).
 *
 * A heavy user had ~200 saved words, all of them competing for blanks at
 * once: "its a chaos". The roadmap lays the words out in the order they
 * were SAVED and lets only a handful be open at a time. Learning one opens
 * the next. Nothing is deleted and nothing is re-scheduled — a locked word
 * keeps its box and its dueAt exactly as they were; it is simply not ASKED
 * until the path reaches it.
 *
 * Pure functions only. The gate is enforced where the words are asked and
 * counted — srs.computeBlankPlan and progress.readyWords / dueCount /
 * nextDueAt — which all already receive the whole saved list, so no caller
 * has to remember to filter.
 */

/** How many not-yet-done words are open at once. */
export const OPEN_SLOTS = 20;

/** Words per stage on the path — a heading every this many nodes. */
export const STAGE_SIZE = 10;

export type RoadmapStatus = 'done' | 'open' | 'locked';

export type RoadmapNode = {
  /** normalizeAnswer(text) — the identity the planner practises on. */
  key: string;
  /** The most advanced entry for this surface (progress.distinctWords). */
  word: SavedWord;
  /** When the surface was FIRST saved, from any video — its place on the path. */
  savedAt: number;
  status: RoadmapStatus;
};

/**
 * DONE, for the path: the same line the Words tab's Learned face draws
 * (feed/wordLearned.onLearnedFace) — earned through review, or filed as
 * known (a starter-deck grant). A word that slipped is not done: it takes
 * an open slot again until it is earned back.
 */
export function isDoneOnPath(word: SavedWord): boolean {
  return word.state !== 'lapsed' && (isLearned(word) || word.state === 'known');
}

/** The whole path, in save order: done, then the open window, then locked. */
export function buildRoadmap(
  words: readonly SavedWord[],
  openSlots: number = OPEN_SLOTS
): RoadmapNode[] {
  const firstSaved = new Map<string, number>();
  for (const w of words) {
    const key = normalizeAnswer(w.text);
    if (!key) continue;
    const held = firstSaved.get(key);
    if (held === undefined || w.savedAt < held) firstSaved.set(key, w.savedAt);
  }
  const nodes = distinctWords(words)
    .map((word) => {
      const key = normalizeAnswer(word.text);
      return { key, word, savedAt: firstSaved.get(key) ?? word.savedAt };
    })
    .sort((a, b) => a.savedAt - b.savedAt || a.key.localeCompare(b.key));

  let open = 0;
  const marked = nodes.map((n) => {
    // A surface is done when ANY of its rows is (distinctWords keeps the
    // highest box, which is the done row whenever there is one — except a
    // lapsed higher-box row, which is exactly the word that should reopen).
    if (isDoneOnPath(n.word)) return { ...n, status: 'done' as const };
    if (open < openSlots) {
      open++;
      return { ...n, status: 'open' as const };
    }
    return { ...n, status: 'locked' as const };
  });
  /**
   * LEARNED TOGETHER, THEN WHAT IS NEXT (Radek, 2026-09-26: "learned should
   * be together and the openings one are after them"). The open window is
   * chosen in SAVE order above; the path is then DRAWN done-first — in the
   * order they were learned — then the open words, then the waiting ones,
   * each of those in save order. So the road behind you is all learned and
   * the road ahead is the words in the order you met them.
   */
  const rank = { done: 0, open: 1, locked: 2 } as const;
  const doneAt = (n: RoadmapNode) => n.word.learnedAt ?? n.word.lastReviewedAt ?? n.savedAt;
  return marked.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.status === 'done' ? doneAt(a) - doneAt(b) : 0) ||
      a.savedAt - b.savedAt ||
      a.key.localeCompare(b.key)
  );
}

/** The next word on the path: the first open one, where "You're here" sits. */
export function nextUp(words: readonly SavedWord[]): RoadmapNode | null {
  return buildRoadmap(words).find((n) => n.status === 'open') ?? null;
}

/**
 * The surfaces the path has not reached yet. Cached per list identity —
 * the blank planner calls this on every slide with the same array.
 */
const lockedCache = new WeakMap<readonly SavedWord[], Set<string>>();

export function lockedKeys(words: readonly SavedWord[]): Set<string> {
  const hit = lockedCache.get(words);
  if (hit) return hit;
  const keys = new Set<string>();
  for (const n of buildRoadmap(words)) if (n.status === 'locked') keys.add(n.key);
  lockedCache.set(words, keys);
  return keys;
}

/** Is this word still waiting on the path? */
export function isLocked(word: SavedWord, words: readonly SavedWord[]): boolean {
  const key = normalizeAnswer(word.text);
  return key !== '' && lockedKeys(words).has(key);
}

/**
 * What changed between two lists: the surfaces that were locked before and
 * are open now. The learned moment reads this to say which word it opened.
 */
export function newlyOpened(
  before: readonly SavedWord[],
  after: readonly SavedWord[]
): RoadmapNode[] {
  const was = lockedKeys(before);
  return buildRoadmap(after).filter((n) => n.status === 'open' && was.has(n.key));
}
