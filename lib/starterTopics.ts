// Relative and extension-ed, not '@/lib/...': this module loads under plain
// node for its test (same rule as lib/starterRounds.ts).
import type { Video } from '../types/index.ts';
import { normalizeSurface } from './dictionary.ts';

/**
 * Topic classification for starter-deck candidates — read off the clip's own
 * vocabulary, not its metadata.
 *
 * WHY THIS EXISTS. The ranking in lib/starterRounds.ts picks clips by word
 * coverage, frequency and payoff length — none of which can tell a beginner's
 * first Spanish minute from a screen-recording tutorial. Measured concretely:
 * the ranking's OWN round-3 pick for the shipped catalog is a Microsoft/Android
 * "immersive reader" settings walkthrough ("los tres puntitos", "configuración",
 * "accesibilidad", "activar el lector inmersivo") — every word in it is common
 * enough to rank well, and none of it is anything a new user should spend their
 * first minute on. This module exists to catch exactly that, and to surface a
 * topic on every candidate so curating STARTER_CLIP_ALLOWLIST (see
 * lib/starterRounds.ts) never again requires reading transcripts by hand.
 *
 * HOW IT CLASSIFIES. Six hand-curated keyword sets, scored against every
 * word actually spoken in the clip (matched via normalizeSurface — lowercase,
 * accents kept, exactly the dictionary's own key). A keyword's contribution is
 * capped at 2 occurrences so one repeated word (a recipe's "cocina" said five
 * times) cannot alone drown out a clip that touches several categories lightly.
 * The topic with the highest score wins; a clip that matches nothing in any
 * list is 'other' rather than forced into a category it doesn't fit.
 *
 * TIES FAVOUR 'tech'. If a clip scores equally on tech and something else, the
 * classifier calls it tech. Getting this wrong in one direction (calling a fine
 * clip "tech" and passing over it) costs a curator one skipped row; getting it
 * wrong the other way (calling a tutorial something safe) is the exact failure
 * this module exists to prevent.
 *
 * PREFIX MATCHING IS NOT SAFE HERE. An earlier pass scored "sol" (sun) by
 * prefix and picked up 56 hits — nearly all of them "solo"/"solamente", not the
 * weather word at all. Every keyword below is matched as an exact
 * normalizeSurface token, never a prefix.
 *
 * "cuenta" is deliberately ABSENT from the tech list even though it is the
 * single most common candidate token in the catalog: checked by hand, it is
 * "darse cuenta" (to realize) in all but two of its clips, and a keyword that
 * is wrong 90% of the time is worse than no keyword. The two real tech hits
 * ("cuenta de Google", "cuenta vinculada") still classify correctly on their
 * other tech vocabulary (dispositivo, samsung, dispositivo, dispositivo).
 */

export type StarterTopic =
  | 'travel'
  | 'dailyLife'
  | 'food'
  | 'culture'
  | 'tech'
  | 'other';

/** Curation order: the topics worth choosing FOR a beginner's first minute,
    most preferred first. 'tech' and 'other' are deliberately excluded — tech
    is the failure mode this module exists to catch, and 'other' (nature docs,
    product reviews, sports commentary, ...) is a fallback bucket, never a
    pick. */
export const STARTER_TOPIC_PREFERENCE: readonly StarterTopic[] = [
  'travel',
  'dailyLife',
  'food',
  'culture',
];

/** Places, transport, trips and the weather/geography that comes with them. */
const TRAVEL_WORDS = new Set([
  'aeropuerto', 'vuelo', 'avión', 'viaje', 'viajar', 'vacaciones', 'turista',
  'turismo', 'hotel', 'hostal', 'playa', 'costa', 'isla', 'montaña', 'bosque',
  'desierto', 'cascada', 'río', 'lago', 'paisaje', 'recorrido', 'crucero',
  'pasaporte', 'maleta', 'equipaje', 'frontera', 'visado', 'excursión', 'ruta',
  'destino', 'extranjero', 'embajada', 'reserva', 'billete', 'boleto', 'guía',
  'mapa', 'dirección', 'plaza', 'museo', 'tren', 'autobús', 'taxi', 'metro',
  'moto', 'bicicleta', 'carretera', 'kilómetros', 'senderismo', 'camping',
  'clima', 'temperatura', 'lluvia', 'nieve', 'sol', 'calor', 'frío', 'viento',
]);

/** Cooking, eating out, and the vocabulary of a plate of food. */
const FOOD_WORDS = new Set([
  'comida', 'cocina', 'cocinar', 'receta', 'ingrediente', 'ingredientes',
  'sabor', 'sabroso', 'delicioso', 'plato', 'restaurante', 'cena', 'almuerzo',
  'desayuno', 'probar', 'picante', 'dulce', 'salado', 'carne', 'pollo',
  'pescado', 'verduras', 'fruta', 'postre', 'bebida', 'vino', 'cerveza',
  'café', 'pan', 'arroz', 'especias', 'mercado', 'tapas', 'pinchos',
  'champiñones', 'cordero', 'calamares', 'tortilla', 'horno', 'sartén',
  'sal', 'salsa', 'caldo', 'costillas', 'guiso', 'hervir', 'hornear',
]);

