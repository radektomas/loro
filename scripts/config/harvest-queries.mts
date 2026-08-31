/**
 * Discovery pipeline configuration — the knobs, all in one place.
 *
 * Everything here is meant to be tuned by hand: the search matrix, the quota
 * budget, and the filter thresholds. The harvest script and the filter read
 * these constants and hold no numbers of their own.
 *
 * Queries are written in SPANISH on purpose. English queries ("street food
 * Spain") surface English-language content ABOUT the Spanish-speaking world,
 * which is exactly the opposite of what the feed needs — we want native
 * speakers talking, not travel vloggers narrating in English.
 *
 * TWO RULES, both learned the expensive way (2026-07-21):
 *
 * 1. A query must TERMINATE. "que ver en" ended on a preposition and, because
 *    `ver` is one of the commonest verbs in Spanish, matched "despues de VER
 *    una pelicula" — 17 of its 89 rows were Mikecrack shorts. Never end a
 *    query on a preposition, article, or high-frequency verb. Query LENGTH is
 *    not the issue: two-word queries like "receta facil" (38.3%) and
 *    "paisajes naturales" (38.9%) perform fine.
 *
 * 2. Write ñ as ñ. Search folds ñ->n, so "montana" still matched "montaña" —
 *    but it ALSO matched the English word "Montana", pulling in exactly the
 *    English content rule 0 exists to keep out. Ordinary accents (á é í ó ú)
 *    are deliberately NOT normalised across the config: the query string is
 *    the key in loro_video_candidates.source_queries, so rewriting them would
 *    fragment per-query yield history for no measured benefit.
 */

// ------------------------------------------------------------------- topics

export type TopicSlug =
  | 'animals'
  | 'travel'
  | 'food'
  | 'daily-routine'
  | 'street-interviews'
  | 'nature'
  | 'sports'
  | 'technology'
  | 'talking-head'
  | 'travel-vlog'
  | 'positive-shorts'
  | 'personal-story'
  | 'life-lesson'
  | 'vox-pop'
  | 'local-speech';

export type Topic = {
  slug: TopicSlug;
  /** Human label, for the report only. */
  label: string;
  /** Spanish search queries. Each one is a separate (and costly) search.list call. */
  queries: readonly string[];
  /** Written to loro_video_candidates.topic_tags — our taxonomy, not YouTube's. */
  tags: readonly string[];
  /**
   * Regions to sweep FOR THIS TOPIC. Measured 2026-07-21: regionCode is a real
   * axis for geographic queries ("que ver en": 54-68% cross-region overlap,
   * 1.66x distinct yield) and near-noise for generic ones ("animales curiosos":
   * 79-86% overlap against an 88% same-region temporal floor, 1.27x).
   * So geographic topics keep several regions and generic ones collapse to one.
   *
   * Generic topics get DIFFERENT single regions rather than all sharing MX:
   * the choice is nearly free when region is noise, so it is spent hedging
   * against region mattering more than one experiment showed.
   */
  regions: readonly Region[];
  /**
   * Pages of search results to fetch per (query x region). Each extra page is
   * another 100 units. Only raise it where nextPageToken has actually been
   * observed for that topic — see loro_harvest_pages.
   */
  pages: number;
};

/** Geographic topics: content genuinely differs by country. */
const GEOGRAPHIC_REGIONS: readonly Region[] = ['MX', 'AR', 'ES', 'CO'];

