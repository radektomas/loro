/**
 * THE RANKED FEED (Radek, 2026-10-03: "unseen videos first, but good unseen
 * videos with good ratings ... we need to filter out the shit videos").
 *
 * Measured before this existed: the median video was watched for 24% of its
 * length and 22% were swiped away inside three seconds, and the spread
 * between creators was enormous — the best kept people for 55-60% of a clip,
 * the worst for under 10% with half skipped at once. The feed was a flat
 * shuffle, so a new user met the worst as often as the best.
 *
 * Three rules, in order:
 *
 *   1. UNSEEN BEFORE SEEN, strictly. Nothing comes back while anything new is
 *      left (the old flat shuffle could open on a video you watched yesterday).
 *   2. GOOD BEFORE BAD, by weighted chance. Each video carries a 0..1 score
 *      from how everyone watched it (scripts/score-videos.mts). The order is a
 *      weighted shuffle — Efraimidis-Spirakis, key = u^(1/weight) — so a strong
 *      video is far more likely near the top, but the feed is still different
 *      every launch (a fixed best-first list would reopen the old "same videos
 *      every time" complaint, feedOrder.ts). A video with no score yet gets the
 *      catalog's average, so new content is shown and measured.
 *   3. BENCHED LAST. Videos the data says are bad, with enough views to say so,
 *      go after everything, seen included. Not deleted: a review can still land
 *      on one if a saved word came from it.
 *
 * Pure; randomness injectable for tests.
 */

export type FeedScores = {
  /** video id -> 0..1, higher is better. */
  scores: Record<string, number>;
  /** Video ids the data says to keep out of the way. */
  benched: string[];
  /** The average score, used for videos with no data yet. */
  prior: number;
  /** video id -> what it is about (scripts/tag-topics.mts). Optional: older files lack it. */
  topics?: Record<string, string[]>;
};

export const EMPTY_SCORES: FeedScores = { scores: {}, benched: [], prior: 0.5 };

/**
 * FOR YOU (Radek, 2026-10-06: "the feed leans that way ... I would still show
 * other topics, just less"). A video about a topic the user picked gets this
 * much added to its score. With SHARPNESS 4 that is about 1.8x the weight —
 * a clear lean, not a filter: the rest of the catalog still comes, and still
 * unseen-first.
 */
export const TOPIC_BONUS = 0.15;

/**
 * How much more often a better video comes first. exp(SHARPNESS * score):
 * with 4, a 0.6 video outweighs a 0.2 one about five to one — clearly
 * ordered, never deterministic.
 */
const SHARPNESS = 4;

export function rankFeed<V extends { id: string }>(
  videos: readonly V[],
  options: {
    watchedIds?: ReadonlySet<string>;
    scores?: FeedScores;
    /** The topics the user picked in onboarding (loro.mobile.topics). */
    liked?: ReadonlySet<string>;
    random?: () => number;
  } = {}
): V[] {
  const { watchedIds, scores = EMPTY_SCORES, liked, random = Math.random } = options;
  const benched = new Set(scores.benched);
  const keyed = videos.map((video) => {
    const about = scores.topics?.[video.id];
    const forYou = liked && liked.size > 0 && about?.some((t) => liked.has(t)) ? TOPIC_BONUS : 0;
    const score = (scores.scores[video.id] ?? scores.prior) + forYou;
    const weight = Math.exp(SHARPNESS * Math.min(1, Math.max(0, score)));
    // u in (0,1]; a larger key comes first.
    const u = Math.max(Number.EPSILON, random());
    return {
      video,
      group: benched.has(video.id) ? 2 : watchedIds?.has(video.id) ? 1 : 0,
      key: Math.pow(u, 1 / weight),
    };
  });
  keyed.sort((a, b) => a.group - b.group || b.key - a.key);
  return keyed.map((k) => k.video);
}

/** Read a published scores file defensively: anything malformed is "no scores". */
export function parseFeedScores(raw: unknown): FeedScores | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!r.scores || typeof r.scores !== 'object') return null;
  const scores: Record<string, number> = {};
  for (const [id, v] of Object.entries(r.scores as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) scores[id] = v;
  }
  const benched = Array.isArray(r.benched) ? r.benched.filter((x): x is string => typeof x === 'string') : [];
  const prior = typeof r.prior === 'number' && Number.isFinite(r.prior) ? r.prior : 0.5;
  const topics: Record<string, string[]> = {};
  if (r.topics && typeof r.topics === 'object') {
    for (const [id, list] of Object.entries(r.topics as Record<string, unknown>)) {
      if (Array.isArray(list)) topics[id] = list.filter((t): t is string => typeof t === 'string');
    }
  }
  return { scores, benched, prior, topics };
}
