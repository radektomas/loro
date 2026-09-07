import type { Level, SavedWord, Video } from './types.ts';
import { computeBlankPlan } from './srs.ts';

/**
 * Feed ordering.
 *
 * Three rules, in priority order:
 *
 *  1. UNSEEN FIRST. The complaint that prompted this: opening the app showed
 *     the same videos in the same order every time, so a returning user had
 *     to scroll past everything they had already watched to reach anything
 *     new. Freshness outranks level, because a video you have already seen
 *     teaches far less than one you have not — whatever its level.
 *  2. CLOSEST TO THE USER'S LEVEL. Within each of those two groups, order by
 *     distance from the calibrated level, so a beginner still opens on
 *     beginner content.
 *  3. RANDOM WITHIN A TIE. Videos at the same distance are shuffled, so the
 *     feed differs between sessions. This is the fix for "same videos below
 *     each other": previously ties kept source order, and Array.sort is
 *     stable, so the result was byte-identical on every open.
 *
 * Deliberately NOT persisted. A fresh order per session is the point; a
 * remembered shuffle would reproduce the original complaint one step later.
 *
 * Must only run on the client — it reads Math.random and localStorage-derived
 * watch state, and both would differ between server and client render.
 */

const LEVEL_ORDER: readonly Level[] = ['A1', 'A2', 'B1', 'B2'];

export type FeedOrderOptions = {
  /** Video ids the user has already watched or saved a word from. */
  watchedIds?: ReadonlySet<string>;
  /** Injectable randomness, so the ordering can be tested deterministically. */
  random?: () => number;
};

/** Fisher-Yates, in place. Unbiased, unlike sort(() => random() - 0.5). */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function orderVideosForLevel(
  videos: readonly Video[],
  level: Level,
  options: FeedOrderOptions = {}
): Video[] {
  const { watchedIds, random = Math.random } = options;
  const target = LEVEL_ORDER.indexOf(level);
  const distance = (video: Video): number => {
    const at = LEVEL_ORDER.indexOf(video.level);
    // An unknown level sorts as "far" rather than as the user's own level,
    // which indexOf's -1 would otherwise do for A1 users.
    return at < 0 ? LEVEL_ORDER.length : Math.abs(at - target);
  };

  // Shuffle first, then sort: Array.sort is stable, so equal keys keep the
  // shuffled order. Sorting with a random comparator instead would be both
  // biased and, in V8, not a valid comparator.
  const shuffled = shuffle([...videos], random);

  return shuffled.sort((a, b) => {
    if (watchedIds) {
      const seenA = watchedIds.has(a.id) ? 1 : 0;
      const seenB = watchedIds.has(b.id) ? 1 : 0;
      if (seenA !== seenB) return seenA - seenB;
    }
    return distance(a) - distance(b);
  });
}

/**
 * A REVIEW SESSION IS THE TOP OF THE FEED.
 *
 * "5 words ready to review" used to land the user on one due word and then
 * hand them the ordinary shuffle, where the next video almost never spoke
 * another. Measured on the newest real user: 178 due words, 57 of them
 * spoken only in videos already watched — which the feed had no reason to
 * show again. Tapping Review met one word, then nothing.
 *
 * So when a review is launched the feed is re-cut: the landing video first,
 * then up to `max` videos that will actually BLANK a due word right now
 * (verified through the same computeBlankPlan the slide will run, so a
 * video is never lifted on the strength of merely speaking a word the caps
 * would drop), then everything else. Order within each group is the
 * caller's — pass an already shuffled list and it stays shuffled.
 *
 * Bounded on purpose. The lift exists so a review session has a next
 * video; it is not a return to unseen-first or level ordering, both of
 * which the mobile feed dropped deliberately (FeedScreen.orderFeed). Past
 * `max` the feed is the feed.
 */
export const REVIEW_LIFT_MAX = 8;

export function liftDueVideos<V extends Video>(
  videos: readonly V[],
  words: readonly SavedWord[],
  options: { landingId?: string | null; now?: number; max?: number } = {}
): V[] {
  return liftDueBlock(videos, words, options).videos;
}

/**
 * liftDueVideos, plus WHICH videos were lifted: the landing and the due
 * ones, in order — the review session's block. The feed ends a session
 * when the user swipes past the last of them (apps/mobile reviewSession).
 */
export function liftDueBlock<V extends Video>(
  videos: readonly V[],
  words: readonly SavedWord[],
  options: { landingId?: string | null; now?: number; max?: number } = {}
): { videos: V[]; block: string[] } {
  const { landingId = null, now = Date.now(), max = REVIEW_LIFT_MAX } = options;
  const landing: V[] = [];
  const due: V[] = [];
  const rest: V[] = [];
  for (const video of videos) {
    if (landingId !== null && video.id === landingId) {
      landing.push(video);
    } else if (
      due.length < max &&
      computeBlankPlan(video, words as SavedWord[], now).size > 0
    ) {
      due.push(video);
    } else {
      rest.push(video);
    }
  }
  const lifted = [...landing, ...due];
  return { videos: [...lifted, ...rest], block: lifted.map((v) => v.id) };
}