export const TOPICS: readonly Topic[] = [
  {
    slug: 'animals',
    label: 'Animals',
    queries: [
      'animales curiosos',
      'cosas que hace mi perro',
      'gatos graciosos',
      'animales de la granja',
      'rescate de animales',
    ],
    tags: ['animals'],
    // Generic: measured as near-noise across regions. MX keeps continuity with
    // the MX/AR/ES rows already harvested.
    regions: ['MX'],
    pages: 1,
  },
  {
    slug: 'travel',
    label: 'Travel',
    queries: [
      'lugares imprescindibles',
      // Restored alongside 'lugares imprescindibles', not instead of it.
      // It IS lexically broken — it ends on a preposition and `ver` is one of
      // the commonest Spanish verbs, so it pulls unrelated "ver una pelicula"
      // content (17 of its 89 rows were Mikecrack shorts). But measured per
      // 100-unit search it produced 10.0 eligible against the replacement's
      // 5.8 — 1.7x more productive even after the pollution was rejected.
      // The blocklist already absorbs its failure mode, so the defect is
      // cheaper than the fix. Keep BOTH; do not "tidy" this one away again.
      'que ver en',
      'asi fue mi viaje',
      'consejos de viaje',
      'un dia en la ciudad',
      'lugares que visitar',
    ],
    tags: ['travel'],
    regions: GEOGRAPHIC_REGIONS,
    pages: 1,
  },
  {
    slug: 'food',
    label: 'Food & cooking',
    queries: [
      'receta facil',
      'cocinando en casa',
      'comida callejera',
      'desayuno tipico',
      'probando comida',
    ],
    tags: ['food', 'cooking'],
    regions: GEOGRAPHIC_REGIONS,
    pages: 1,
  },
  {
    slug: 'daily-routine',
    label: 'Daily routine',
    queries: [
      'mi rutina diaria',
      'un dia en mi vida',
      'mi rutina de la mañana',
      'asi es mi dia',
    ],
    tags: ['daily-routine', 'lifestyle'],
    regions: ['CO'],
    pages: 1,
  },
  {
    slug: 'street-interviews',
    label: 'Street interviews',
    // The single richest source of natural, unscripted, native speech.
    queries: [
      'entrevistas en la calle',
      'preguntas en la calle',
      'le pregunte a la gente',
      'la gente responde',
    ],
    tags: ['street-interviews', 'conversation'],
    regions: GEOGRAPHIC_REGIONS,
    // Raised 1 -> 3 (2026-08-14). This is the ONLY topic where depth is a safe
    // bet rather than a hope: it is the best-yielding topic measured (45.9%),
    // its best query is the best of all 35 ('le pregunte a la gente', 54.9%),
    // and every one of its page-0 rows still carries an unused nextPageToken.
    // Depth costs 100 units a page and needs no new query to be invented.
    pages: 3,
  },
  {
    slug: 'nature',
    label: 'Nature',
    queries: [
      'paisajes naturales',
      'caminata por el bosque',
      'explorando la naturaleza',
      'playa y montaña',
    ],
    tags: ['nature'],
    regions: ['CR'],
    pages: 1,
  },
  {
    slug: 'sports',
    label: 'Sports',
    queries: [
      'rutina de ejercicio en casa',
      'entrenamiento de futbol',
      'como jugar mejor',
      'deporte al aire libre',
    ],
    tags: ['sports'],
    // Provisionally generic — never probed. Phase A measures whether it
    // behaves geographically (local teams/leagues) before it gets more regions.
    regions: ['MX'],
    pages: 1,
  },
  {
    slug: 'technology',
    label: 'Technology',
    queries: [
      'review de celular',
      'como usar el movil',
      'tecnologia explicada',
      'trucos de android',
    ],
    tags: ['technology'],
    regions: ['ES'],
    pages: 1,
  },
  {
    slug: 'talking-head',
    label: 'Talking head',
    /**
     * Added 2026-08-14, and the only topic in this list selected by FORMAT
     * rather than subject matter. Every other topic asks "what is this about?"
     * and hopes a person is on camera; measured on the live pool, that hope
     * pays off 33% of the time — two thirds of everything that survives text
     * curation turns out to be hands-only demos, B-roll with a voiceover, or
     * (in one case that passed every text filter) Minecraft footage under a
     * title about Intel processors.
     *
     * So these queries name the format itself. A person recounting an
     * experience, giving an opinion, or answering a stranger's question is
     * almost necessarily filmed facing a camera — there is nothing else to
     * show. Subject matter is deliberately unconstrained: the feed wants
     * natural connected speech, and it does not care what it is about.
     *
     * All six terminate on a noun or adjective, per rule 1 at the top of this
     * file. 'encuesta en la calle' is a deliberate near-duplicate of the
     * street-interviews set — same format, different word, and query-level
     * yield history shows near-synonyms surface substantially different rows.
     */
    queries: [
      'mi experiencia personal',
      'les cuento mi historia',
      'consejos para principiantes',
      'encuesta en la calle',
      'mi opinion sincera',
      'preguntas incomodas',
    ],
    tags: ['talking-head', 'conversation'],
    regions: GEOGRAPHIC_REGIONS,
    pages: 1,
  },
  {
    slug: 'travel-vlog',
    label: 'Travel vlog (selfie)',
    /**
     * Added 2026-08-18 — the second format-first topic, after talking-head
     * proved the approach (gate pass 33% -> 48%). Where 'travel' asks about
     * the PLACE and hopes for a person, these queries name the selfie-vlog
     * format in a travel setting: someone holding the camera at arm's length
     * and telling you about their trip, their move abroad, their city. That
     * framing is almost necessarily a face talking to the lens.
     *
     * All six terminate on a noun, adjective, or content gerund per rule 1.
     * Accent-free like the rest of the file ('mude', 'pais', 'aprendi');
     * query strings are yield-history keys, so spelling is frozen once run.
     */
    queries: [
      'vlog de viaje',
      'viajando sola',
      'les muestro mi ciudad',
      'me mude a otro pais',
      'mi primer viaje',
      'que aprendi viajando',
    ],
    tags: ['travel', 'talking-head'],
    // Geographic on its face (trips, cities, countries), so it sweeps the
    // full region set like 'travel' does.
    regions: GEOGRAPHIC_REGIONS,
    pages: 1,
  },
  {
    slug: 'positive-shorts',
    label: 'Positive shorts (person speaking)',
    /**
     * Added 2026-08-22 — the third format-first topic. Motivated by a
     * measured gap, not a hunch: after the 2026-08-21 moderation pass the
     * owner asked for 15-40s "people talking about nice things", and two
     * full-quota sweeps of the existing matrix produced almost nothing in
     * that window — street-interview queries at depth pull news/politics,
     * and the subject topics pull demos and B-roll. What DID work was
     * hand-picking small vox-pop channels (12 of 13 passed the vision gate),
     * which is exactly the format these queries name: one person telling
     * you something pleasant — a memory, a piece of advice, good news.
     *
     * All six terminate on a noun or adjective per rule 1. Accent-free like
     * the rest of the file; query strings are yield-history keys.
     */
    queries: [
      'mi consejo favorito',
      'una historia bonita',
      'mi mejor recuerdo',
      'te cuento algo bonito',
      'una buena noticia',
      'lo que me hace feliz',
    ],
    tags: ['talking-head', 'positive'],
    // Format-first and non-geographic on its face, but kept on the full
    // region sweep like talking-head: accent diversity is the feed's goal
    // and these queries are cheap (6 x 4 x 1 page = 2,400 units).
    regions: GEOGRAPHIC_REGIONS,
    pages: 1,
  },
  {
    slug: 'personal-story',
    label: 'Personal story (to camera)',
    /**
     * Added 2026-08-24 — the fifth format-first topic, and NEW QUERIES rather
     * than another sweep, which is the only thing that pays here: a pages:1
     * topic has no cursor to advance into, so re-running one re-fetches page 0
     * and dedupes almost everything (positive-shorts re-run, 2 424 units for
     * ~1 net eligible).
     *
     * The format is the one the feed is shortest on: a person telling you
     * something that happened to them, straight down the lens. Not a subject —
     * an anecdote, a Q&A, a reflection, a hard-won lesson. There is nothing
     * else to film, so the camera has to be on their face, which is exactly
     * what the on-camera gate looks for.
     *
     * All six terminate on a noun, per rule 1 at the top of this file. ñ is
     * written as ñ ('español') per rule 2; ordinary accents are left off
     * ('superacion', 'reflexion', 'decision') like the rest of the file,
     * because the query string is the yield-history key and must not churn.
     * 'mi peor experiencia' is a deliberate near-synonym of talking-head's
     * 'mi experiencia personal' — near-synonyms have measured out as
     * surfacing substantially different rows.
     */
    queries: [
      'storytime en español',
      'respondiendo sus preguntas',
      'mi peor experiencia',
      'mi historia de superacion',
      'reflexion del dia',
      'la mejor decision de mi vida',
    ],
    tags: ['talking-head', 'conversation'],
    // Same reasoning as positive-shorts: format-first, but swept across all
    // four regions for accent diversity. 6 x 4 x 1 page = 2,400 units.
    regions: GEOGRAPHIC_REGIONS,
    pages: 1,
  },
  {
    slug: 'life-lesson',
    label: 'Life lesson (to camera)',
    /**
     * Added 2026-08-24 alongside personal-story, which yielded 96 eligible
     * from 373 rows on its first sweep — 25.7%, against ~1 net eligible for
     * re-running an exhausted pages:1 topic. New queries are the only lever
     * that moves this pool, so this is a second set aimed at the same format
     * from a different angle: not the story, but the conclusion drawn from it.
     *
     * Where personal-story asks for the anecdote ('mi peor experiencia'),
     * these ask for the lesson, the correction, the reply to the audience.
     * Same physical consequence: nothing to film but the speaker's face.
     *
     * All six terminate on a noun or a content gerund, per rule 1. ñ written
     * as ñ ('año') per rule 2; ordinary accents left off ('cambio',
     * 'aprendi') as everywhere else in this file, because the query string is
     * the yield-history key.
     */
    queries: [
      'mi mayor error',
      'lo que cambio mi vida',
      'respondo comentarios',
      'consejo para mi yo del pasado',
      'lo que aprendi este año',
      'mi experiencia trabajando',
    ],
    tags: ['talking-head', 'conversation'],
    regions: GEOGRAPHIC_REGIONS,
    pages: 1,
  },
  {
    slug: 'vox-pop',
    label: 'Vox pop (strangers answering)',
    /**
     * Added 2026-08-27 — the sixth format-first topic. Same reasoning as
     * personal-story and life-lesson: a pages:1 topic has no cursor to
     * advance into, so NEW QUERIES are the only lever that moves the pool,
     * and the previous sweep's publishable tail had gone junk-dry (the
     * >=5k-view auto-plan surfaced ~60 rows under 50s of which ~11 were
     * actually a person speaking).
     *
     * street-interviews already asks a stranger a question; these ask it in
     * the words the genre's own channels use, which measured out as
     * surfacing substantially different rows for every near-synonym tried so
     * far. 'cuanto gana la gente' is the salary vox-pop format specifically:
     * it is the one query here with live evidence behind it, since the two
     * Adrian G.Martin rows it describes ('¿Cuánto gana el dueño de un Taxi?',
     * 28s; '¿Cuánto Gana un Barbero en España?', 32s) were the strongest
     * short talking-heads left in the drained pool.
     *
     * All six terminate on a noun, adjective or adverb, per rule 1. ñ written
     * as ñ ('extraños') per rule 2; ordinary accents left off ('cuanto',
     * 'opina') like the rest of the file, because the query string is the
     * yield-history key and must not churn.
     */
    queries: [
      'entrevistando desconocidos',
      'hablando con extraños',
      'que opina la gente',
      'cuanto gana la gente',
      'preguntas a desconocidos',
      'opiniones de la calle',
    ],
    tags: ['street-interviews', 'talking-head', 'conversation'],
    regions: GEOGRAPHIC_REGIONS,
    /**
     * 1 -> 2 on its own first-run evidence (2026-08-27), the same test
     * street-interviews passed before it: depth is only worth buying where
     * page 0 came back unexhausted. It did — 23 of 24 combinations returned a
     * nextPageToken — and this topic's yield is the best measured in the
     * matrix: 'cuanto gana la gente' 55.5%, above street-interviews' best
     * ('le pregunte a la gente', 54.9%) and the 18.6% topic average.
     *
     * Deliberately 2, not 3: page 1 is a fresh page, page 0 is a re-fetch
     * that dedupes (see [[loro-harvest-gotchas]] #4), so the marginal page
     * has to earn its 2,400 units against a topic that has now been swept
     * once. Raise to 3 only if a pages:2 run comes back still unexhausted
     * AND still yielding.
     */
    pages: 2,
  },
  {
    slug: 'local-speech',
    label: 'Local speech (how we talk here)',
    /**
     * Added 2026-08-27 alongside vox-pop, from a different angle: people
     * talking about how their own country speaks — slang, accent, local
     * expressions. Two reasons it belongs in a format-first list.
     *
     * Physically, it is a to-camera format by necessity: the subject is
     * speech itself, so there is nothing to film but the speaker saying the
     * words. Editorially, it is the one subject where an accent-diverse feed
     * is the POINT rather than a side effect — GEOGRAPHIC_REGIONS returns
     * four different answers to the same query by construction.
     *
     * Known failure mode, accepted: language-teaching channels post the same
     * titles over text-card slideshows with a voiceover. The on-camera gate
     * is exactly the filter for that, and it runs before anything expensive.
     *
     * All six terminate on a noun or adverb, per rule 1. ñ written as ñ
     * ('españoles') per rule 2; ordinary accents left off ('pais', 'region',
     * 'tipicas') like the rest of the file.
     */
    queries: [
      'expresiones tipicas de mi pais',
      'palabras que solo decimos aqui',
      'como hablamos en mi pais',
      'jerga de mi pais',
      'acento de mi region',
      'palabras que usamos los españoles',
    ],
    tags: ['local-speech', 'talking-head', 'conversation'],
    regions: GEOGRAPHIC_REGIONS,
    pages: 1,
  },
];

