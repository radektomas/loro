// Relative and extension-ed, not '@/lib/srs': this module loads under plain
// node for its test, where neither the bundler alias nor extensionless
// specifiers resolve (same rule as scripts/ — see the tsconfig note on
// allowImportingTsExtensions).
import { normalizeAnswer } from '../srs.ts';

/**
 * The beginner starter deck: the most common spoken-Spanish words, one card
 * each, shown to users who self-assess as starting from zero.
 *
 * SINGLE SOURCE OF TRUTH — the onboarding deck screen, the calibration
 * escape hatch, and the /profile re-entry row all read THIS list. Do not
 * copy it anywhere.
 *
 * Ordering is spoken-frequency descending (subtitle-corpus ordering, curated
 * by hand): greetings and function words, then the highest-frequency verb
 * forms, question words, prepositions/conjunctions, adverbs and quantifiers,
 * then core adjectives and nouns. The array index IS the word's rank, and
 * three things hang off it:
 *   - cueIndex of the saved row (stable identity in loro_saved_words);
 *   - the dueAt stagger (earlier = more frequent = due sooner), keyed to the
 *     DECK index, not the position in a partially-completed run, so a
 *     two-session user gets the same review ordering as a one-session user;
 *   - the teaching order on /onboarding/starter.
 * Reordering the list therefore changes saved cue_index values; that is safe
 * (duplicate rows fold via foldDuplicateWords) but not free — don't reshuffle
 * casually.
 *
 * Curation rules:
 *   - Single tokens only: SavedWord.text is one tapped word.
 *   - One entry per normalizeAnswer() identity. Accent pairs (sí/si, qué/que,
 *     él/el, está/esta, sé/se, más/mas, tú/tu, cómo/como) collapse under
 *     normalization, so only the more teachable member is included — the
 *     deck test enforces uniqueness.
 *   - Articles and clitic pronouns (el/la/un/una, me/te/se) are deliberately
 *     NOT cards — they are glue that no learner benefits from drilling in
 *     isolation — but they may appear inside example sentences.
 *   - Example sentences draw on earlier-ranked deck words (any inflection),
 *     proper names, and glue wherever natural. A handful of early verbs
 *     borrow one later deck word as an object ("No tengo nada") because a
 *     transitive verb before any noun has no honest alternative; the borrow
 *     is always itself a deck word, never an outsider.
 *   - Superset of the calibration seed (lib/calibration.ts): the escape
 *     hatch resolves every calibration word to a deck entry for its
 *     translation, with NO fallback. starterDeck.test.mts is the tripwire
 *     if either list changes.
 */

export type StarterWord = {
  /** normalizeAnswer(word) — stable, unique, accent-stripped. */
  id: string;
  word: string;
  /** language code -> translation; same shape as Gloss.glosses. 'en' is
      always present and is the fallback for unshipped languages. */
  translations: Record<string, string>;
  exampleSentence: string;
};

/**
 * Pseudo video id for words saved from the starter deck (and the calibration
 * escape hatch). loro_saved_words.video_id is text with deliberately no FK,
 * so a non-catalog id is legal. Everything that treats saved words per-video
 * must special-case it: no video exists to replay or review "in".
 */
export const STARTER_VIDEO_ID = 'starter';

/**
 * dueAt stagger between consecutive deck ranks. A full run would otherwise
 * make every "don't know" word due at the same +10 min cliff, pinning every
 * subsequent feed video at computeBlankPlan's 5-blank cap — bounded, but
 * sustained max test-density. 90 s per rank rolls the box-1 wave out over
 * ~2 h (and the box-3 wave across day 3) in frequency order.
 */
export const STARTER_STAGGER_MS = 90_000;

const W = (
  word: string,
  en: string,
  cs: string,
  exampleSentence: string
): StarterWord => ({
  id: normalizeAnswer(word),
  word,
  translations: { en, cs },
  exampleSentence,
});

