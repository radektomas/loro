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
  | 'technology';

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
    pages: 1,
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
];

/** Lookup set derived from the list above — the filter uses this. */
export const BLOCKED_CHANNEL_IDS: ReadonlySet<string> = new Set(
  BLOCKED_CHANNELS.map((channel) => channel.channelId)
);

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