// ------------------------------------------------------------------ regions

/**
 * regionCode for search.list. Accent diversity is the point: a feed built
 * only on MX Spanish teaches only MX Spanish. Written to region_hint as a
 * hint about provenance, never as a claim about the speaker's accent.
 */
export const REGIONS = ['MX', 'AR', 'ES', 'CO', 'CR', 'PE', 'CL'] as const;
export type Region = (typeof REGIONS)[number];

// ----------------------------------------------------------------- licenses

/**
 * The two search branches. NOTE these are the API's *search filter* values,
 * which are not the same vocabulary as the stored license:
 *
 *   branch 'creativeCommon' -> returns only CC-BY videos
 *   branch 'any'            -> returns both, so the stored license comes back
 *                              per-video from videos.list (status.license)
 *
 * The stored value ('creativeCommon' | 'youtube') is what decides whether a
 * video may ever be downloaded. See the LICENSE block in the migration.
 * We run BOTH branches rather than only 'any' because CC videos are a thin
 * minority — searching for them explicitly is the only way to find enough of
 * them to answer "is self-hosting viable at all?".
 */
export type LicenseBranch = 'creativeCommon' | 'any';

/** Every branch the CLI accepts. Historical rows and harvest_pages use both. */
export const LICENSE_BRANCHES: readonly LicenseBranch[] = [
  'creativeCommon',
  'any',
];

