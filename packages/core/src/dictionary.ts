import type { Gloss, Video } from './types.ts';

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

/**
 * A NAME, NOT VOCABULARY (Radek, 2026-10-02: "names like Peppa shouldn't be
 * there to fill up"). Peppa, George, Discovery Kids, Dubai: a blank on one
 * teaches no Spanish. The glossing model marks most of them ("proper noun"
 * in the note, a capitalised lemma), but about 250 entries carry a
 * lowercase lemma and some no note at all ("américa", "iris", "york"), so
 * the last test is the gloss itself: an English gloss that is just the same
 * word, capitalised ("peppa" -> "Peppa"), is a name.
 */
const NAME_NOTE = /proper|\bname\b|brand/i;
const NAME_POS = new Set(['name', 'propn', 'proper', 'proper noun']);
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function isProperName(surface: string, gloss: Gloss | null): boolean {
  if (!gloss) return false;
  if (/^\p{Lu}/u.test(gloss.lemma)) return true;
  if (gloss.note && NAME_NOTE.test(gloss.note)) return true;
  if (NAME_POS.has(gloss.pos.trim().toLowerCase())) return true;
  const en = (gloss.glosses.en ?? '').trim();
  return /^\p{Lu}/u.test(en) && fold(en) === fold(normalizeSurface(surface));
}

/**
 * THE WORD, WITHOUT ITS PUNCTUATION (Radek, 2026-10-02: "if there is a word
 * with a dot and stuff it needs to be just the word"). Transcripts keep the
 * sentence's punctuation on its words — "barro.", "¿Podemos", "Pig." — about
 * 2,400 tokens in the feed and a third of the Peppa shelf. Strips it from
 * both ends and keeps the word's own letters, accents and inner apostrophes
 * or hyphens. Case is untouched: use wordForSave to also fold a
 * sentence-initial capital.
 */
export function cleanWord(text: string): string {
  return text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * The form a tapped word is SAVED as: no punctuation, and lowercase unless
 * it is a name — "¿Podemos" was only capitalised because it started a
 * sentence; "Peppa" is capitalised because it is Peppa.
 */
export function wordForSave(text: string, gloss: Gloss | null): string {
  const clean = cleanWord(text);
  return isProperName(text, gloss) ? clean : clean.toLowerCase();
}
