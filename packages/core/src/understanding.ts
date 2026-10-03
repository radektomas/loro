import type { Video } from './types.ts';
import { isFunctionWord } from './glossary.ts';
import { isProperName, lookupGloss, normalizeSurface } from './dictionary.ts';
import { normalizeAnswer } from './srs.ts';

/**
 * WHAT YOU UNDERSTAND NOW (Radek, 2026-10-03: show learning, not activity).
 * Every time a word you have learned is SPOKEN somewhere in Loro's videos is
 * a moment you would now catch. Counted over the catalog's words, so it is a
 * real number about real speech, and it grows fast: one common word learned
 * can be dozens of moments.
 *
 * Not counted: grammar glue ("de", "que" — glossary's FUNCTION_WORDS, which
 * everyone meets on day one and which would inflate the number for free) and
 * names (Peppa is not Spanish you learned).
 *
 * A count, not a percentage, on purpose: early on any share of the whole
 * catalog is a discouraging 2%, while "your words come up 430 times" is the
 * honest version of the same fact that feels like what it is — progress.
 */

/** How often each countable word is spoken across the videos, by normalizeAnswer key. */
export function spokenCounts(videos: readonly Video[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const video of videos) {
    for (const cue of video.cues) {
      for (const word of cue.words) {
        const surface = normalizeSurface(word.text);
        if (!surface || isFunctionWord(surface)) continue;
        if (isProperName(word.text, lookupGloss(video, word.text))) continue;
        const key = normalizeAnswer(word.text);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export type Understanding = {
  /** Moments across the catalog spoken with a word you know. */
  moments: number;
  /** The same, counting only words known before `since` — the week's start. */
  momentsBefore: number;
  /** The word you learned since `since` that is spoken the most, if any. */
  bestNew: { key: string; count: number } | null;
};

/**
 * `known`: every word you know, with WHEN you learned it (ms) — learnedAt for
 * trained words and blue stops; 0 for words known with no date.
 */
export function understanding(
  counts: ReadonlyMap<string, number>,
  known: ReadonlyMap<string, number>,
  since: number
): Understanding {
  let moments = 0;
  let momentsBefore = 0;
  let bestNew: Understanding['bestNew'] = null;
  for (const [key, at] of known) {
    const n = counts.get(key) ?? 0;
    if (n === 0) continue;
    moments += n;
    if (at < since) momentsBefore += n;
    else if (!bestNew || n > bestNew.count) bestNew = { key, count: n };
  }
  return { moments, momentsBefore, bestNew };
}