export const STARTER_DECK: readonly StarterWord[] = [
  // --- greetings & yes/no -------------------------------------------------
  W('hola', 'hello', 'ahoj', '¡Hola! ¿Cómo estás?'),
  W('sí', 'yes', 'ano', 'Sí, gracias.'),
  W('no', 'no; not', 'ne', 'No, gracias.'),
  W('gracias', 'thank you', 'děkuji', 'Gracias, Ana.'),
  W('bien', 'well; fine', 'dobře', 'Bien, gracias.'),
  W('adiós', 'goodbye', 'sbohem', '¡Adiós, María!'),
  // --- pronouns -----------------------------------------------------------
  W('yo', 'I', 'já', 'Yo soy Ana.'),
  W('tú', 'you', 'ty', '¿Y tú, Ana?'),
  W('él', 'he', 'on', 'Él es Marco.'),
  W('ella', 'she', 'ona', 'Ella es Ana.'),
  W('nosotros', 'we', 'my', 'Nosotros sí, ella no.'),
  W('y', 'and', 'a', 'Ana y Marco.'),
  // --- core verb forms ----------------------------------------------------
  W('soy', 'I am', 'jsem', 'Soy yo.'),
  W('es', 'is', 'je', 'Es Marco.'),
  W('está', 'is (place or state)', 'je (kde / jak)', 'Ana no está.'),
  W('estoy', 'I am (place or state)', 'jsem (kde / jak)', 'Estoy bien, gracias.'),
  W('tengo', 'I have', 'mám', 'No tengo nada.'),
  W('tiene', 'has', 'má', 'Ana no tiene tiempo.'),
  W('quiero', 'I want', 'chci', 'No quiero, gracias.'),
  W('puedo', 'I can', 'můžu', 'Sí, puedo.'),
  W('voy', 'I go; I am going', 'jdu / jedu', 'Voy a casa.'),
  W('vamos', 'we go; let’s go', 'jdeme / pojďme', '¡Vamos, vamos!'),
  W('sé', 'I know', 'vím', 'No sé.'),
  // --- question words -----------------------------------------------------
  W('qué', 'what', 'co', '¿Qué es?'),
  W('cómo', 'how', 'jak', '¿Cómo estás?'),
  W('dónde', 'where', 'kde', '¿Dónde está Ana?'),
  W('quién', 'who', 'kdo', '¿Quién es?'),
  W('cuándo', 'when', 'kdy', '¿Cuándo vamos?'),
  // --- prepositions & conjunctions ----------------------------------------
  W('de', 'of; from', 'z / od', 'Soy de Madrid.'),
  W('en', 'in; at', 'v', 'Ana está en Madrid.'),
  W('a', 'to', 'do / k', 'Vamos a Madrid.'),
  W('con', 'with', 's', 'Estoy con Ana.'),
  W('para', 'for', 'pro', 'Es para Ana.'),
  W('por', 'for; because of', 'za / kvůli', 'Gracias por todo.'),
  W('pero', 'but', 'ale', 'Sí, pero no.'),
  W('o', 'or', 'nebo', '¿Sí o no?'),
  W('sin', 'without', 'bez', 'Estoy sin trabajo.'),
  W('porque', 'because', 'protože', '¿Por qué? Porque sí.'),
  W('aunque', 'although; even if', 'i když', 'Voy, aunque no quiero.'),
  // --- everyday verb forms ------------------------------------------------
  W('hablo', 'I speak', 'mluvím', 'Hablo con Ana.'),
  W('entiendo', 'I understand', 'rozumím', 'No entiendo.'),
  W('necesito', 'I need', 'potřebuji', 'Necesito agua.'),
  W('gusta', 'pleases (me gusta = I like it)', 'líbí se / chutná (me gusta = líbí se mi)', '¡Me gusta!'),
  // --- adverbs & quantifiers ----------------------------------------------
  W('muy', 'very', 'velmi', 'Estoy muy bien.'),
  W('más', 'more', 'víc', 'Quiero más.'),
  W('también', 'also; too', 'také', 'Yo también.'),
  W('ahora', 'now', 'teď', 'Ahora no puedo.'),
  W('aquí', 'here', 'tady', 'Ana no está aquí.'),
  W('hoy', 'today', 'dnes', 'Hoy estoy muy bien.'),
  W('mañana', 'tomorrow; morning', 'zítra / ráno', 'Mañana voy a Madrid.'),
  W('siempre', 'always', 'vždycky', 'Siempre estoy aquí.'),
  W('nunca', 'never', 'nikdy', 'Nunca voy sin Ana.'),
  W('mucho', 'a lot; much', 'hodně', 'Hablo mucho.'),
  W('poco', 'little; a bit', 'trochu / málo', 'Hablo un poco.'),
  W('todo', 'everything; all', 'všechno', 'Todo está bien.'),
  W('nada', 'nothing', 'nic', 'No sé nada.'),
  W('hay', 'there is; there are', 'je / jsou (někde něco)', 'No hay nada.'),
  W('algo', 'something', 'něco', '¿Hay algo?'),
  W('esto', 'this', 'tohle', '¿Qué es esto?'),
  W('eso', 'that', 'to', '¡Eso es!'),
  // --- core adjectives ----------------------------------------------------
  W('bueno', 'good; well then', 'dobrý', 'Bueno, vamos.'),
  W('grande', 'big', 'velký', 'Madrid es grande.'),
  W('pequeño', 'small', 'malý', 'Madrid no es pequeño.'),
  W('nuevo', 'new', 'nový', 'Tengo un trabajo nuevo.'),
  W('bonito', 'pretty; nice', 'hezký', 'Es muy bonito.'),
  W('fácil', 'easy', 'snadný', 'Es fácil, ¿no?'),
  W('difícil', 'difficult', 'těžký', 'No es difícil.'),
  W('importante', 'important', 'důležitý', 'Es muy importante.'),
  // --- core nouns ---------------------------------------------------------
  W('casa', 'house; home', 'dům / domov', 'Estoy en casa.'),
  W('agua', 'water', 'voda', '¿Hay agua?'),
  W('comida', 'food', 'jídlo', 'La comida está muy buena.'),
  W('día', 'day', 'den', '¡Buenos días!'),
  W('noche', 'night', 'noc', '¡Buenas noches!'),
  W('tiempo', 'time; weather', 'čas / počasí', 'No tengo tiempo.'),
  W('año', 'year', 'rok', 'Un año más.'),
  W('amigo', 'friend', 'přítel / kamarád', 'Marco es mi amigo.'),
  W('familia', 'family', 'rodina', 'Mi familia es grande.'),
  W('trabajo', 'work; job', 'práce', 'Tengo mucho trabajo.'),
  W('ciudad', 'city', 'město', 'Madrid es una ciudad grande.'),
  W('vida', 'life', 'život', 'Mi vida está aquí.'),
  W('español', 'Spanish', 'španělština', 'Hablo un poco de español.'),
  // --- calibration-seed tail (lower frequency, kept for the escape hatch's
  //     no-fallback translation lookup; still frequency-descending) ---------
  W('acuerdo', 'agreement (de acuerdo = okay)', 'dohoda (de acuerdo = platí)', 'De acuerdo, vamos.'),
  W('mejorar', 'to improve', 'zlepšit (se)', 'Quiero mejorar mi español.'),
  W('paisaje', 'landscape; scenery', 'krajina', 'El paisaje es muy bonito.'),
  W('cotidiano', 'everyday; daily', 'každodenní', 'Es la vida cotidiana.'),
  W('asequible', 'affordable', 'cenově dostupný', 'La casa no es asequible.'),
  W('imprescindible', 'essential', 'nezbytný', 'El agua es imprescindible.'),
];

const indexByNormalized = new Map<string, number>(
  STARTER_DECK.map((w, i) => [w.id, i])
);

/** Deck rank of a word by normalized identity, or -1. This is the ONE lookup
    both the deck screen and the escape hatch use — the same identity rule as
    the deck's skip-already-saved check. */
export function starterIndexOf(text: string): number {
  return indexByNormalized.get(normalizeAnswer(text)) ?? -1;
}

/** Resolve a card's translation for the UI language; 'en' is the guaranteed
    fallback (the deck test asserts it is always present). */
export function starterTranslation(entry: StarterWord, language: string): string {
  return entry.translations[language] ?? entry.translations.en ?? entry.word;
}