/**
 * What the SWEEP actually walks — Creative Commons only.
 *
 * The 'any' branch was dropped 2026-07-21. Not for quota: embed-only content
 * cannot feed the transcription pipeline at all. There is no lawful audio
 * access for videos we do not own, and YouTube's caption tracks are cue-level,
 * while Loro's core loop is built on Whisper word-level timings. A 'ready'
 * embed-only row could never mean what a 'ready' CC row means, so it would be
 * a second, weaker content class wearing the same status name.
 *
 * Existing license='youtube' rows stay in the table; we simply stop harvesting
 * that branch. `--license any` therefore now selects zero combinations.
 */
export const SWEPT_LICENSE_BRANCHES: readonly LicenseBranch[] = ['creativeCommon'];

/** What actually lands in the table. Never widen this without a legal review. */
export type StoredLicense = 'creativeCommon' | 'youtube';

// -------------------------------------------------------------------- quota
// search.list costs 100 units, videos.list costs 1, the default daily cap is
// 10,000 — about 95 searches a day. The full matrix is
// (sum of queries) x 7 regions x 2 licenses = 35 x 7 x 2 = 490 search calls,
// so a complete sweep is roughly five days of quota. That is why the run is
// resumable rather than one-shot.

export const QUOTA_COST = {
  search: 100,
  videos: 1,
} as const;

/**
 * The project's daily allowance, reset at midnight Pacific. Used together
 * with the recorded spend of earlier runs the same day, so two runs in one
 * day cannot jointly overshoot even though each respects QUOTA_BUDGET.
 * Raise only if Google grants an increase.
 */
export const DAILY_QUOTA_UNITS = 10_000;

/**
 * Hard stop for a single run. Below the 10,000 daily cap on purpose: leaves
 * headroom for a second run the same day and for the videos.list calls that
 * trail each search. The script exits cleanly when spending the NEXT call
 * would cross this — never mid-write.
 */
export const QUOTA_BUDGET = 9_000;

/**
 * Fallback page depth for topics that do not state their own. Each extra page
 * is another 100 units, so raise it only where nextPageToken proves depth.
 */
export const DEFAULT_PAGES_PER_COMBO = 1;

// --------------------------------------------------------------- networking

/** Politeness delay between API calls. */
export const REQUEST_DELAY_MS = 250;
/** Retries on 403 (rate limit flavour) / 429 / 5xx before giving up. */
export const MAX_RETRIES = 5;
/** Exponential backoff base: 1s, 2s, 4s, 8s, 16s (plus jitter). */
export const RETRY_BASE_MS = 1_000;

// ------------------------------------------------------------ filter tuning

/**
 * Every threshold the filter applies. Tune here; the filter itself contains
 * no literals. Each one maps to exactly one reject_reason so you can count
 * rows per cause and see which threshold is actually costing you content.
 */
export const FILTER = {
  /** Shorter than this and there is not enough speech to learn from. */
  MIN_DURATION_SECONDS: 15,
  /** Matches MAX_UPLOAD_SECONDS in lib/creators.ts — the feed's clip ceiling. */
  MAX_DURATION_SECONDS: 90,
  /** YouTube category 10 = Music. Lyrics gloss badly and teach nothing useful. */
  MUSIC_CATEGORY_ID: '10',
  /** Accepts 'es', 'es-MX', 'es-419', ... and rejects 'en', 'pt-BR', ... */
  AUDIO_LANGUAGE_PREFIX: 'es',
  /** Below this the video is essentially unvetted by any audience. */
  MIN_VIEW_COUNT: 1_000,
  /** likes/views. 0.5% is a weak-but-real signal of an audience that liked it. */
  MIN_LIKE_RATIO: 0.005,
  /**
   * Source diversity: one channel may not dominate the feed. A candidate is
   * rejected once its channel already has MORE than this many eligible rows,
   * so this is the count a channel is allowed to hold.
   */
  MAX_ELIGIBLE_PER_CHANNEL: 15,
} as const;

