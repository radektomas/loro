// Relative and extension-ed, not '@/lib/…': this module loads under plain node
// for its test (same rule as savePrompt.ts).
import { normalizeSurface } from './dictionary.ts';
import { MIN_TARGET_AUDIBLE_S } from './starter/rounds.ts';
import type { Video } from './types.ts';

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
      for (const word of cue.words) {
        if (word.end - word.start < MIN_TARGET_AUDIBLE_S) continue;
        if (normalizeSurface(word.text) !== wanted) continue;
        found.push({
          videoId: video.id,
          youtubeId: video.youtubeId ?? null,
          cueIndex,
          start: word.start,
          end: word.end,
        });
      }
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
