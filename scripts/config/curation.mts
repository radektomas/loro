/**
 * Curation policy for what gets PUBLISHED into the feed.
 *
 * Distinct from the harvest filter (scripts/lib/candidateFilter.mts), which
 * decides what is legally and technically usable. This decides what is worth
 * watching — and specifically biases toward A HUMAN SPEAKING ON CAMERA.
 *
 * WHY THIS EXISTS. The publisher used to sort candidates by view count alone.
 * Measured on the real pool, that was a systematic bias, not a small-sample
 * impression: Gaming is 5% of all eligible candidates but 12% of the top 60
 * by views, while Travel & Events is 17% of the pool and virtually absent
 * from that top slice. Median views in the published slice was 3.1M against
 * 17.8k pool-wide. Sorting by popularity means sorting by "viral short-form
 * format", which in Spanish skews hard to gaming, kid animation and
 * meme edits — the opposite of the listening practice Loro is for.
 *
 * WHAT WE CAN AND CANNOT DETECT. There is no metadata field for "is a person
 * on camera talking" (we established this during discovery: no metadata
 * signal separates scripted voiceover from on-camera speech). So this is a
 * stack of proxies, each individually weak and jointly decent. It will let
 * some voiceover through and will wrongly drop some good videos. It is a
 * ranking aid, not a classifier — the honest fix remains human review of
 * channels, which is what CHANNEL policy in harvest-queries.mts is for.
 */

/**
 * YouTube category ids, tiered by how likely the video is a person talking.
 *
 * Reasoning, not taste: People & Blogs / Travel / News are dominated by
 * vlogs, street interviews and pieces to camera. Science & Tech and Pets &
 * Animals are dominated by narration over stock footage. Gaming and Film &
 * Animation are, by definition, not a person on camera.
 */
export const CATEGORY_TIERS: Readonly<Record<string, number>> = {
  '22': 3, // People & Blogs — vlogs, street interviews
  '19': 3, // Travel & Events
  // NOTE: News & Politics ('25') is not listed here — it is excluded
  // outright below. See EXCLUDED_CATEGORIES.
  '23': 2, // Comedy — sketches, usually performed by people
  '26': 2, // Howto & Style — often to-camera demonstration
  '27': 1, // Education — mixed: lectures to camera, but also animation
  '24': 1, // Entertainment — mixed
  '17': 1, // Sports — often match footage with commentary
  '2': 0, //  Autos
  '15': 0, // Pets & Animals — usually animal footage + voiceover
  '28': 0, // Science & Tech — usually screen recording or animation
};

/** Categories never published. */
export const EXCLUDED_CATEGORIES: readonly string[] = [
  '20', // Gaming — no person on camera
  '1', //  Film & Animation — no person on camera
  '10', // Music — no person on camera
  // News & Politics: people DO talk to camera here, so this is a product
  // decision, not a speech-detection one. Loro is not a place to argue with
  // the learner, and partisan content ages badly and travels badly across
  // the countries this feed serves. Excluded outright (owner's call,
  // 2026-07-21). POLITICS_PATTERNS below catches the same content when it
  // is filed under People & Blogs instead.
  '25',
];

/**
 * Political content, wherever it is filed. Category '25' catches the videos
 * YouTube classifies as news; this catches commentary channels that file
 * under People & Blogs — the real case that slipped through was "Cómo hay
 * que responder a los socialistas", category 22.
 *
 * Tuned to ideology and electoral politics, NOT to any mention of a country
 * or public life: a travel vlog saying "el gobierno de Perú" should survive,
 * so generic civics words are deliberately absent.
 */
export const POLITICS_PATTERNS: readonly RegExp[] = [
  /\bsocialis(mo|ta)/i,
  /\bcomunis(mo|ta)/i,
  /\bcapitalis(mo|ta)/i,
  /\bmarxis(mo|ta)/i,
  /\bfascis(mo|ta)/i,
  /\bperonis(mo|ta)/i,
  /\bkirchneris(mo|ta)/i,
  /\bchavis(mo|ta)/i,
  /\bfranquis(mo|ta)/i,
  /\bdictadura\b|\bdictador\b/i,
  /\b(izquierda|derecha) (pol[ií]tica|radical)\b/i,
  /\bultra ?(derecha|izquierda)\b/i,
  /\belecci[oó]n(es)?\b|\belectoral\b|\bcampa[nñ]a pol[ií]tica\b/i,
  /\bpol[ií]tic(a|o|os|as)\b/i,
  /\bgobierno de\b|\bpresidente\b|\bexpresidente\b/i,
  /\bdiputad|senador|parlament|congreso nacional/i,
  /\bpartido (pol[ií]tico|popular|socialista)\b/i,
  // Deliberately NO party-name list. "Podemos" is the ordinary verb "we can"
  // and "Morena" means brunette — both produced false positives live (a
  // fruit-preserve recipe and an animal-rescue appeal). Party content is
  // reached through the ideology patterns above instead, which is what
  // caught the VOX video anyway.
];

