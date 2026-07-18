import type { SavedWord, Video } from '@/types';
import { normalizeAnswer } from '@/lib/srs';
import { glossText, lookupGloss, normalizeSurface } from '@/lib/dictionary';
import { isFunctionWord } from '@/lib/glossary';

/**
 * Level fill-in mode: every word gets an approximate difficulty level, the
 * user climbs from level 1 by typing words of their current level that are
 * blanked inline in the feed. Pure functions only — persistence lives in
 * lib/storage, the blank UI is the same one typed recall uses
 * (components/SubtitleTrack.tsx).
 *
 * The video dictionaries carry no CEFR/frequency field, so levels are
 * approximated from hand-cut Spanish frequency bands: band 1 is pure function
 * words plus day-one basics, bands 2-4 step down the frequency list, and
 * anything unlisted is band 5 (rare). Both the surface form and the gloss
 * lemma are checked, so "vine" finds "venir"'s band.
 */

/**
 * The six named tiers — the ONLY user-facing identity of the numeric level.
 * Index maps to level 1-6; everywhere the app talks about a level it shows
 * the tier NAME (the number stays internal). The names are real Spanish and
 * deliberately teach: each carries its own translation.
 */
export type Tier = { level: number; name: string; meaning: string };

export const TIERS: readonly Tier[] = [
  { level: 1, name: 'Guiri', meaning: 'clueless foreign tourist' },
  { level: 2, name: 'Turista', meaning: 'tourist' },
  { level: 3, name: 'Se Defiende', meaning: 'gets by' },
  { level: 4, name: 'Casi Local', meaning: 'almost a local' },
  { level: 5, name: 'Local', meaning: 'local' },
  { level: 6, name: 'Nativo', meaning: 'native' },
];

/** Tier for a numeric level, clamped so a bad stored value still resolves. */
export function tierFor(level: number): Tier {
  const i = Math.min(TIERS.length, Math.max(1, Math.round(level))) - 1;
  return TIERS[i];
}

export const MAX_USER_LEVEL = TIERS.length;

/**
 * Word difficulty bands stay 1-5 (5 = rare/unlisted) even though the user
 * ladder now tops out at 6 — Nativo is a terminal badge earned by clearing
 * the rare band, not a band with words of its own. Keeping this separate from
 * MAX_USER_LEVEL leaves blank selection exactly as it was.
 */
const MAX_WORD_LEVEL = 5;

export type LevelState = {
  /** 1..MAX_USER_LEVEL — the band currently being blanked in the feed. */
  level: number;
  /** 0..100 — fill it to level up, drain it to drop back. */
  meter: number;
};

export const INITIAL_LEVEL_STATE: LevelState = { level: 1, meter: 0 };

/** Five correct fills climb a level; four misses drain a full meter. */
const METER_UP = 20;
const METER_DOWN = 25;
/** After a level-down the meter restarts mid-way, so one bad run doesn't
    cascade straight through several levels. */
const METER_AFTER_DROP = 50;

export type LevelAnswerResult = LevelState & {
  leveledUp: boolean;
  leveledDown: boolean;
};

/** Apply one level-blank answer to the meter/level. Pure. */
export function applyLevelAnswer(
  state: LevelState,
  wasCorrect: boolean
): LevelAnswerResult {
  if (wasCorrect) {
    const meter = state.meter + METER_UP;
    if (meter < 100) {
      return { level: state.level, meter, leveledUp: false, leveledDown: false };
    }
    if (state.level >= MAX_USER_LEVEL) {
      // Top of the ladder — the meter just stays full.
      return { level: state.level, meter: 100, leveledUp: false, leveledDown: false };
    }
    return { level: state.level + 1, meter: 0, leveledUp: true, leveledDown: false };
  }
  const meter = state.meter - METER_DOWN;
  if (meter >= 0) {
    return { level: state.level, meter, leveledUp: false, leveledDown: false };
  }
  if (state.level <= 1) {
    return { level: 1, meter: 0, leveledUp: false, leveledDown: false };
  }
  return {
    level: state.level - 1,
    meter: METER_AFTER_DROP,
    leveledUp: false,
    leveledDown: true,
  };
}

// ---------------------------------------------------------------------------
// Frequency bands. Keys are normalizeSurface() forms (lowercase, accents
// kept). Membership is approximate by design — the meter self-corrects.

/** Day-one words beyond the function-word list: greetings, core nouns, and
    the highest-frequency verb forms a beginner meets immediately. */