// ------------------------------------------------------------ channel block
/**
 * Channels whose content never belongs in an immersion feed.
 *
 * This is an EDITORIAL override, not a classifier. It exists precisely because
 * the signals we have (category_id, view counts, title patterns) cannot
 * reliably tell scripted voiceover-over-B-roll from a person speaking on
 * camera — see the analysis in the README. Rather than encode a ~65%-precision
 * guess as an automatic reject, a human names the channel and says why.
 *
 * Blocking is never deletion. A blocked channel's videos stay in the table as
 * status='rejected', reject_reason='channel_blocked', so that:
 *   - they are not rediscovered and re-judged on every future harvest, and
 *   - the fact that we already judged them survives.
 * Deleting them would guarantee we pay to rediscover and re-evaluate them
 * forever.
 *
 * After editing this list, run `npm run refilter -- --apply` to apply it
 * retroactively to rows already in the table. That costs zero quota.
 */
export type BlockedChannel = {
  /** YouTube channel id (UC...). The stable key — titles get renamed. */
  channelId: string;
  /** Human label, so this list is readable in review. */
  title: string;
  /** Why it was blocked. Required: an unexplained blocklist rots. */
  reason: string;
};

export const BLOCKED_CHANNELS: readonly BlockedChannel[] = [
  // Approved 2026-07-21 after reviewing all 172 channels then in the table.
  // Common thread: scripted voiceover over stock/gameplay footage, no person
  // speaking on camera, little or no connected conversational speech.
  //
  // NOT blocked, deliberately: narrated-over-footage channels whose Spanish is
  // clean and slow (CuriosaMente, Palaeos, Perros Curiosos, …). That register
  // is often BETTER for A1/A2 learners than real conversation — no overlapping
  // speakers, careful articulation. They need a tag distinguishing them from
  // conversational content, not a block. See "Deferred" in the README.
  {
    channelId: 'UCqJ5zFEED1hWs0KNQCQuYdQ',
    title: 'Mikecrack',
    reason: 'shouted reaction/illusion shorts; minimal connected speech',
  },
  {
    channelId: 'UCnm1ctk8ujjQlenfI0trHWw',
    title: 'Mikecrack Fans',
    reason: 'fan re-uploads of the above; blocked before it earns eligible rows',
  },
  {
    channelId: 'UCmb0LnmFYceH7toqgmUTJDA',
    title: 'Vandal',
    reason: 'scripted voiceover over gameplay footage',
  },
  {
    channelId: 'UCusHFtPcIizOStyvHJjqTjA',
    title: 'Animalízate',
    reason: 'narrated animal-fact listicles over stock footage',
  },
  {
    channelId: 'UCei7g8YqiE_-r71cpXn2Dsw',
    title: 'Instinto Viral',
    reason: 'narrated listicles, hashtag-stuffed titles',
  },
  {
    channelId: 'UCFFavnp3BGB_aS-PYWhCBEQ',
    title: 'Curiosidadestop10',
    reason: 'narrated top-N listicles, synthetic-sounding delivery',
  },
  {
    channelId: 'UCapRTMkO4n3LP5dkmIayy5A',
    title: 'Jexs',
    reason: 'narrated animal listicles over stock footage',
  },
  {
    channelId: 'UCwMeU6G2NYKGDt6RqXcjp5Q',
    title: 'CRISTIAN REGIL',
    reason: 'narrated fact shorts over stock footage',
  },
  {
    channelId: 'UCS3ijDAyd0_P2399L1Itz0A',
    title: 'MatWolf16',
    reason: 'meme/skit shorts; almost no spoken content',
  },
  // Approved 2026-07-21, second pass. Different failure modes from the first
  // batch: rights provenance, advertising, and dubbing.
  {
    channelId: 'UCbFz_jhxstKZWFnzk-qmPAA',
    title: 'Lugares Extraordinarios del Mundo',
    reason:
      'content-farm profile (1.5k videos / 194k subs); clickbait documentary ' +
      'format over stock/third-party footage the channel almost certainly does ' +
      'not own, so its CC-BY declaration cannot be relied on. Our rows are ~20s ' +
      'Shorts cut from long-form uploads, a further derivative. Voiceover likely ' +
      'synthetic. RIGHTS risk, not just quality — do not self-host from here.',
  },
  {
    channelId: 'UCqJCzG9bO3EFFkXiC3WusZw',
    title: 'ALDI España',
    reason: 'corporate advertising channel, not learner content',
  },
  {
    channelId: 'UCJoOIj9Yu71wklP3EFzL8-A',
    title: 'Sadhguru Español',
    reason:
      'dubbed content — the original speaker is not a Spanish speaker. The ' +
      'channel self-declares "voz doblada con IA" on only 7 of its 20 rows, so ' +
      'dubbing_suspected caught those and missed the other 13, which carry no ' +
      'textual dubbing signal at all. Blocked at the channel level because the ' +
      'per-video text signal provably cannot cover it.',
  },
  {
    channelId: 'UCSLcn4bxyfryukB5I824fIw',
    title: 'OIKOS BEE',
    reason:
      'rabbit-farming channel whose clips are how-to-slaughter-a-rabbit ' +
      'content ("como sacrificar un conejo..."). Two of them reached the live ' +
      'feed (2026-08-21) — animal-slaughter footage has no place in a language ' +
      'learning app regardless of the Spanish being genuine. Also the incident ' +
      'that motivated CONTENT_KEYWORDS below, which would have caught all ' +
      'three of its rows on "sacrificar" alone.',
  },
  // Approved 2026-08-21, owner review of the retroactive on-camera audit
  // (audit-on-camera.mts over all 300 published embeds). Every channel here
  // had ALL of its published videos marked for removal — no survivors —
  // which is the bar for a channel block versus a BLOCKED_VIDEOS entry.
  {
    channelId: 'UCCBYEz_L1MyxEO0VEFsgn0g',
    title: 'PERO, ¿QUÉ DIRÍA MARCO AURELIO?',
    reason:
      'no person speaking on camera — other/voiceover-broll/animation format across all ' +
      '3 published videos; every one failed the retroactive vision audit and ' +
      'was marked for removal in the owner review of 2026-08-21.',
  },
  {
    channelId: 'UCuTKQx84XfjD1KuOPbG4i6Q',
    title: 'JuanFe Castro',
    reason:
      'no person speaking on camera — hands-only format across all ' +
      '2 published videos; every one failed the retroactive vision audit and ' +
      'was marked for removal in the owner review of 2026-08-21.',
  },
  {
    channelId: 'UCkBbtbivQK6-GuQTP5Y8iOg',
    title: 'Tenorshare Spanish',
    reason:
      'no person speaking on camera — hands-only/voiceover-broll format across all ' +
      '5 published videos; every one failed the retroactive vision audit and ' +
      'was marked for removal in the owner review of 2026-08-21.',
  },
  {
    channelId: 'UCzGc46rimrMvbNsWUamwqHg',
    title: 'ACENTO Escuela de Animadores',
    reason:
      'no person speaking on camera — other format across all ' +
      '2 published videos; every one failed the retroactive vision audit and ' +
      'was marked for removal in the owner review of 2026-08-21.',
  },
  {
    channelId: 'UCWKsHoNH4__DbLA3j35_FbQ',
    title: 'Anima Dogs and Cats',
    reason:
      'no person speaking on camera — voiceover-broll/hands-only format across all ' +
      '2 published videos; every one failed the retroactive vision audit and ' +
      'was marked for removal in the owner review of 2026-08-21.',
  },
  {
    channelId: 'UCkGAI5dpY7fHktujxNByHxg',
    title: 'Darry Tech',
    reason:
      'no person speaking on camera — hands-only format across all ' +
      '6 published videos; every one failed the retroactive vision audit and ' +
      'was marked for removal in the owner review of 2026-08-21.',
  },
  {
    channelId: 'UCRv_lHETqjDvy840Rw48smw',
    title: 'Cómo',
    reason:
      'no person speaking on camera — voiceover-broll format across all ' +
      '2 published videos; every one failed the retroactive vision audit and ' +
      'was marked for removal in the owner review of 2026-08-21.',
  },
];

