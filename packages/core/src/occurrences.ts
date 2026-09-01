// Relative and extension-ed, not '@/lib/…': this module loads under plain node
// for its test (same rule as savePrompt.ts).
import { normalizeSurface } from './dictionary.ts';
import { computeBlankPlan, normalizeAnswer } from './srs.ts';
import { MIN_TARGET_AUDIBLE_S } from './starter/rounds.ts';
import type { SavedWord, Video } from './types.ts';

/**
 * Where a word is audibly spoken across the catalog — the lookup behind
 * "hear it in a video" on the Words screen.
 *
 * Matched accent-exactly (normalizeSurface), the same rule as the starter
 * deck's targetOccurrences: matching through normalizeAnswer could resolve
 * "él" to a spoken article "el" and time playback to the wrong word. The
 * audibility floor is also the deck's (MIN_TARGET_AUDIBLE_S, 0.2s), because
 * this exists to let the user HEAR the word — a 0.1s mumble is not that.
 */
export type WordOccurrence = {
  videoId: string;
  /** null for hosted (non-embed) clips — the modal player needs YouTube. */
  youtubeId: string | null;
  cueIndex: number;
  /** Which word OF THAT CUE — a cue that says the word twice must blank the
      one that was actually timed, not the first spelling that matches. */
  wordIndex: number;
  /** Seconds — the word's audible span inside the video. */
  start: number;
  end: number;
};

/** Every audible occurrence of `text` across `videos`, in catalog order. */
export function findWordOccurrences(
  videos: readonly Video[],
  text: string
): WordOccurrence[] {
  const wanted = normalizeSurface(text);
  if (!wanted) return [];
  const found: WordOccurrence[] = [];
  for (const video of videos) {
    video.cues.forEach((cue, cueIndex) => {
      cue.words.forEach((word, wordIndex) => {
        if (word.end - word.start < MIN_TARGET_AUDIBLE_S) return;
        if (normalizeSurface(word.text) !== wanted) return;
        found.push({
          videoId: video.id,
          youtubeId: video.youtubeId ?? null,
          cueIndex,
          wordIndex,
          start: word.start,
          end: word.end,
        });
      });
    });
  }
  return found;
}

/**
 * Pick where to replay a saved word. Excludes the source cue itself (the user
 * already knows that one — it's where they saved the word); prefers an
 * occurrence in a DIFFERENT video, falls back to another cue of the same
 * video, else null — and null is a first-class outcome the caller must handle
 * by hiding the affordance: measured on the catalog, 67% of surfaces appear
 * in exactly one video.
 *
 * `requireYoutube` filters to embeddable videos (the modal player is a
 * YouTube embed). `random` is injectable for deterministic tests.
 */