const LEVEL_1_EXTRAS = new Set([
  'hola', 'gracias', 'adiós', 'chau', 'vale', 'claro',
  'bueno', 'buena', 'buenos', 'buenas', 'día', 'días', 'hoy', 'ayer',
  'casa', 'agua', 'gente', 'cosa', 'cosas', 'tiempo', 'vida', 'mundo',
  'amigo', 'amiga', 'amigos', 'amigas', 'hombre', 'mujer', 'favor',
  'ser', 'estar', 'tener', 'tengo', 'tienes', 'tiene', 'tenemos',
  'hacer', 'hago', 'haces', 'hace', 'ir', 'quiero', 'quieres', 'quiere',
  'ver', 'veo', 'ves', 'saber', 'sé', 'sabes', 'sabe',
]);

/** Roughly the top ~1000: everyday verbs, people, time and place words. */
const LEVEL_2_WORDS = new Set([
  'decir', 'digo', 'dice', 'dices', 'poder', 'puedo', 'puedes', 'puede',
  'venir', 'vengo', 'viene', 'vine', 'dar', 'doy', 'poner', 'pongo',
  'salir', 'salgo', 'llegar', 'llego', 'llega', 'pasar', 'pasa', 'pasó',
  'quedar', 'quedamos', 'quedemos', 'hablar', 'hablo', 'hablas',
  'comer', 'como', 'beber', 'vivir', 'vivo', 'vives', 'trabajar',
  'jugar', 'juega', 'conocer', 'conozco', 'llamar', 'llamo', 'llama',
  'mirar', 'mira', 'escuchar', 'escucha', 'entender', 'entiendo',
  'esperar', 'espera', 'comprar', 'dormir', 'pensar', 'pienso', 'creer', 'creo',
  'año', 'años', 'semana', 'mes', 'meses', 'fin', 'mañana', 'tarde', 'noche',
  'hora', 'horas', 'minuto', 'momento', 'ciudad', 'pueblo', 'país', 'calle',
  'coche', 'carro', 'tren', 'dinero', 'familia', 'padre', 'madre', 'papá',
  'mamá', 'hijo', 'hija', 'hijos', 'hermano', 'hermana', 'niño', 'niña',
  'chico', 'chica', 'escuela', 'clase', 'nombre', 'trabajo', 'comida',
  'verdad', 'pregunta', 'respuesta', 'palabra', 'lugar',
  'grande', 'pequeño', 'pequeña', 'nuevo', 'nueva', 'viejo', 'vieja',
  'joven', 'primero', 'primera', 'último', 'última', 'importante',
  'fácil', 'difícil', 'feliz', 'triste', 'cansado', 'cansada',
  'rápido', 'lento', 'cerca', 'lejos', 'arriba', 'abajo', 'dentro', 'fuera',
  'antes', 'después', 'luego', 'pronto', 'todavía', 'aún', 'casi',
  'juntos', 'juntas', 'vez', 'veces', 'vamos',
]);

/** Mid-frequency: travel, leisure, body, weather, common -ar/-er/-ir verbs. */
const LEVEL_3_WORDS = new Set([
  'vacaciones', 'hotel', 'playa', 'viaje', 'viajar', 'avión', 'aeropuerto',
  'selección', 'partido', 'equipo', 'fútbol', 'ganar', 'perder',
  'encontrar', 'encuentro', 'buscar', 'busco', 'sentir', 'siento',
  'parecer', 'parece', 'seguir', 'sigo', 'sigue', 'empezar', 'empiezo',
  'terminar', 'termina', 'necesitar', 'necesito', 'gustar', 'gusta',
  'encantar', 'encanta', 'preferir', 'prefiero', 'prefiere',
  'recordar', 'recuerdo', 'olvidar', 'olvido', 'aprender', 'aprendo',
  'enseñar', 'estudiar', 'estudio', 'leer', 'leo', 'escribir', 'escribo',
  'llevar', 'llevo', 'traer', 'traigo', 'vender', 'pagar', 'pago',
  'abrir', 'abro', 'cerrar', 'cierro', 'cambiar', 'cambio', 'usar', 'uso',
  'probar', 'pruebo', 'intentar', 'intento',
  'tranquilo', 'tranquila', 'tranquilos', 'tranquilas',
  'lleno', 'llena', 'vacío', 'vacía', 'caro', 'cara', 'barato', 'barata',
  'bonito', 'bonita', 'feo', 'fea', 'fuerte', 'mismo', 'misma',
  'diferente', 'propio', 'propia', 'seguro', 'segura',
  'posible', 'imposible', 'quizás', 'quizá',
  'edificio', 'tienda', 'mercado', 'restaurante', 'bar', 'cocina',
  'habitación', 'puerta', 'ventana', 'cuerpo', 'cabeza', 'mano', 'ojos',
  'salud', 'médico', 'música', 'película', 'historia', 'noticia', 'idioma',
  'ejemplo', 'problema', 'razón', 'idea', 'manera', 'forma', 'sitio',
  'viento', 'lluvia', 'sol', 'frío', 'calor',
]);

