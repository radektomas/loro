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
 * other topics, just less"). A score bonus was tried first and lost: food
 * clips are mostly long cooking videos (median 59 s), the short-first bonus
 * pushes those down, and a user who picked only food saw 1.3 food videos in
 * their first ten on average and none at all 23% of the time ("after I
 * clicked food only, I didn't see a food short in my first 10 videos").
 *
 * So the lean is a RHYTHM, not a weight: within each group, every LIKED_EVERY
 * videos, LIKED_SLOTS of them are about a liked topic — the first video
 * included — each side keeping its own ranked order. When the liked videos
 * run out, the rest simply continues. Nothing is filtered.
 */
export const LIKED_EVERY = 5;
const LIKED_SLOTS = new Set([0, 2]);

/**
 * How much more often a better video comes first. exp(SHARPNESS * score):
 * with 4, a 0.6 video outweighs a 0.2 one about five to one — clearly
 * ordered, never deterministic.
 */
const SHARPNESS = 4;

/**
 * LEVEL FIRST (Radek, 2026-10-12: "beginners really get EASY videos, better
 * Spanish speakers … more native speaking fast"). Until this the feed never
 * looked at the user's level: a "zero" beginner could open on a 4-words-a-
 * second B2 clip. A video's `level` is estimateLevel()'s, which is speech
 * rate (A1 ≈ 1.7 words/s, A2 ≈ 2.5, B1 ≈ 3.2, B2 ≈ 3.8 — measured
 * 2026-10-12), so the window is really "how fast can you follow".
 *
 * The user's window: A1 → A1+A2, A2 → A2+B1, B1 → B1+B2, B2 → B2+B1.
 * The first LEVEL_STRICT videos of each group come only from the window
 * (while it has any) — that is the stretch where people decide to stay.
 * After it, every LEVEL_EVERY-th slot is an outside video, nearest level
 * first, so the feed still stretches them and never runs dry.
 */
export type FeedLevel = 'A1' | 'A2' | 'B1' | 'B2';
const LEVELS: readonly FeedLevel[] = ['A1', 'A2', 'B1', 'B2'];
const WINDOW: Record<FeedLevel, readonly FeedLevel[]> = {
  A1: ['A1', 'A2'],
  A2: ['A2', 'B1'],
  B1: ['B1', 'B2'],
  B2: ['B2', 'B1'],
};
export const LEVEL_STRICT = 10;
export const LEVEL_EVERY = 5;

export function rankFeed<V extends { id: string; level?: string }>(
  videos: readonly V[],
  options: {
    watchedIds?: ReadonlySet<string>;
    scores?: FeedScores;
    /** The topics the user picked in onboarding (loro.mobile.topics). */
    liked?: ReadonlySet<string>;
    /** The user's CEFR level (onboarding, raised by their blue-blank tier). */
    level?: FeedLevel;
    random?: () => number;
  } = {}
): V[] {
  const { watchedIds, scores = EMPTY_SCORES, liked, level, random = Math.random } = options;
  const benched = new Set(scores.benched);
  const keyed = videos.map((video) => {
    const score = scores.scores[video.id] ?? scores.prior;
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
  const leanTopics = Boolean(liked && liked.size > 0 && scores.topics);
  if (!leanTopics && !level) return keyed.map((k) => k.video);

  const isLiked = (video: V) => scores.topics?.[video.id]?.some((t) => liked?.has(t)) ?? false;
  /** The topic rhythm over one already-ranked list. */
  const lean = (list: V[]): V[] => {
    if (!leanTopics) return list;
    const mine = list.filter(isLiked);
    const rest = list.filter((v) => !isLiked(v));
    const out: V[] = [];
    let m = 0;
    let r = 0;
    while (m < mine.length || r < rest.length) {
      const wantMine = LIKED_SLOTS.has(out.length % LIKED_EVERY);
      if ((wantMine && m < mine.length) || r >= rest.length) out.push(mine[m++]);
      else out.push(rest[r++]);
    }
    return out;
  };

  const out: V[] = [];
  for (const group of [0, 1, 2]) {
    const inGroup = keyed.filter((k) => k.group === group).map((k) => k.video);
    if (!level) {
      out.push(...lean(inGroup));
      continue;
    }
    const window = WINDOW[level];
    const at = LEVELS.indexOf(level);
    const distance = (v: V) => {
      const i = LEVELS.indexOf(v.level as FeedLevel);
      return i < 0 ? LEVELS.length : Math.abs(i - at);
    };
    const inside = lean(inGroup.filter((v) => window.includes(v.level as FeedLevel)));
    // Stable sort: nearest level first, ranked order kept within a distance.
    const outside = lean(
      inGroup
        .filter((v) => !window.includes(v.level as FeedLevel))
        .map((v, i) => ({ v, i, d: distance(v) }))
        .sort((a, b) => a.d - b.d || a.i - b.i)
        .map((x) => x.v)
    );
    let a = 0;
    let b = 0;
    for (let slot = 0; a < inside.length || b < outside.length; slot++) {
      const wantOutside = slot >= LEVEL_STRICT && slot % LEVEL_EVERY === LEVEL_EVERY - 1;
      if ((wantOutside && b < outside.length) || a >= inside.length) out.push(outside[b++]);
      else out.push(inside[a++]);
    }
  }
  return out;
}

/** The feed level for a user: the higher of what onboarding said and what
    their blue-blank tier has climbed to (tier 1 ≈ A1 … 4+ ≈ B2). */
export function feedLevelFor(startLevel: FeedLevel | null, tier: number): FeedLevel {
  const fromTier: FeedLevel = tier >= 4 ? 'B2' : tier === 3 ? 'B1' : tier === 2 ? 'A2' : 'A1';
  const fromStart = startLevel ?? 'A1';
  return LEVELS.indexOf(fromTier) > LEVELS.indexOf(fromStart) ? fromTier : fromStart;
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