/** Score for a category we have no opinion on. */
const DEFAULT_TIER = 1;

/**
 * Kid-gaming franchises. These arrive as gameplay capture or animation with
 * a voiceover, and are the single most recognisable cluster in the pool.
 */
export const KID_GAMING_PATTERNS: readonly RegExp[] = [
  /\broblox\b/i,
  /\bminecraft\b/i,
  /\bskibidi\b/i,
  /\bfortnite\b/i,
  /\bfree ?fire\b/i,
  /\bbrawl ?stars\b/i,
  /\bamong ?us\b/i,
  /\bgacha\b/i,
  /\bfnaf\b|five nights/i,
  /\bpomni\b|digital circus/i,
  /\btoca ?boca\b/i,
  /\bgameplay\b/i,
  /\bmikecrack\b/i,
  /\bgranny\b/i,
  /\bsonic\b/i,
  /\bpvp\b|\bnoob\b|\bhacker\b/i,
  // Mobile-game cheat/currency videos. Caught live: "FC Mobile 25 MOD/Hack
  // - Cómo Obtener MONEDAS" passed every franchise pattern above.
  /\bmod\b|\bhack\b|\bapk\b|\bcheats?\b/i,
  /\bfc ?mobile\b|\bfifa\b|\bef[uú]tbol\b|\bclash\b|\bcoc\b/i,
  /\bmonedas?\b.{0,20}\b(gratis|ilimitad)/i,
  /\bskins?\b|\bv-?bucks\b|\bgemas gratis\b/i,
];

/**
 * Narrated-listicle formats. "Los 5 animales más peligrosos", "datos
 * increíbles", "sabías que" — these are near-universally a synthetic or
 * off-camera voice over stock footage. Strong pattern, few false positives,
 * and it is the cluster that survives a category-only filter.
 */
export const VOICEOVER_FORMAT_PATTERNS: readonly RegExp[] = [
  /\bsab[ií]as? que\b/i,
  /\bdatos? (incre[ií]bles?|curiosos?|que no)\b/i,
  /\bcuriosidades\b/i,
  /\btop ?\d+\b/i,
  /\blos? \d+ .{0,30}m[áa]s\b/i,
  /\bel animal m[áa]s\b/i,
  /\bexplicad[oa] en\b/i,
  /\bqu[ée] pasar[ií]a si\b/i,
];

/**
 * Minimum views to publish. A floor, deliberately NOT an ordering: it filters
 * out abandoned uploads without making virality the selection criterion.
 *
 * Lowered 20k -> 10k (2026-07-23) on measured evidence: at 20k the remaining
 * pool was 31 candidates from 15 channels; at 10k it is 65 from 38. The floor
 * was costing source diversity — its own stated purpose is to exclude
 * abandoned uploads, and 10k still does that — while concentrating the feed on
 * a handful of large channels, which BATCH_MAX_PER_CHANNEL then throttles.
 */
export const MIN_VIEWS_TO_PUBLISH = 10_000;

export type CurationVerdict = {
  /** Higher is better. Negative means never publish. */
  score: number;
  /** Why, for the publisher's log — never a bare "filtered". */
  reason: string;
};

/**
 * Rank one candidate for publication. Returns a negative score for anything
 * that must not be published, so callers can filter and explain in one pass.
 */
export function curationScore(candidate: {
  category_id?: string | null;
  title?: string | null;
  description?: string | null;
  view_count?: number | null;
}): CurationVerdict {
  const category = candidate.category_id ?? '';
  if (EXCLUDED_CATEGORIES.includes(category)) {
    return { score: -1, reason: `excluded category ${category}` };
  }

  const views = candidate.view_count ?? 0;
  if (views < MIN_VIEWS_TO_PUBLISH) {
    return { score: -1, reason: `only ${views} views` };
  }

  // Title carries the format signal; description adds hashtags like #roblox.
  const haystack = `${candidate.title ?? ''} ${candidate.description ?? ''}`;

  const gaming = KID_GAMING_PATTERNS.find((p) => p.test(haystack));
  if (gaming) {
    return { score: -1, reason: `kid/gaming pattern ${gaming.source}` };
  }

  const political = POLITICS_PATTERNS.find((p) => p.test(haystack));
  if (political) {
    return { score: -1, reason: `political pattern ${political.source}` };
  }

  const voiceover = VOICEOVER_FORMAT_PATTERNS.find((p) => p.test(haystack));
  if (voiceover) {
    return { score: -1, reason: `voiceover-listicle pattern ${voiceover.source}` };
  }

  const tier = CATEGORY_TIERS[category] ?? DEFAULT_TIER;
  return { score: tier, reason: `category ${category} tier ${tier}` };
}
