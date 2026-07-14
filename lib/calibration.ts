import type { Level, Video, Word } from '@/types';
import { normalizeAnswer } from '@/lib/srs';
import { lookupGloss } from '@/lib/dictionary';

/**
 * Calibration for onboarding: derive a starting CEFR level from which words a
 * stranger already knows, instead of asking them to self-assess (nobody can,
 * and everyone picks "intermediate"). The level only SEEDS the feed order;
 * their real behaviour corrects it over time.
 */

export type CalibrationWord = { text: string; level: Level };

const LEVEL_ORDER: Level[] = ['A1', 'A2', 'B1', 'B2'];

/**
 * Hardcoded seed spanning the four bands (4 / 4 / 4 / 3). Real, unambiguous
 * words a learner would plausibly recognise at each level. The video
 * dictionaries aren't CEFR-labelled, so bands live here rather than being
 * mined from them.
 */
const SEED: Record<Level, string[]> = {
  A1: ['hola', 'gracias', 'agua', 'casa'],
  A2: ['mañana', 'trabajo', 'comida', 'ciudad'],
  B1: ['aunque', 'paisaje', 'acuerdo', 'mejorar'],
  B2: ['imprescindible', 'asequible', 'cotidiano'],
};

/**
 * Flatten the seed into a display list, round-robin across bands so the grid
 * mixes difficulty instead of clustering easy words first. Deterministic (no
 * Math.random) to keep it SSR-safe and stable across renders.
 */
export function buildCalibrationWords(): CalibrationWord[] {
  const out: CalibrationWord[] = [];
  const max = Math.max(...LEVEL_ORDER.map((l) => SEED[l].length));
  for (let i = 0; i < max; i++) {
    for (const level of LEVEL_ORDER) {
      const text = SEED[level][i];
      if (text) out.push({ text, level });
    }
  }
  return out;
}

/**
 * Turn the set of tapped ("known") words into a starting level.
 *
 *  - <50% of A1 known           -> A1
 *  - A1 known but A2 weak       -> A1  (start easy — kinder than the reverse)
 *  - A2 mostly known            -> A2
 *  - B1 mostly known            -> B1
 *  - B2 mostly known            -> B2
 */
export function deriveLevel(
  knownTexts: Set<string>,
  words: CalibrationWord[] = buildCalibrationWords()
): Level {
  const MOSTLY = 0.6;
  const known = new Set([...knownTexts].map(normalizeAnswer));
  const ratio = (level: Level): number => {
    const band = words.filter((w) => w.level === level);
    if (band.length === 0) return 0;
    const hit = band.filter((w) => known.has(normalizeAnswer(w.text))).length;
    return hit / band.length;
  };

  if (ratio('A1') < 0.5) return 'A1';
  if (ratio('A2') < MOSTLY) return 'A1';
  if (ratio('B1') < MOSTLY) return 'A2';
  if (ratio('B2') < MOSTLY) return 'B1';
  return 'B2';
}

/** Unique spoken words of a video (normalised) — a rough difficulty proxy. */
function uniqueWordCount(video: Video): number {
  const set = new Set<string>();
  for (const cue of video.cues)
    for (const w of cue.words) {
      const key = normalizeAnswer(w.text);
      if (key) set.add(key);
    }
  return set.size;
}

/**
 * The video to open the guided intro on: nearest to the user's level, and
 * among ties the easiest (fewest unique words). Never returns undefined as
 * long as the library is non-empty.
 */
export function pickGuidedVideo(videos: Video[], level: Level): Video {
  const li = LEVEL_ORDER.indexOf(level);
  return [...videos].sort((a, b) => {
    const near =
      Math.abs(LEVEL_ORDER.indexOf(a.level) - li) -
      Math.abs(LEVEL_ORDER.indexOf(b.level) - li);
    return near !== 0 ? near : uniqueWordCount(a) - uniqueWordCount(b);
  })[0];
}

export type TargetWord = { word: Word; cueIndex: number };

const CONTENT_POS = new Set(['noun', 'verb', 'adj', 'adv']);

/**
 * Pick the word to pulse in step (b): a mid-frequency, glossable content word
 * the learner did NOT mark as known — something worth saving and recalling.
 * Falls back gracefully so the guided loop always has a target.
 */
export function pickTargetWord(
  video: Video,
  knownSurfaces: Set<string>
): TargetWord | null {
  const known = new Set([...knownSurfaces].map(normalizeAnswer));

  type Cand = { word: Word; cueIndex: number; content: boolean };
  const candidates: Cand[] = [];
  let anyGlossed: Cand | null = null;

  for (let ci = 0; ci < video.cues.length; ci++) {
    for (const word of video.cues[ci].words) {
      const gloss = lookupGloss(video, word.text);
      if (!gloss) continue;
      const cand: Cand = {
        word,
        cueIndex: ci,
        content: CONTENT_POS.has(gloss.pos),
      };
      if (!anyGlossed) anyGlossed = cand;
      const key = normalizeAnswer(word.text);
      if (!key || key.length < 3 || known.has(key)) continue;
      candidates.push(cand);
    }
  }

  const content = candidates.find((c) => c.content);
  const chosen = content ?? candidates[0] ?? anyGlossed;
  if (chosen) return { word: chosen.word, cueIndex: chosen.cueIndex };

  // Last resort: the very first word, so the loop can still run.
  const first = video.cues[0]?.words[0];
  return first ? { word: first, cueIndex: 0 } : null;
}

/** Seed the feed order by proximity to the start level (stable within a band). */
export function orderVideosForLevel(videos: Video[], level: Level): Video[] {
  const li = LEVEL_ORDER.indexOf(level);
  return [...videos].sort(
    (a, b) =>
      Math.abs(LEVEL_ORDER.indexOf(a.level) - li) -
      Math.abs(LEVEL_ORDER.indexOf(b.level) - li)
  );
}
