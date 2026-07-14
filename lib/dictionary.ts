import type { Gloss, Video } from '@/types';

/**
 * Word-level dictionary lookups against the per-video dictionary built at
 * transcription time (see gloss_words in transcribe.py).
 */

/**
 * Normalised surface form used as the dictionary key: lowercase, strip
 * surrounding punctuation, KEEP accents and ñ ("Costa" and "costa," -> "costa").
 * Must stay identical in behaviour to normalize_word() in transcribe.py —
 * that's what keyed the dictionary.
 *
 * Note this is NOT lib/srs.ts normalizeAnswer(), which folds accents away
 * for forgiving answer grading.
 */
export function normalizeSurface(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^a-z0-9áéíóúüñ]+|[^a-z0-9áéíóúüñ]+$/g, '');
}

/** Look a word up in the video's dictionary by its normalised surface form. */
export function lookupGloss(video: Video, wordText: string): Gloss | null {
  const key = normalizeSurface(wordText);
  if (!key) return null;
  return video.dictionary?.[key] ?? null;
}

/** The gloss string for a language, falling back to English; null if empty. */
export function glossText(gloss: Gloss, language: string): string | null {
  const text = gloss.glosses[language] || gloss.glosses.en;
  return text && text.trim() ? text : null;
}