export function pickReplayOccurrence(
  occurrences: readonly WordOccurrence[],
  source: { videoId: string; cueIndex: number },
  opts: { requireYoutube?: boolean; random?: () => number } = {}
): WordOccurrence | null {
  const random = opts.random ?? Math.random;
  const usable = occurrences.filter(
    (o) =>
      !(o.videoId === source.videoId && o.cueIndex === source.cueIndex) &&
      (!opts.requireYoutube || o.youtubeId !== null)
  );
  if (usable.length === 0) return null;
  const elsewhere = usable.filter((o) => o.videoId !== source.videoId);
  const pool = elsewhere.length > 0 ? elsewhere : usable;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** Where a "review this word" tap should drop the user. */
export type ReviewLanding = {
  videoId: string;
  /** The cue that will carry the blank. */
  cueIndex: number;
  /** Seconds — where the blanked word starts, so the feed can lead into it. */
  startsAt: number;
  /** False when nothing in the catalog would blank the word right now. */
  willBlank: boolean;
};

/**
 * WHERE TO SEND THE FEED so that "review this word" is not a lie.
 *
 * Landing on a video that merely SPEAKS the word is not enough, and that gap
 * is what made a targeted review still feel random. The feed only asks what
 * computeBlankPlan chooses, and the plan has caps: five blanks per video, one
 * per cue, at most one inside the first two cues. A word whose cue sits behind
 * five more urgent ones is spoken on screen and never asked — and even when it
 * is asked, a plan built from the top of the video walks the user through
 * everyone else's blanks on the way to theirs.
 *
 * Both are the plan's own business to fix, which is what computeBlankPlan's
 * `first` option does: the asked-for word is placed at its earliest audible
 * cue, exempt from the caps, with nothing blanked before it. This function's
 * job is narrower — pick the video, and report the exact cue and second the
 * plan settled on so the caller can open the video AT the word rather than at
 * its beginning.
 *
 * Preference order: the caller's clip (the one just heard) → the video the
 * word was saved from → catalog order.
 *
 * `willBlank: false` is an honest outcome, not a failure: the word is not due,
 * or nothing embeddable says it audibly, and the caller is landing on the best
 * clip available anyway. Worth logging; not worth hiding.
 *
 * Only embeddable videos are candidates — the feed is embeds-only.
 */
export function pickReviewTarget(
  videos: readonly Video[],
  word: SavedWord,
  allWords: SavedWord[],
  opts: { preferVideoId?: string; now?: number } = {}
): ReviewLanding | null {
  const now = opts.now ?? Date.now();
  // The plan matches cue words through normalizeAnswer, so the check has to
  // ask the same question the feed will ask.
  const wanted = normalizeAnswer(word.text);
  if (!wanted) return null;

  const occurrences = findWordOccurrences(videos, word.text).filter(
    (o) => o.youtubeId !== null
  );
  if (occurrences.length === 0) return null;

  const order: string[] = [];
  for (const preferred of [opts.preferVideoId, word.videoId]) {
    if (preferred && occurrences.some((o) => o.videoId === preferred)) {
      order.push(preferred);
    }
  }
  for (const occurrence of occurrences) order.push(occurrence.videoId);

  const seen = new Set<string>();
  let fallback: ReviewLanding | null = null;
  for (const videoId of order) {
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    const video = videos.find((v) => v.id === videoId);
    if (!video) continue;
    if (fallback === null) {
      const occurrence = occurrences.find((o) => o.videoId === videoId);
      if (occurrence) {
        fallback = {
          videoId,
          cueIndex: occurrence.cueIndex,
          startsAt: occurrence.start,
          willBlank: false,
        };
      }
    }
    const planned = planFor(video, word, allWords, now);
    if (planned) return planned;
  }
  return fallback;
}

/** The verification both pickers share: does this video's plan, told to put
    `word` first, actually blank it — and at which second? */
function planFor(
  video: Video,
  word: SavedWord,
  allWords: SavedWord[],
  now: number
): ReviewLanding | null {
  const wanted = normalizeAnswer(word.text);
  const plan = computeBlankPlan(video, allWords, now, { first: word.text });
  for (const [cueIndex, planned] of plan) {
    if (normalizeAnswer(planned.text) !== wanted) continue;
    // The plan matches accent-INSENSITIVELY, so read the second back off the
    // cue the same way: this is where the blank will be, which is the only
    // place worth opening the video at.
    const spoken = video.cues[cueIndex].words.find(
      (w) => normalizeAnswer(w.text) === wanted
    );
    return {
      videoId: video.id,
      cueIndex,
      startsAt: spoken ? spoken.start : video.cues[cueIndex].start,
      willBlank: true,
    };
  }
  return null;
}

/**
 * THE REVIEW CTA'S LANDING — the first due word the catalog can actually
 * blank, scanned in the caller's urgency order.
 *
 * WHY THIS EXISTS when pickReviewTarget already does (2026-09-01, on
 * device): the Words tab's "review" button used to try pickReviewTarget on
 * a handful of its most urgent due words and give up, and on a device with
 * history the most urgent words are exactly the ones the catalog has lost —
 * saved from pruned videos, never spoken elsewhere. The button then
 * switched tabs with no target parked and the user landed on whatever
 * paused video the feed was left on, which reads as the button doing
 * nothing. Capping harder was not the fix, because each pickReviewTarget
 * call folds the whole catalog for ONE word; this scans every candidate in
 * ONE fold, so trying all of them costs what trying five used to.
 *
 * The fold mirrors findWordOccurrences' rules exactly (accent-exact match,
 * the audibility floor, embeds only), and each candidate video is verified
 * through the same computeBlankPlan-with-`first` check pickReviewTarget
 * runs (planFor, shared). Per word, the saved-from video is tried first,
 * then catalog order, capped — a word whose first few speakers all refuse
 * to blank it is a word to move past, not to exhaust the catalog on.
 *
 * Returns the first candidate that WILL blank; failing every candidate, a
 * fallback landing on the most urgent word that is at least audibly SPOKEN
 * somewhere (willBlank false — the caller decides whether that beats not
 * jumping); null only when no candidate is spoken anywhere at all.
 */
const BLANK_VIDEOS_TRIED_PER_WORD = 4;

export function pickFirstBlankTarget(
  videos: readonly Video[],
  candidates: readonly SavedWord[],
  allWords: SavedWord[],
  opts: { now?: number } = {}
): { word: SavedWord; landing: ReviewLanding } | null {
  const now = opts.now ?? Date.now();

  const surfaces = new Set<string>();
  for (const word of candidates) {
    const s = normalizeSurface(word.text);
    if (s) surfaces.add(s);
  }
  if (surfaces.size === 0) return null;

  /** surface -> videoIds that audibly speak it (catalog order, deduped),
      plus the first occurrence for the spoken-only fallback. */
  const spoken = new Map<
    string,
    { videoIds: string[]; first: { videoId: string; cueIndex: number; start: number } }
  >();
  const byId = new Map<string, Video>();
  for (const video of videos) {
    if (!video.youtubeId) continue;
    byId.set(video.id, video);
    const seenHere = new Set<string>();
    for (const [cueIndex, cue] of video.cues.entries()) {
      for (const word of cue.words) {
        if (word.end - word.start < MIN_TARGET_AUDIBLE_S) continue;
        const s = normalizeSurface(word.text);
        if (!surfaces.has(s) || seenHere.has(s)) continue;
        seenHere.add(s);
        const entry = spoken.get(s);
        if (entry) entry.videoIds.push(video.id);
        else
          spoken.set(s, {
            videoIds: [video.id],
            first: { videoId: video.id, cueIndex, start: word.start },
          });
      }
    }
  }

  let fallback: { word: SavedWord; landing: ReviewLanding } | null = null;
  for (const word of candidates) {
    const entry = spoken.get(normalizeSurface(word.text));
    if (!entry) continue;
    if (fallback === null) {
      fallback = {
        word,
        landing: {
          videoId: entry.first.videoId,
          cueIndex: entry.first.cueIndex,
          startsAt: entry.first.start,
          willBlank: false,
        },
      };
    }
    const order = entry.videoIds.includes(word.videoId)
      ? [word.videoId, ...entry.videoIds.filter((id) => id !== word.videoId)]
      : entry.videoIds;
    for (const videoId of order.slice(0, BLANK_VIDEOS_TRIED_PER_WORD)) {
      const video = byId.get(videoId);
      if (!video) continue;
      const landing = planFor(video, word, allWords, now);
      if (landing) return { word, landing };
    }
  }
  return fallback;
}