/** Lookup set derived from the list above — the filter uses this. */
export const BLOCKED_CHANNEL_IDS: ReadonlySet<string> = new Set(
  BLOCKED_CHANNELS.map((channel) => channel.channelId)
);

// -------------------------------------------------------------- video block
/**
 * Individual videos that must never be in the feed, from channels that are
 * otherwise fine. Same contract as BLOCKED_CHANNELS: an editorial override, a
 * human names the video and says why, and blocking is never deletion — the
 * candidate row stays as status='rejected', reject_reason='video_blocked', so
 * the verdict survives every future harvest and refilter.
 *
 * Prefer BLOCKED_CHANNELS when the whole channel is the problem: a channel
 * that produced one bad video usually produces more, and a channel block is
 * one entry instead of a growing list. This list is for the genuine one-off.
 *
 * After editing, `npm run refilter -- --apply` makes it retroactive over the
 * candidate pool, and `npm run prune-embeds -- --apply` removes any entry
 * that already reached data/embedVideos.json.
 */
export type BlockedVideo = {
  /** The YouTube video id — the same value as loro_video_candidates.youtube_id. */
  youtubeId: string;
  /** Human label, so this list is readable in review. */
  title: string;
  /** Why it was blocked. Required: an unexplained blocklist rots. */
  reason: string;
};

