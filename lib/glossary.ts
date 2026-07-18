import type { SavedWord, Video, Word } from '@/types';
import { normalizeSurface } from '@/lib/dictionary';

/**
 * Per-video glossary: every unique spoken word of a video, classified by how
 * well the user already knows it. Pure functions — the sheet UI lives in
 * components/GlossarySheet.tsx.
 */

export type GlossaryWordState = 'known' | 'learning' | 'unknown';

export type GlossaryEntry = {
  /** normalised surface form — identity within the video and the display form */
  key: string;
  /** first occurrence in the transcript */
  word: Word;
  cueIndex: number;
  state: GlossaryWordState;
  /** the saved instance backing a learning (or SRS-known) entry */
  saved: SavedWord | null;
};

/**
 * High-frequency Spanish function words (articles, pronouns, prepositions,
 * conjunctions, glue verbs). A learner past the first day knows these — they
 * render as KNOWN so the unknown group is only words worth saving. Keys are
 * normalizeSurface() forms: lowercase, accents kept.
 */
const FUNCTION_WORDS = new Set([
  // articles & determiners
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
  'aquel', 'aquella', 'aquellos', 'aquellas',
  'mi', 'mis', 'tu', 'tus', 'su', 'sus',
  'nuestro', 'nuestra', 'nuestros', 'nuestras',
  'cada', 'todo', 'toda', 'todos', 'todas', 'otro', 'otra', 'otros', 'otras',
  'mucho', 'mucha', 'muchos', 'muchas', 'poco', 'poca', 'pocos', 'pocas',
  'más', 'menos', 'algún', 'alguna', 'ningún', 'ninguna',
  // pronouns
  'yo', 'tú', 'usted', 'ustedes', 'él', 'ella', 'ellos', 'ellas',
  'nosotros', 'nosotras', 'vosotros', 'vosotras',
  'me', 'te', 'se', 'nos', 'os', 'le', 'les',
  'esto', 'eso', 'aquello', 'algo', 'nada', 'alguien', 'nadie',
  // conjunctions
  'y', 'e', 'o', 'u', 'ni', 'que', 'pero', 'sino', 'porque', 'pues',
  'aunque', 'cuando', 'mientras', 'como', 'si',
  // prepositions
  'a', 'al', 'de', 'del', 'en', 'con', 'sin', 'por', 'para', 'sobre',
  'entre', 'hasta', 'desde', 'tras', 'según', 'contra',
  // adverbs & discourse glue
  'no', 'sí', 'ya', 'muy', 'también', 'tampoco', 'aquí', 'ahí', 'allí',
  'así', 'entonces', 'ahora', 'bien', 'mal', 'siempre', 'nunca',
  // ser / estar / haber / ir — unavoidable glue forms
  'es', 'son', 'soy', 'eres', 'somos', 'era', 'eran', 'fue',
  'está', 'están', 'estás', 'estoy', 'estamos',
  'hay', 'he', 'has', 'ha', 'han', 'va', 'van', 'voy', 'vas',
  // question words
  'qué', 'quién', 'quiénes', 'cómo', 'cuándo', 'dónde',
  'cuánto', 'cuánta', 'cuántos', 'cuántas',
]);

export function isFunctionWord(surface: string): boolean {
  return FUNCTION_WORDS.has(surface);
}

/**
 * Classify every unique spoken word of `video`, in sentence order.
 *
 *  - known:    graduated the SRS (state 'known', any video), OR marked known
 *              in CEFR calibration, OR a function word — unless it's actively
 *              being learned, because a save is a deliberate "I don't know
 *              this yet" that outranks a calibration guess.
 *  - learning: saved into the SRS (any video) and not graduated.
 *  - unknown:  everything else.
 *
 * Pure-punctuation tokens (normalizeSurface -> '') are excluded everywhere,
 * including the coverage total.
 */
export function buildGlossary(
  video: Video,
  savedWords: SavedWord[],
  calibrationKnown: string[]
): { entries: GlossaryEntry[]; knownCount: number; total: number } {
  const calibrated = new Set(
    calibrationKnown.map(normalizeSurface).filter(Boolean)
  );

  // Surfaces with at least one graduated instance — knowing a word in one
  // video means knowing it everywhere.
  const graduated = new Set<string>();
  for (const w of savedWords) {
    if (w.state === 'known') graduated.add(normalizeSurface(w.text));
  }

  // One saved instance per surface: prefer this video's own (so un-saving
  // from the glossary removes the entry the user is looking at), then the
  // most advanced box.
  const savedBySurface = new Map<string, SavedWord>();
  for (const w of savedWords) {
    const key = normalizeSurface(w.text);
    if (!key) continue;
    const cur = savedBySurface.get(key);
    if (!cur) {
      savedBySurface.set(key, w);
      continue;
    }
    const wHere = w.videoId === video.id;
    const curHere = cur.videoId === video.id;
    if ((wHere && !curHere) || (wHere === curHere && w.box > cur.box)) {
      savedBySurface.set(key, w);
    }
  }

  const entries: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (let cueIndex = 0; cueIndex < video.cues.length; cueIndex++) {
    for (const word of video.cues[cueIndex].words) {
      const key = normalizeSurface(word.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const saved = savedBySurface.get(key) ?? null;
      const state: GlossaryWordState = saved
        ? graduated.has(key)
          ? 'known'
          : 'learning'
        : calibrated.has(key) || FUNCTION_WORDS.has(key)
          ? 'known'
          : 'unknown';

      entries.push({ key, word, cueIndex, state, saved });
    }
  }

  const knownCount = entries.filter((e) => e.state === 'known').length;
  return { entries, knownCount, total: entries.length };
}