/** Lower-frequency: abstract nouns, B2-flavoured adjectives and connectors. */
const LEVEL_4_WORDS = new Set([
  'paisaje', 'acuerdo', 'mejorar', 'desarrollar', 'lograr', 'conseguir',
  'aumentar', 'disminuir', 'sociedad', 'gobierno', 'empresa', 'proyecto',
  'experiencia', 'conocimiento', 'costumbre', 'cultura', 'ambiente',
  'medida', 'nivel', 'época', 'superficie', 'herramienta',
  'comportamiento', 'actitud', 'ventaja', 'desventaja', 'riesgo',
  'desafío', 'recurso', 'meta', 'propósito', 'desarrollo', 'crecimiento',
  'entorno', 'requisito', 'destreza', 'asequible', 'imprescindible',
  'cotidiano', 'cotidiana', 'disponible', 'actual', 'anterior',
  'siguiente', 'semejante', 'distinto', 'distinta', 'complejo', 'compleja',
  'sencillo', 'sencilla', 'apenas', 'incluso', 'además', 'embargo',
  'mediante', 'respecto', 'duda', 'esfuerzo', 'éxito', 'fracaso', 'apoyo',
  'fuente', 'tema', 'asunto', 'detalle', 'entrevista', 'informe',
  'investigación', 'resultado', 'proceso', 'sistema',
]);

function bandOf(surface: string): number | null {
  if (isFunctionWord(surface) || LEVEL_1_EXTRAS.has(surface)) return 1;
  if (LEVEL_2_WORDS.has(surface)) return 2;
  if (LEVEL_3_WORDS.has(surface)) return 3;
  if (LEVEL_4_WORDS.has(surface)) return 4;
  return null;
}

/**
 * Level of a word: 1 (most common) .. MAX_WORD_LEVEL (rare / unlisted).
 * The lemma (from the video dictionary) rescues conjugated forms the band
 * lists don't spell out — the easier of the two readings wins.
 */
export function wordLevel(surface: string, lemma?: string | null): number {
  const bySurface = bandOf(surface);
  const byLemma = lemma ? bandOf(normalizeSurface(lemma)) : null;
  if (bySurface !== null && byLemma !== null) return Math.min(bySurface, byLemma);
  return bySurface ?? byLemma ?? MAX_WORD_LEVEL;
}

// ---------------------------------------------------------------------------
// Blank planning

/** A level-practice blank target. Shape-compatible with what the blank UI
    needs (text + translation prompt) and with the SRS save path. */
export type LevelBlankWord = {
  text: string;
  /** The word's gloss — the same meaning-first prompt recall blanks show. */
  translation: string;
  videoId: string;
  cueIndex: number;
  /** The band this word belongs to (== the user's level when planned). */
  level: number;
};

/** Level blanks are rarer than SRS blanks — playback must stay playback. */
const MAX_LEVEL_BLANKS_PER_VIDEO = 2;
/** Let the video open before the first interruption. */
const MIN_CUE_INDEX = 2;
/** Breathing room between two level blanks. */
const MIN_CUE_GAP = 2;

/**
 * Decide which cue positions of `video` become LEVEL blanks. Returns
 * cueIndex -> the word to blank. Rules:
 *  - only words whose level equals the user's current level
 *  - never a word already in the SRS (those belong to the recall flow)
 *  - never the same word twice in one video, at most two blanks per video,
 *    never in the first two cues, and never in back-to-back cues
 *  - never a cue the SRS blank plan already claimed (`excludeCues`)
 *  - only glossable words — the gloss is the prompt and the saved translation
 */
export function computeLevelBlankPlan(
  video: Video,
  userLevel: number,
  savedWords: SavedWord[],
  language: string,
  excludeCues: ReadonlySet<number> = new Set()
): Map<number, LevelBlankWord> {
  const saved = new Set(savedWords.map((w) => normalizeAnswer(w.text)));
  const plan = new Map<number, LevelBlankWord>();
  const used = new Set<string>();
  let lastCue = -Infinity;

  for (let ci = MIN_CUE_INDEX; ci < video.cues.length; ci++) {
    if (plan.size >= MAX_LEVEL_BLANKS_PER_VIDEO) break;
    if (excludeCues.has(ci) || ci - lastCue < MIN_CUE_GAP) continue;

    for (const word of video.cues[ci].words) {
      const key = normalizeAnswer(word.text);
      if (key.length < 2 || saved.has(key) || used.has(key)) continue;
      const gloss = lookupGloss(video, word.text);
      if (wordLevel(normalizeSurface(word.text), gloss?.lemma) !== userLevel) {
        continue;
      }
      const translation = gloss && glossText(gloss, language);
      if (!translation) continue;

      plan.set(ci, {
        text: word.text,
        translation,
        videoId: video.id,
        cueIndex: ci,
        level: userLevel,
      });
      used.add(key);
      lastCue = ci;
      break;
    }
  }
  return plan;
}