export const BLOCKED_VIDEOS: readonly BlockedVideo[] = [
  // Owner review 2026-08-21: retroactive vision audit + keyword report.
  // Video-level (not channel) because their channels keep other videos in
  // the feed, or the single bad video is not evidence about the channel.
  {
    youtubeId: 'nbtLM-OOh5s',
    title: 'Edher Vela — Joven ayuda a un gato en plena inundación en Veracruz',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'Cg3l3xwW0QY',
    title: 'Poemas Historias y Aventuraspk mc — Poema corto a papá 🥰🤵👷‍♂️👮‍♂️👨‍🏫👨‍⚖️',
    reason: 'vision audit: slideshow, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: '3FosEuFdIjk',
    title: 'IMachupicchu — Todo lo que necesitas saber antes de visitar Machu Picchu  #',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'duB6TwxqZ2A',
    title: 'Isabel Love — Bolonia|Italia|Que ver en Bolonia|Que hacer en Bolonia| Che ',
    reason: 'vision audit: other, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'sbI4ll8YTek',
    title: 'W Chris — JBL Tune Flex (Un bajo poderoso) @jbl',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'Hi3P8mwtVxs',
    title: 'Arquitecto Calderon — Saber la orientación del sol respecto al terreno #construcci',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'fptinLvBnkc',
    title: 'Radio Tiempo Colombia — La canción que Ricardo Arjona prometió no volver a cantar',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: '1p8sIYDW8TA',
    title: 'Hoft — BORUTO LE DICE TÍA A SAKURA👆🏻 #short #viral #fyp #boruto #',
    reason: 'vision audit: animation, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'm2qNgdFavaM',
    title: 'Girasol Vegan — 😋 HUMMUS FÁCIL Y CREMOSO !!',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: '-Kd8zU_pqeg',
    title: 'BretonEuro — Gasta 8,500 dólares todos los días solo para tocar como en s',
    reason: 'vision audit: other, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'LN0DibBU18g',
    title: 'Draxler  — JUGADORES que TOCARON LA COPA y aun así FUERON CAMPEONES #sh',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'QS6gSKFi0Zk',
    title: 'Neuro Todo — ¿Como ser frio y muy serio? Te lo explico #shorts',
    reason: 'vision audit: other, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'tdd2wSwh7V8',
    title: 'Esdras Gomez (esdras ab60) — Señalamientos de mano para el examen de manejo',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'DAvL3INNn78',
    title: 'Hospital Clínic de Barcelona — Calambres en las Piernas: 5 consejos útiles',
    reason: 'vision audit: other, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'XfGyI9ehrqE',
    title: 'Luis Felipe Camilo Mercedes — COMO Mirar tus Suscriptores desde tu Celular usando la aplic',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: '332amYO5Ptk',
    title: 'FEE en Español — Rebelión en la granja',
    reason: 'vision audit: slideshow, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: '9lg_YN_tpcY',
    title: 'Dario Coach — ⚡ Rompe a tu defensa en el primer bote 🏀',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'TnysbOf_Al0',
    title: 'Chenel Saul — Lugares Del Mundo Que Están Prohibidos Visitar Parte 1🤯#sho',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'luyrTcVpV94',
    title: 'Ramona Tech — Celular para gamer precio calidad Moto G60',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'FM_gkiDG7MM',
    title: 'Linux en Casa — Termux - Una Terminal de Comandos Linux en tu movil Android ',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'acgMiYTZdTE',
    title: 'El Diario De Jazmín — El Rescate MÁS BONITO A Un Gato',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'fGkdNo8qs-k',
    title: 'Artefisual — ¿Cómo funciona DNS?',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'cIcyaQlfS40',
    title: 'CurioCuy — 5 animales más raros del mundo🌎 #datoscurisos',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'TNpmhLKdImg',
    title: 'Edher Vela — ESTE LÁPIZ INTELIGENTE TE RESPONDE A CUALQUIER PREGUNTA EN S',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'y40c_f69_NI',
    title: 'NOLIMITE — Este perro atrapado hizo lo IMPOSIBLE para salvarse #dog #re',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'iYJNayqs61I',
    title: 'Tecnicia — El kernel de un sistema operativo explicado',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'BZwubIFILSg',
    title: 'Kivyru — ¿Twilight dejó MORIR a sus AMIGAS?',
    reason: 'vision audit: animation, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: '1p3ptlrAqBo',
    title: 'Zampar Con Arte — 🌸🥒 Sunomono. Ensalada de Pepino Japonesa 🥒🌸 #receta #hea',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'Pdm22ovvvOk',
    title: 'IntenzStudio — Emilio Azcarraga y su Problema con el Chavo del 8',
    reason: 'vision audit: other, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'DWnyso8qOiU',
    title: 'Iris and Petro — Desayuno chino',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'rpwI1AIVTiw',
    title: 'Edher Vela — Realizan desafío para ver quien dormía más! #dormir #sueño',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: '2oHNBJFUrQk',
    title: 'El Maestro Yona  — 🔋 ¿Qué significan los números de las pilas de botón? | CR20',
    reason: 'vision audit: voiceover-broll, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'ocryUtqk0NU',
    title: 'SharkSPA🦈 — ¡La reacción de estos niños al ver a la selección española f',
    reason: 'vision audit: other, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'x8w5Qwk7fDY',
    title: 'Parque de la Vida — Cuidado de la naturaleza',
    reason: 'vision audit: hands-only, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'UxD2TYKh7Zk',
    title: 'Tiitanes Futbol - Tips - Regates - Jugadas — CUANDO EL DEFENSA TE DICE QUE NO SABES JUGAR 😏🔥⚽️',
    reason: 'vision audit: other, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'IaArR3wOJrg',
    title: 'Tiitanes Futbol - Tips - Regates - Jugadas — RETANDO A MINI CRACKS 👦🏻⚽️🥅',
    reason: 'vision audit: other, 0/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'pGedB1dvKJs',
    title: 'Martín Cipoletta — 👉 Cómo Poner Cotas Automáticas en AutoCAD',
    reason: 'vision audit: reaction-overlay, 1/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'qPqscWDrKHg',
    title: 'Erik MV — Huawei Pura 80 Pro: La mejor cámara para foto y video noctur',
    reason: 'vision audit: talking-head, 1/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'Pt5BaWTvlRE',
    title: 'Jorge Fince Tips — Como activar el Modo IA en el buscador de Google',
    reason: 'vision audit: talking-head, 1/3 frames with a speaker; removed in the owner review of 2026-08-21.',
  },
  {
    youtubeId: 'Er9byZXOs7o',
    title: 'Roberto Avaria — Pacto de sangre o decretos de sangre #pactos #sangreroja #co',
    reason: 'content_keyword match (sangre) — subject matter, not format; removed in the owner review of 2026-08-21.',
  },
];

/** Lookup set derived from the list above — the filter uses this. */
export const BLOCKED_VIDEO_IDS: ReadonlySet<string> = new Set(
  BLOCKED_VIDEOS.map((video) => video.youtubeId)
);

// ---------------------------------------------------------- content keywords
/**
 * Topics that do not belong in a language-learning feed, matched against a
 * NORMALISED title+description (lowercased, accents stripped — same
 * normalizeText as DUBBING_PATTERNS), so patterns are written accent-free and
 * "Sacrifício" / "DEGÜELLO" match all the same.
 *
 * Born 2026-08-21, when two "como sacrificar un conejo (sin dolor)" rabbit-
 * slaughter videos were found LIVE in the feed. Nothing in the stack reads
 * the title for subject matter: the harvest filter checks rights and
 * structure, curation checks format. This is the missing content dimension.
 *
 * Each entry carries a term label that goes into the reject_reason as
 * `content_keyword:<term>`, so `select reject_reason, count(*)` shows which
 * term is doing the rejecting — the same tunability rule as every other
 * threshold in this file.
 *
 * DELIBERATELY EXCLUDED stems, learned from the false-positive smell test:
 *   - bare 'mata/mate/mato'  — plant, the drink, ordinary surname
 *   - bare 'muerto/a'        — "muerto de risa" and kin are everyday idiom
 *   - bare 'faena'           — ordinary word for chore/task
 *   - bare 'carne'           — every cooking video, which the feed wants
 * 'cuchillo' IS included despite guaranteed hits on knife-skills cooking
 * content — owner's call (2026-08-21); watch its histogram line and narrow
 * it here if it starts eating good recetas.
 *
 * INGEST-SIDE ONLY. A published video matching one of these is surfaced by
 * scripts/report-keyword-matches.mts for HUMAN review, never auto-removed:
 * "matar el tiempo" is a perfectly good clip title.
 */