/** Routine, home, work, school and everyday money. */
const DAILY_LIFE_WORDS = new Set([
  'trabajo', 'oficina', 'jefe', 'sueldo', 'salario', 'dinero', 'tarjeta',
  'crédito', 'banco', 'préstamo', 'ahorro', 'factura', 'pago', 'rutina',
  'despertar', 'ducha', 'colegio', 'escuela', 'estudiar', 'universidad',
  'clase', 'profesor', 'tarea', 'limpiar', 'ropa', 'ejercicio', 'gimnasio',
  'vecino', 'barrio', 'transporte', 'coche', 'compras', 'supermercado',
  'niños', 'hijos', 'familia', 'pareja',
]);

/** Language, tradition, music, religion, art and story — the identity topics. */
const CULTURE_WORDS = new Set([
  'idioma', 'lengua', 'carácter', 'alfabeto', 'gramática', 'tradición',
  'costumbre', 'historia', 'música', 'canción', 'cantar', 'baile', 'bailar',
  'fiesta', 'celebración', 'religión', 'iglesia', 'santo', 'arte', 'pintura',
  'poema', 'libro', 'novela', 'festival', 'folclore', 'dialecto', 'acento',
]);

/**
 * Screens, settings, software and gadgets — the specific failure this module
 * exists to catch. Deliberately wide: a device spec-sheet ("procesador",
 * "pulgadas", "auriculares") is just as wrong a first minute as a menu
 * walkthrough, even though nobody would call it a "tutorial".
 */
const TECH_WORDS = new Set([
  'clic', 'menú', 'archivo', 'pantalla', 'ventana', 'configuración',
  'aplicación', 'app', 'internet', 'wifi', 'android', 'iphone', 'samsung',
  'xiaomi', 'microsoft', 'google', 'software', 'descargar', 'instalar',
  'actualizar', 'navegador', 'contraseña', 'usuario', 'dispositivo',
  'teclado', 'pestaña', 'enlace', 'plataforma', 'activar', 'desactivar',
  'ajustes', 'opciones', 'programa', 'computadora', 'ordenador', 'portátil',
  'laptop', 'tablet', 'smartphone', 'encender', 'accesibilidad', 'casilla',
  'icono', 'botón', 'pulsar', 'auriculares', 'altavoz', 'bluetooth',
  'batería', 'procesador', 'pulgadas', 'gigabytes', 'tecnología',
]);

const TOPIC_WORDS: ReadonlyArray<readonly [StarterTopic, ReadonlySet<string>]> = [
  ['travel', TRAVEL_WORDS],
  ['food', FOOD_WORDS],
  ['dailyLife', DAILY_LIFE_WORDS],
  ['culture', CULTURE_WORDS],
  ['tech', TECH_WORDS],
];

/** A keyword's contribution is capped here — see the module doc's reasoning. */
const MAX_KEYWORD_WEIGHT = 2;

/** Tie-break order: 'tech' is checked FIRST, so an exact tie between tech and
    anything else calls it tech — see the module doc's reasoning. Only a
    strictly higher score displaces the current leader. */
const TIE_BREAK_ORDER: readonly StarterTopic[] = [
  'tech',
  'travel',
  'dailyLife',
  'food',
  'culture',
];

/** Score of every topic against a clip's transcript — exposed for the report
    and for tests; classifyStarterTopic is the score's argmax. */
export function scoreStarterTopics(video: Video): Record<StarterTopic, number> {
  const scores: Record<StarterTopic, number> = {
    travel: 0,
    dailyLife: 0,
    food: 0,
    culture: 0,
    tech: 0,
    other: 0,
  };
  const counts = new Map<string, number>();
  for (const cue of video.cues) {
    for (const word of cue.words) {
      const key = normalizeSurface(word.text);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [token, count] of counts) {
    const weight = Math.min(count, MAX_KEYWORD_WEIGHT);
    for (const [topic, words] of TOPIC_WORDS) {
      if (words.has(token)) scores[topic] += weight;
    }
  }
  return scores;
}

/** The clip's topic: the highest-scoring category, 'tech' on a tie, and
    'other' when nothing in any list was said. */
export function classifyStarterTopic(video: Video): StarterTopic {
  const scores = scoreStarterTopics(video);
  let best: StarterTopic = 'other';
  let bestScore = 0;
  for (const topic of TIE_BREAK_ORDER) {
    if (scores[topic] > bestScore) {
      bestScore = scores[topic];
      best = topic;
    }
  }
  return bestScore > 0 ? best : 'other';
}