export type ContentKeyword = {
  /** Short label written into reject_reason — one per word family. */
  term: string;
  /** Tested against normalizeText(title + description). Accent-free. */
  pattern: RegExp;
};

export const CONTENT_KEYWORDS: readonly ContentKeyword[] = [
  // Slaughter / butchering vocabulary, Spanish.
  { term: 'sacrificar', pattern: /\bsacrifi(c|qu)\w*/ }, // sacrificar, sacrificio, sacrifiquen
  { term: 'matar', pattern: /\bmatar\w*\b/ }, // matar, matarlo, mataron, matarife
  { term: 'matar', pattern: /\bmatando\b/ },
  { term: 'matar', pattern: /\bmatado\w*\b/ }, // matado, matadero
  { term: 'matanza', pattern: /\bmatanzas?\b/ },
  { term: 'degollar', pattern: /\bdegoll\w*/ }, // degollar, degollado
  { term: 'degollar', pattern: /\bdeguell\w*/ }, // degüello, degüella (accent-stripped)
  { term: 'faenar', pattern: /\bfaena(r|d|miento)\w*/ }, // faenar, faenado — NOT bare 'faena'
  { term: 'carnear', pattern: /\bcarnea(r|d)\w*/ }, // carnear, carneado — NOT bare 'carne'
  { term: 'destazar', pattern: /\bdestaz\w*/ }, // destazar, destazando
  { term: 'destazar', pattern: /\bdestace\w*/ },
  { term: 'muerte', pattern: /\bmuertes?\b/ },
  { term: 'sangre', pattern: /\bsangre\b/ },
  { term: 'sangre', pattern: /\bsangrient\w*/ }, // sangriento/a
  { term: 'cuchillo', pattern: /\bcuchill\w*/ }, // cuchillo, cuchilla, cuchillada
  // English equivalents — English titles on Spanish audio are common enough.
  { term: 'slaughter', pattern: /\bslaughter\w*/ },
  { term: 'butcher', pattern: /\bbutcher\w*/ },
  { term: 'kill', pattern: /\bkill(s|ed|ing|er|ers)?\b/ },
];

/**
 * Channels a human has reviewed and APPROVED. Purely a record for now — the
 * filter does not read this, and being absent from it means nothing.
 *
 * It exists so a verdict is not re-litigated every time someone notices a
 * channel is prolific. When channel-seeded discovery lands, this and
 * BLOCKED_CHANNELS collapse into the single CHANNEL_POLICY map keyed by
 * channelId with 'seed' | 'block' (see the README's Deferred section) — two
 * lists over the same key can contradict each other.
 */
export type VettedChannel = {
  channelId: string;
  title: string;
  /** What was checked, by whom, and when. */
  verdict: string;
};

export const VETTED_CHANNELS: readonly VettedChannel[] = [
  {
    channelId: 'UCkAPC4eUqWKoldzyaG8Xyhg',
    title: 'Romancito',
    verdict:
      'APPROVED 2026-07-21, verified manually by the project owner. 869 ' +
      'videos; Argentine creator living in Spain; on-camera presenter; ' +
      'original footage; short formats. Rioplatense accent in a peninsular ' +
      'setting, which is genuinely useful accent variety. Its clickbait-styled ' +
      'titles ("NO vayas a ALICANTE") and 12/12 emoji rate trip every surface ' +
      'heuristic we tested — it is the standing counter-example to blocking on ' +
      'title style, and the reason no such rule was ever adopted. Do not block.',
  },
];

/**
 * Dubbing / non-original-audio heuristic.
 *
 * The failure mode this exists to prevent: a video whose audio is a Spanish
 * dub of English (or Korean, or Japanese) source material. The speech is
 * studio-read, unnatural, often mistranslated, and worthless for learning
 * conversational Spanish — but its metadata looks perfectly Spanish.
 *
 * Matched against a normalised (lowercased, accent-stripped) title+description,
 * so patterns are written WITHOUT accents. Word boundaries keep 'dub' from
 * firing on 'dubitativo' and 'sub' from firing on 'subir'.
 *
 * Deliberately conservative: a false positive costs one video out of
 * thousands, a false negative poisons the feed with robotic dubbed audio.
 * Add patterns freely — each one is independent.
 */
export const DUBBING_PATTERNS: readonly RegExp[] = [
  // Explicit dubbing vocabulary.
  /\bdoblaje\b/,
  /\bdoblad[oa]s?\b/,
  /\bfandub\b/,
  /\bdub\b/,
  /\bredoblaje\b/,
  // "audio latino" / "espanol latino" are the standard tags on dubbed
  // foreign film and anime. Native LatAm creators simply do not label their
  // own speech this way.
  /\baudio (latino|espanol|castellano)\b/,
  /\bespanol latino\b/,
  /\bcastellano\b.*\bdoblad/,
  // Subtitled = the ORIGINAL audio is not Spanish.
  /\bsub(titulad[oa]s?)? (al |en )?espanol\b/,
  /\bsubtitulos en espanol\b/,
  // Translated / voiced-over derivative content.
  /\btraducid[oa]s? al espanol\b/,
  /\bversion en espanol\b/,
  /\bletra en espanol\b/,
  /\bcover en espanol\b/,
  // Auto-dub markers YouTube itself now adds to multi-language audio tracks.
  /\bpista de audio (traducida|doblada)\b/,
  /\bauto[- ]?dub\b/,
];
