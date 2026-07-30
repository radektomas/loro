// Relative and extension-ed, not '@/lib/...': this module loads under plain
// node for its test, where neither the bundler alias nor extensionless
// specifiers resolve (same rule as lib/starterDeck.ts).
import type { Level, Video } from '../types/index.ts';
import { normalizeAnswer } from './srs.ts';
import { normalizeSurface } from './dictionary.ts';
import { STARTER_DECK, type StarterWord } from './starterDeck.ts';
import {
  classifyStarterTopic,
  STARTER_TOPIC_PREFERENCE,
  type StarterTopic,
} from './starterTopics.ts';

// Re-exported so consumers of the planner (the deck, the curation browser)
// need one import path for everything curation-related; the classification
// rules themselves live in lib/starterTopics.ts.
export { STARTER_TOPIC_PREFERENCE, type StarterTopic };

/**
 * Round planning for the starter deck — CLIP FIRST, words second.
 *
 * The deck is short interleaved rounds: a handful of word cards, then a real
 * clip in which those exact words are spoken and highlighted. That payoff only
 * works if the words come OUT of the clip, so the selection is inverted from
 * the obvious order: pick the clips first, then read the target words off
 * their transcripts. A word is never shown on a card unless this planner
 * proved it is spoken in that round's clip.
 *
 * Pure and deterministic — no Date, no Math.random, no storage. The page hands
 * in the catalog and the user's saved/watched sets and renders what comes back;
 * the test pins the rules.
 *
 * WHY FREQUENCY ALONE IS NOT THE RULE. The first version ranked targets purely
 * by deck frequency, and measured against the real catalog it handed round 3
 * the words "y / en / para" — pure glue, one of them audible for 0.1s. Both
 * halves of that are payoff failures: a preposition popping in a subtitle
 * teaches nothing a beginner can feel, and a 100ms word cannot register at all.
 * So a target now has to clear two gates before frequency is consulted:
 *
 *   - AUDIBLE FOR AT LEAST MIN_TARGET_AUDIBLE_S. Not the 0.05s "was it spoken"
 *     floor the blank planners use — that question is different from "can a
 *     learner notice it light up".
 *   - CONTENT WORDS CARRY THE ROUND. At most one function word per round, and
 *     round 1 is content-only: it is the first payoff and it sets the
 *     expectation for the whole deck.
 *
 * Frequency still orders everything inside those constraints, and a round that
 * cannot satisfy them drops to two cards rather than admitting a glue round —
 * the same fallback that already covers a lexically thin clip.
 *
 * WHY ACCENT-EXACT MATCHING (the subtle constraint). Saved-word identity is
 * normalizeAnswer(), which folds accents away — that is right for grading
 * ("¡Están!" == "estan") and it is what dedupes against the user's saved set.
 * It is WRONG for choosing a target: under normalizeAnswer, the spoken article
 * "el" matches the deck's "él" (he), "tu" matches "tú" (you), "esta" matches
 * "está" (is), and so on down the accent pairs the deck documents. Carding
 * "él — he" over a clip that says the article "el" breaks the one promise this
 * whole screen makes. So a candidate word must equal the deck word under
 * normalizeSurface() (lowercase, accents KEPT) to be a target, while its
 * normalizeAnswer() identity is what the saved/used sets are keyed on.
 */

/** Rounds in one run of the deck, and cards per round. */
export const STARTER_ROUNDS = 3;
export const WORDS_PER_ROUND = 3;
/**
 * A round may fall back to this many cards rather than borrow a word the
 * round's clip does not speak. At A1 the catalog is thin (10 clips), so a
 * two-word round is a real outcome, not a theoretical one — and it is still
 * far better than a third card whose word never arrives in the video.
 */
export const MIN_WORDS_PER_ROUND = 2;
/**
 * Preferred ROUND length — how long the user actually sits through, which since
 * the payoff-end change is `payoffEnd`, not the clip's duration.
 *
 * A preference in the ranking, never a hard filter: dropping a round for want
 * of a short clip would cost more than the seconds it saves.
 */
export const PREFERRED_MAX_DURATION_S = 30;

/**
 * How long a round holds after its last target word finishes being spoken.
 *
 * The round ends here rather than at the end of the transcript, because the
 * payoff is the target lighting up as it is said — not finishing the video. A
 * beat of tail keeps the last highlight from being cut off mid-breath; anything
 * beyond that is a beginner watching content they were not promised, which is
 * exactly the momentum the short rounds exist to protect.
 */
export const PAYOFF_TAIL_S = 1.5;

/**
 * A target must be audible for at least this long in the clip.
 *
 * Deliberately far above the 0.05s "was this word spoken at all" floor used by
 * the blank planners (lib/srs.ts): this is the stricter question of whether a
 * beginner can register the word lighting up as it is said. Measured on the
 * catalog, function words routinely come in at 0.08-0.16s — audible in
 * principle, invisible as a payoff.
 */
export const MIN_TARGET_AUDIBLE_S = 0.2;

/** Function words allowed per round — one, so content always carries a round. */
export const MAX_FUNCTION_WORDS_PER_ROUND = 1;

/**
 * HAND-CURATED CLIP ORDER — the editorial layer over the ranking below.
 *
 * These three clips are the first thing 100% of from-zero users ever see, and
 * they are the same three for everyone. The ranking can only measure what is in
 * the data — word coverage, frequency, how soon the payoff lands — and none of
 * that is clip QUALITY: whether the speech is clear, whether the framing is
 * pleasant, whether a stranger's first thirty seconds of Spanish is somewhere
 * they want to be. That is a judgement made by watching, so it belongs in a
 * list, not in a heuristic.
 *
 * Ordered: entry 0 is round 1, entry 1 is round 2, and so on. Browse and audit
 * candidates at /dev/starter-clips (dev only), which shows each clip's round
 * preview, its target words with their audible spans, and whether it is in this
 * list.
 *
 * Empty by default, which means the ranking alone decides — exactly the
 * behaviour before this list existed. An entry that cannot satisfy the round
 * constraints is SKIPPED, never forced: the deck is a beginner's first minute
 * and a curated pick does not get to make it a glue round or a 40-second one.
 * Anything the list cannot fill falls back to the ranking, so a stale or
 * mistyped id degrades to the old behaviour instead of breaking the deck.
 * describeStarterPlan() reports which rounds came from where; the deck logs it
 * in development.
 *
 * CURATED 2026-07-30, refined 2026-07-30, by topic first and reading full
 * transcripts rather than trusting lib/starterTopics.ts's keyword scores alone
 * (see its module doc for why: on this catalog "travel" scored mostly false
 * positives — motorcycle maintenance, a religious monologue, a gym tutorial —
 * and one otherwise qualifying dailyLife clip turned out to be a personal
 * HIV-diagnosis disclosure, which no keyword list would ever catch). Topic
 * preference order is travel > dailyLife > food > culture; 'tech' is never
 * eligible — it is the exact failure this list exists to fix (the ranking's
 * own round-3 pick was a Microsoft/Android settings walkthrough).
 *
 * LEVEL IS SECONDARY TO TOPIC, AND WEIGHTED PER ROUND. Within whichever topic
 * wins a round, the lowest available level is preferred — most strongly for
 * round 1, since it is the beginner's first impression; rounds 2-3 may trade
 * level for a better content fit more freely. Concretely: round 1 already sits
 * at travel's floor (A2 — the catalog has NO A1 travel or dailyLife content at
 * all, confirmed with starterCandidates() filtered to level === 'A1'), so
 * nothing to trade there. Round 3 sits at food's floor (A1) with no trade
 * needed either. Round 2 is the one real trade: every daily-life clip AT ITS
 * lowest available level (B1) that clears every constraint is either the same
 * body/exercise register as the clip it replaced or a dry wage-statistics
 * recitation — B2 is where the first clip that actually reads differently
 * shows up. One level was spent there on purpose; see round 2 below.
 *
 *   1. 3FosEuFdIjk — travel, A2 (topic floor, no lower level exists) — a
 *      practical "what you need to know before visiting Machu Picchu" guide
 *      (season, transport, packing, tickets).
 *   2. a3sudA_IXgY — dailyLife, B2 (traded up one level from B1 — see below) —
 *      a cost-of-living breakdown for expats in Dubai: food, transport,
 *      housing and phone/internet, month by month.
 *   3. lmyYWJvq4wQ — food, A1 (topic floor, no lower level exists) — a home
 *      cook shows off a pot of ribs cooked in green sauce, pleased with how
 *      well-seasoned they turned out.
 *
 * ROUND 2 WAS RECONSIDERED 2026-07-30: the original pick (GUqE8AeIaUQ, home
 * remedies for muscle cramps) satisfied every constraint but read oddly as the
 * app's second impression — clinical/body-symptom content right after a travel
 * guide. Checked every dailyLife AND food clip that could fill the slot
 * (starterCandidates() filtered to round1Ready, either topic): the B1
 * dailyLife floor offers only more of the same register (RAndbXOYYOM, another
 * gym/body-part exercise clip) or dry statistics (two wage-comparison videos,
 * one running a 5.3s round); the strongest food alternative under the cap
 * (Sse8Gm9OzQk, A2, a couple trying unusual breakfast foods) would have made
 * rounds 2 AND 3 both food, trading away the topic variety travel/dailyLife/
 * food gives the deck.
 *
 * The first candidate that actually read as a different kind of moment —
 * personal, practical, non-medical — was guIID3CEwuM (a story about building
 * credit as a newcomer to a country). It was dropped for an unrelated reason
 * found while checking it in: that id is ALSO lib/playerContext.tsx's
 * PRIME_VIDEO_ID, the hidden clip the shared player loads once, muted, to
 * capture the iOS autoplay blessing before the deck's first real round. Tracing
 * the swap logic, reusing it here would not actually misbehave (the priming
 * path only applies while nothing has been requested yet, which round 2 never
 * sees) — but that file itself marks its blessing-preservation assumption
 * UNVERIFIED pending physical-device testing, and stacking an unrelated,
 * coincidental id collision on top of an already-fragile, already-flagged
 * mechanism was not a trade worth making for one clip. a3sudA_IXgY was the
 * next-best fit with no such entanglement (grepped clean against lib/, app/,
 * components/) — drier delivery than guIID3CEwuM, but still a clean break from
 * both the original pick's register and the tech-tutorial failure this whole
 * list exists to fix.
 *
 * Level is still not a constraint the allowlist path enforces (see
 * planStarterDeck) — it is only ever a preference applied by hand while
 * choosing entries. Re-derive this list with /dev/starter-clips if the catalog
 * grows enough for an A1 travel or dailyLife clip to exist, or for a dailyLife
 * clip that both reads well AND sits at B1 or lower.
 */
export const STARTER_CLIP_ALLOWLIST: readonly string[] = [
  '3FosEuFdIjk',
  'a3sudA_IXgY',
  'lmyYWJvq4wQ',
];

/** A word a round teaches: the deck entry plus its rank (the frequency key). */
export type StarterTarget = {
  entry: StarterWord;
  /** Index in STARTER_DECK — frequency order, and the SRS stagger/cue key. */
  deckIndex: number;
  /** Is this a content word (noun, verb, adjective, adverb, interjection)?
      See FUNCTION_WORD_IDS for the classification and its one judgement call. */
  content: boolean;
};

export type StarterRound = {
  /** The clip that speaks every one of `targets`. */
  video: Video;
  /** MIN_WORDS_PER_ROUND..WORDS_PER_ROUND targets, most frequent first. */
  targets: StarterTarget[];
  /** The clip's cues — the same array as `video.cues`, carried here so the
      round is everything the clip stage needs without reaching back into the
      catalog. */
  cues: Video['cues'];
  /**
   * When the clip stops SAYING anything, in seconds.
   *
   * The end of the last cue that has words, which is not the same as the
   * video's duration: captions routinely stop seconds before a clip does
   * (outro music, a held final shot).
   */
  transcriptEnd: number;
  /**
   * When the ROUND ends, in seconds: PAYOFF_TAIL_S after the last target word
   * finishes being spoken, capped at transcriptEnd.
   *
   * This, not transcriptEnd, is what the clip stage runs to. A round's job is
   * done once every word on its cards has lit up as it was said; whatever the
   * clip does after that is content the user was never promised. Measured on
   * the catalog it is also the only number that makes a long clip affordable —
   * a 57s video whose three targets land by 0:12 is a 13s round.
   */
  payoffEnd: number;
  /** Where this round came from: a hand-curated entry in
      STARTER_CLIP_ALLOWLIST, or the ranking. */
  source: StarterRoundSource;
};

export type StarterRoundSource = 'allowlist' | 'ranking';

export type StarterPlanOptions = {
  /** The catalog to draw from (localVideos, or a subset). */
  videos: readonly Video[];
  /** normalizeAnswer identities the user already has saved, from ANY video —
      a word met before must never be taught again as new. */
  savedIds: ReadonlySet<string>;
  /** Video ids already watched. Avoided, but never a hard exclusion: a
      repeated clip beats a missing round. */
  seenIds?: ReadonlySet<string>;
  rounds?: number;
  wordsPerRound?: number;
  minWordsPerRound?: number;
  maxDurationSeconds?: number;
  /** Curated clip ids, in round order. Defaults to STARTER_CLIP_ALLOWLIST;
      overridable so the test can pin the rules without editing the shipped
      list. */
  allowlist?: readonly string[];
};

/**
 * One line of the plan's provenance: which clip filled a round and why, and
 * every curated entry that was passed over, with the reason.
 *
 * Data rather than a log call, because the planner stays pure — the deck prints
 * these in development and /dev/starter-clips renders them.
 */
export type StarterPlanNote = {
  /** 1-based round the note concerns; 0 for a note about the plan itself. */
  round: number;
  videoId: string | null;
  outcome: 'allowlist' | 'ranking' | 'skipped';
  /** Human-readable, and the only place a skipped curated pick is explained. */
  reason: string;
};

export type StarterPlanResult = {
  rounds: StarterRound[];
  notes: StarterPlanNote[];
};

/** Accent-exact deck lookup: normalizeSurface(word) -> deck rank. */
const deckIndexBySurface = new Map<string, number>(
  STARTER_DECK.map((w, i) => [normalizeSurface(w.word), i])
);

/** Level ordering — the deck starts at the lowest level the catalog has. */
const LEVEL_ORDER: readonly Level[] = ['A1', 'A2', 'B1', 'B2'];

/**
 * The deck's function words, by normalizeAnswer identity: personal pronouns,
 * conjunctions, prepositions, interrogatives, demonstratives and indefinite
 * pronouns. Everything else in STARTER_DECK is a content word.
 *
 * Classified BY HAND against the fixed 87-word deck rather than read from the
 * per-video dictionary's `pos`, because that field is ASR-derived and
 * inconsistent in the shipped data (both 'adv' and 'adverb' appear, plus
 * 'other', and some clips gloss a word with the sense it carries in one
 * sentence only). The deck is curated and finite, so classifying it once here
 * is both exact and reviewable — and the test asserts every id below is really
 * in the deck, so a reordered or renamed entry cannot leave a stale rule.
 *
 * ONE JUDGEMENT CALL: the greetings (hola, gracias, adiós) are interjections,
 * not one of the four categories the brief named — but they are the most
 * meaningful, most teachable words a beginner meets, so they count as content.
 * Classifying them as glue would have barred "gracias" from round 1, which is
 * plainly the wrong outcome for the screen this rule exists to improve.
 */
const FUNCTION_WORD_IDS: ReadonlySet<string> = new Set([
  // personal pronouns
  'yo', 'tu', 'el', 'ella', 'nosotros',
  // conjunctions
  'y', 'o', 'pero', 'porque', 'aunque',
  // prepositions
  'de', 'en', 'a', 'con', 'para', 'por', 'sin',
  // interrogatives
  'que', 'como', 'donde', 'quien', 'cuando',
  // demonstrative and indefinite pronouns
  'esto', 'eso', 'todo', 'nada', 'algo',
]);

/** Is this deck word a content word? Exported for the test's coverage check. */
export function isContentWord(id: string): boolean {
  return !FUNCTION_WORD_IDS.has(id);
}

/** The deck's function words, for the test that pins the classification. */
export function functionWordIds(): ReadonlySet<string> {
  return FUNCTION_WORD_IDS;
}

/**
 * How many function words a round may spend. Round 1 gets none: it is the
 * first payoff the user ever sees and it sets the expectation for the deck.
 */
export function functionAllowanceFor(roundNumber: number): number {
  return roundNumber <= 1 ? 0 : MAX_FUNCTION_WORDS_PER_ROUND;
}

/**
 * Choose a round's cards from its clip's eligible words.
 *
 * `eligible` must already be frequency-ordered. Words are taken in that order —
 * frequency still decides — with function words admitted only while the
 * allowance holds. Returns fewer than `wordsPerRound` when the clip cannot fill
 * a round within the constraints; the caller decides whether that is enough.
 *
 * Greedy is exact here, not an approximation: the only cap is on the function
 * class, so taking words in rank order while that cap holds always reaches
 * min(wordsPerRound, content + min(functionWords, allowance)) — the maximum any
 * selection could.
 */
export function chooseRoundTargets(
  eligible: readonly StarterTarget[],
  wordsPerRound: number,
  functionAllowance: number
): StarterTarget[] {
  const chosen: StarterTarget[] = [];
  let functionsUsed = 0;
  for (const target of eligible) {
    if (chosen.length >= wordsPerRound) break;
    if (!target.content) {
      if (functionsUsed >= functionAllowance) continue;
      functionsUsed += 1;
    }
    chosen.push(target);
  }
  return chosen;
}

/** A clip in the running for the round being planned. */
type BestRound = {
  candidate: Candidate;
  /** The cards it would actually deal, within this round's constraints. */
  targets: StarterTarget[];
  /** How many unclaimed words the clip still has — uncapped, so it can rank
      richness even though only `wordsPerRound` cards are dealt. */
  freshCount: number;
  /** Seconds the user would actually watch for THIS round — see payoffEnd. */
  payoffEnd: number;
};

type Candidate = {
  video: Video;
  levelRank: number;
  seen: boolean;
  duration: number;
  /** Every deck word this clip speaks, most frequent first, already minus the
      user's saved set. Filtered again per round against words other rounds
      claimed. */
  targets: StarterTarget[];
};

/**
 * Deck words spoken in `video`, most frequent first. Deduped by normalized
 * identity: a word repeated across cues is one card (and every occurrence of
 * it lights up when the clip plays).
 */
function targetsIn(video: Video, exclude: ReadonlySet<string>): StarterTarget[] {
  const found = new Map<string, StarterTarget>();
  for (const cue of video.cues) {
    for (const word of cue.words) {
      // The payoff floor, not the "was it spoken" floor — see
      // MIN_TARGET_AUDIBLE_S. A word whose only occurrences are shorter than
      // this is not a candidate at all, however frequent it is.
      if (word.end - word.start < MIN_TARGET_AUDIBLE_S) continue;
      const deckIndex = deckIndexBySurface.get(normalizeSurface(word.text));
      if (deckIndex === undefined) continue;
      const entry = STARTER_DECK[deckIndex];
      if (exclude.has(entry.id) || found.has(entry.id)) continue;
      found.set(entry.id, {
        entry,
        deckIndex,
        content: isContentWord(entry.id),
      });
    }
  }
  return [...found.values()].sort((a, b) => a.deckIndex - b.deckIndex);
}

/**
 * Every clip that could back a starter round at all, with its deck words.
 *
 * Shared by the planner and by /dev/starter-clips, so the browser can never
 * show a clip the planner would refuse (or hide one it would accept).
 */
function buildCandidates(
  videos: readonly Video[],
  savedIds: ReadonlySet<string>,
  seenIds: ReadonlySet<string> | undefined,
  minWordsPerRound: number
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const video of videos) {
    // Embeds only. Not an arbitrary restriction: the deck drives ONE
    // persistent YouTube player instance across all its rounds (that is what
    // buys the iOS autoplay blessing before the first clip), and a hosted
    // <video> clip would need a second, differently-blessed media path for no
    // gain — the seed clips are all A2, so they would never win the
    // lowest-level filter below anyway.
    if (!video.youtubeId) continue;
    if (video.cues.length === 0) continue;
    const targets = targetsIn(video, savedIds);
    if (targets.length < minWordsPerRound) continue;
    const levelRank = LEVEL_ORDER.indexOf(video.level);
    candidates.push({
      video,
      // An unknown level sorts last rather than as A1 — a beginner must not be
      // handed ungraded content by an indexOf(-1).
      levelRank: levelRank < 0 ? LEVEL_ORDER.length : levelRank,
      seen: seenIds?.has(video.id) ?? false,
      // Unknown duration sorts as "long": it cannot be promised as short.
      duration: video.durationSeconds ?? Number.POSITIVE_INFINITY,
      targets,
    });
  }
  return candidates;
}

/**
 * Price a clip as THIS round: the cards it would deal under this round's
 * function-word allowance, how much it would still have left to teach, and how
 * long the round would run.
 */
function priceRound(
  candidate: Candidate,
  used: ReadonlySet<string>,
  wordsPerRound: number,
  functionAllowance: number
): BestRound {
  const fresh = candidate.targets.filter((t) => !used.has(t.entry.id));
  const chosen = chooseRoundTargets(fresh, wordsPerRound, functionAllowance);
  return {
    candidate,
    targets: chosen,
    // `fresh.length` is carried separately from `chosen.length`: chosen is
    // capped at wordsPerRound, so it cannot express how much a clip still has
    // to teach — which is the tiebreak between two equally short full rounds.
    freshCount: fresh.length,
    payoffEnd: payoffEndOf(
      candidate.video.cues,
      chosen,
      transcriptEndOf(candidate.video)
    ),
  };
}

/** Why an allowlisted id never even became a candidate — the curator needs the
    actual reason, not a silent omission. */
function ineligibilityReason(
  id: string,
  videos: readonly Video[],
  savedIds: ReadonlySet<string>,
  minWordsPerRound: number
): string {
  const video = videos.find((v) => v.id === id);
  if (!video) return 'not in the catalog';
  if (!video.youtubeId) return 'not a YouTube embed';
  if (video.cues.length === 0) return 'no transcript';
  const usable = targetsIn(video, savedIds).length;
  return `only ${usable} deck word(s) are unsaved and audible for ${MIN_TARGET_AUDIBLE_S}s (needs ${minWordsPerRound})`;
}

/**
 * Plan the deck: `rounds` clips, each with the words it will teach, and a note
 * for every round explaining where it came from.
 *
 * Two passes per round, in this order:
 *
 *  1. THE CURATED LIST, in its own order. Every constraint still applies — the
 *     audible floor, the function-word allowance, round 1 content-only — plus
 *     one that is ONLY a gate here: the round must come in under
 *     maxDurationSeconds. In the ranking that length is a preference (see
 *     `better`), deliberately, because refusing to deal a round at all is worse
 *     than dealing a long one. A curated pick has no such excuse: the list is
 *     admission by hand, and if a hand-picked clip cannot be short it should be
 *     re-picked, not silently stretch a beginner's first minute. Every skip is
 *     reported with its reason.
 *  2. THE RANKING, over the whole catalog, exactly as before — for the rounds
 *     the list did not fill. So an empty, short, or stale list always still
 *     produces a deck.
 *
 * Returns fewer rounds than asked (possibly none) when the catalog cannot back
 * them — the caller must handle a short plan rather than assume three.
 */
export function planStarterDeck(options: StarterPlanOptions): StarterPlanResult {
  const {
    videos,
    savedIds,
    seenIds,
    rounds = STARTER_ROUNDS,
    wordsPerRound = WORDS_PER_ROUND,
    minWordsPerRound = MIN_WORDS_PER_ROUND,
    maxDurationSeconds = PREFERRED_MAX_DURATION_S,
    allowlist = STARTER_CLIP_ALLOWLIST,
  } = options;

  const candidates = buildCandidates(videos, savedIds, seenIds, minWordsPerRound);
  const byId = new Map(candidates.map((c) => [c.video.id, c]));

  const plan: StarterRound[] = [];
  const notes: StarterPlanNote[] = [];
  // One note per (clip, outcome, reason): a curated clip skipped for the same
  // reason in all three rounds is one fact, not three lines of noise. A
  // DIFFERENT reason in a later round (round 1 is content-only, rounds 2-3 are
  // not) is a different fact and does get its own line.
  const seenNotes = new Set<string>();
  const note = (entry: StarterPlanNote): void => {
    const key = `${entry.videoId ?? '-'}|${entry.outcome}|${entry.reason}`;
    if (seenNotes.has(key)) return;
    seenNotes.add(key);
    notes.push(entry);
  };

  const used = new Set<string>();
  const takenVideos = new Set<string>();

  // Greedy, re-ranked every round: once round 1 claims "sí/gracias/es", the
  // clips that only spoke those words are no longer worth a round, so the
  // ranking has to be recomputed rather than sorted once up front.
  while (plan.length < rounds) {
    const roundNumber = plan.length + 1;
    // The function-word allowance depends on WHICH round this is, so the cards
    // are chosen per round rather than sliced off a precomputed list.
    const allowance = functionAllowanceFor(roundNumber);

    // ---- pass 1: the curated list, in order
    let picked: BestRound | null = null;
    let source: StarterRoundSource = 'ranking';
    for (const [position, id] of allowlist.entries()) {
      if (takenVideos.has(id)) continue;
      const candidate = byId.get(id);
      if (!candidate) {
        note({
          round: roundNumber,
          videoId: id,
          outcome: 'skipped',
          reason: ineligibilityReason(id, videos, savedIds, minWordsPerRound),
        });
        continue;
      }
      const priced = priceRound(candidate, used, wordsPerRound, allowance);
      if (priced.targets.length < minWordsPerRound) {
        note({
          round: roundNumber,
          videoId: id,
          outcome: 'skipped',
          reason:
            allowance === 0
              ? `round ${roundNumber} is content-only and it can deal ${priced.targets.length} such card(s)`
              : `only ${priced.targets.length} unclaimed word(s) clear the round's constraints`,
        });
        continue;
      }
      if (priced.payoffEnd > maxDurationSeconds) {
        note({
          round: roundNumber,
          videoId: id,
          outcome: 'skipped',
          reason: `round would run ${priced.payoffEnd.toFixed(1)}s, over the ${maxDurationSeconds}s limit`,
        });
        continue;
      }
      picked = priced;
      source = 'allowlist';
      note({
        round: roundNumber,
        videoId: id,
        outcome: 'allowlist',
        reason: `curated entry ${position + 1}`,
      });
      break;
    }

    // ---- pass 2: the ranking, untouched
    if (!picked) {
      let best: BestRound | null = null;
      for (const candidate of candidates) {
        if (takenVideos.has(candidate.video.id)) continue;
        const contender = priceRound(candidate, used, wordsPerRound, allowance);
        // Short of even the fallback within the constraints: this clip cannot
        // back THIS round (it may still back a later one, where a function word
        // is allowed).
        if (contender.targets.length < minWordsPerRound) continue;
        if (!best || better(contender, best, wordsPerRound, maxDurationSeconds)) {
          best = contender;
        }
      }
      if (best) {
        picked = best;
        note({
          round: roundNumber,
          videoId: best.candidate.video.id,
          outcome: 'ranking',
          reason:
            allowlist.length === 0
              ? 'ranked pick (no curated list)'
              : 'ranked pick — no curated entry could fill this round',
        });
      }
    }

    if (!picked) {
      note({
        round: roundNumber,
        videoId: null,
        outcome: 'skipped',
        reason: 'nothing in the catalog can back this round',
      });
      break;
    }

    const targets = picked.targets;
    for (const t of targets) used.add(t.entry.id);
    takenVideos.add(picked.candidate.video.id);
    const video = picked.candidate.video;
    plan.push({
      video,
      targets,
      cues: video.cues,
      transcriptEnd: transcriptEndOf(video),
      payoffEnd: picked.payoffEnd,
      source,
    });
  }
  return { rounds: plan, notes };
}

/**
 * The rounds alone — what every consumer except the dev report wants.
 * Unchanged in behaviour and signature; the provenance rides along on each
 * round's `source`.
 */
export function planStarterRounds(options: StarterPlanOptions): StarterRound[] {
  return planStarterDeck(options).rounds;
}

/**
 * The plan's provenance as printable lines: which clip filled each round, where
 * it came from, and every curated entry that was passed over, with the reason.
 *
 * Pure, so the deck can print it in development (see the deck's plan effect)
 * and /dev/starter-clips can render the same text.
 */
export function describeStarterPlan(result: StarterPlanResult): string[] {
  const lines: string[] = [];
  result.rounds.forEach((round, i) => {
    const words = round.targets
      .map((t) => `${t.entry.word}${t.content ? '' : '*'}`)
      .join(' · ');
    lines.push(
      `round ${i + 1}  ${round.source.padEnd(9)} ${round.video.id} ` +
        `[${round.video.level}] ${round.payoffEnd.toFixed(1)}s  ${words}`
    );
  });
  for (const n of result.notes) {
    if (n.outcome !== 'skipped') continue;
    lines.push(
      `  skipped ${n.videoId ?? '(no clip)'} for round ${n.round}: ${n.reason}`
    );
  }
  if (lines.length === 0) lines.push('no rounds — nothing left to teach');
  lines.push('(* = function word)');
  return lines;
}

/**
 * When the round ends — see StarterRound.payoffEnd.
 *
 * Keyed on the FIRST audible occurrence of each target, which is the same
 * occurrence the clip stage ticks as "heard", so the round cannot end before
 * every card it dealt has been delivered. Falls back to the transcript end if
 * no occurrence resolves at all: a round that somehow cannot locate its own
 * words must play out rather than cut instantly to the beat.
 */
export function payoffEndOf(
  cues: Video['cues'],
  targets: readonly StarterTarget[],
  transcriptEnd: number
): number {
  let last = 0;
  for (const occurrence of occurrencesIn(cues, targets).values()) {
    if (occurrence.end > last) last = occurrence.end;
  }
  if (last <= 0) return transcriptEnd;
  return Math.min(last + PAYOFF_TAIL_S, transcriptEnd);
}

/** End of the last cue that actually has words — see StarterRound.transcriptEnd. */
function transcriptEndOf(video: Video): number {
  let end = 0;
  for (const cue of video.cues) {
    for (const word of cue.words) {
      if (word.end > end) end = word.end;
    }
    if (cue.end > end && cue.words.length > 0) end = cue.end;
  }
  return end;
}

/**
 * Is `candidate` (with `fresh` unclaimed words) a better round than `best`?
 *
 * Priority, highest first:
 *  1. LOWEST LEVEL. "Lowest available difficulty" is the whole point for a
 *     from-zero user; the deck only spills into the next level when the
 *     lowest one runs out of usable clips.
 *  2. UNSEEN. Re-teaching over a clip they already watched wastes the payoff.
 *  3. A FULL ROUND. Three cards beat two; a clip that can only fill two is a
 *     fallback, not a peer.
 *  4. SHORT ENOUGH — measured as the ROUND's length (payoffEnd), not the
 *     clip's. Attention is still the scarce resource, but since the round ends
 *     PAYOFF_TAIL_S after its last target word, a clip's duration is no longer
 *     what the user spends: ranking on duration here rejected a 57s clip that
 *     is a 13s round, and accepted a 25s clip that runs to 0:24. This is what
 *     "the clip-length preference matters much less" means in practice — it
 *     still applies, to the right number.
 *  5. MOST STILL TO TEACH, then SHORTEST ROUND, then id. Note this compares
 *     `freshCount` — everything the clip could still teach — not the cards
 *     dealt, which are capped at wordsPerRound and so cannot tell a 3-word clip
 *     from a 7-word one. Preferring the richer clip is what puts "sí / gracias /
 *     es" in round 1 instead of whichever equally-short clip happens to be two
 *     seconds shorter. The id makes the whole plan deterministic, which is what
 *     lets the test pin it and a resumed run behave like an uninterrupted one.
 */
function better(
  contender: BestRound,
  best: BestRound,
  wordsPerRound: number,
  maxDurationSeconds: number
): boolean {
  const a = contender.candidate;
  const b = best.candidate;
  if (a.levelRank !== b.levelRank) return a.levelRank < b.levelRank;
  if (a.seen !== b.seen) return !a.seen;

  const aFull = contender.targets.length >= wordsPerRound;
  const bFull = best.targets.length >= wordsPerRound;
  if (aFull !== bFull) return aFull;

  const aShort = contender.payoffEnd <= maxDurationSeconds;
  const bShort = best.payoffEnd <= maxDurationSeconds;
  if (aShort !== bShort) return aShort;

  if (contender.freshCount !== best.freshCount) {
    return contender.freshCount > best.freshCount;
  }
  if (contender.payoffEnd !== best.payoffEnd) {
    return contender.payoffEnd < best.payoffEnd;
  }
  return a.video.id < b.video.id;
}

/** A clip priced as one round: the cards, where they are said, how long it runs. */
export type StarterCandidateRound = {
  targets: StarterTarget[];
  /** First audible occurrence of each target — the spans a curator reads to
      see whether a word is really hearable. */
  occurrences: Map<string, TargetOccurrence>;
  /** Round length: what the user sits through, and the preview's end point. */
  payoffEnd: number;
};

/**
 * One clip as a curation candidate — everything /dev/starter-clips needs to
 * judge it without re-deriving any of the planner's rules.
 *
 * PRICED TWICE, because a clip is not one offer. Round 1 admits no function
 * word and rounds 2-3 admit one, so the same clip can deal three cards later in
 * the deck and only two at the top of it. A single figure would have understated
 * every clip whose third-best word is glue — and the allowlist is ORDERED, so a
 * curator choosing entry 1 and entry 3 is asking two different questions.
 */
export type StarterCandidate = {
  video: Video;
  /** As ROUND 1 would deal it: content words only. */
  asRound1: StarterCandidateRound;
  /** As rounds 2-3 would deal it: one function word allowed. */
  asLaterRound: StarterCandidateRound;
  /** Can it back round 1 at all? The content-only rule, as a verdict. */
  round1Ready: boolean;
  /** What the clip is actually ABOUT, read off its own vocabulary (see
      lib/starterTopics.ts) — not derivable from level, duration or target
      words, which is why curating without it means reading every transcript
      by hand. */
  topic: StarterTopic;
  transcriptEnd: number;
  /** Everything it could still teach, uncapped — the ranking's richness key. */
  freshCount: number;
  /** Whole-video duration, or null when the catalog does not know it. */
  durationSeconds: number | null;
};

/**
 * Every clip eligible for a starter round, in the ranking's own order.
 *
 * Priced for ROUND 1 (content words only) wherever a clip can fill one, because
 * round 1 is the pick that matters most and this list exists to be read top
 * down. A clip that cannot fill a content-only round is priced with the
 * ordinary allowance instead, and sorts below the full round-1 candidates on
 * the "full round" key — which is the honest position for it.
 *
 * Ranking-only: `rounds` and `allowlist` in the options are ignored, and
 * nothing here consults the curated list. It is the raw material the curated
 * list is chosen FROM.
 */
export function starterCandidates(options: StarterPlanOptions): StarterCandidate[] {
  const {
    videos,
    savedIds,
    seenIds,
    wordsPerRound = WORDS_PER_ROUND,
    minWordsPerRound = MIN_WORDS_PER_ROUND,
    maxDurationSeconds = PREFERRED_MAX_DURATION_S,
  } = options;

  const nothingClaimed: ReadonlySet<string> = new Set();
  const priced = buildCandidates(
    videos,
    savedIds,
    seenIds,
    minWordsPerRound
  ).map((candidate) => {
    const round1 = priceRound(candidate, nothingClaimed, wordsPerRound, 0);
    const later = priceRound(
      candidate,
      nothingClaimed,
      wordsPerRound,
      MAX_FUNCTION_WORDS_PER_ROUND
    );
    const round1Ready = round1.targets.length >= minWordsPerRound;
    // Ranked at the price of the round it could open, so the list reads top-down
    // as the planner's own round-1 preference. A clip that cannot open the deck
    // is ranked as the later round it CAN fill, and lands below the full round-1
    // candidates on the "full round" key — the honest position for it.
    return { candidate, ranked: round1Ready ? round1 : later, round1, later, round1Ready };
  })
    // Eligible means it can really back a round: a clip whose only unsaved deck
    // words are glue clears buildCandidates (it HAS words) but cannot deal the
    // two-card fallback under any allowance, so the planner would never take it.
    // Showing it as a candidate would invite curating a clip the deck refuses.
    .filter(({ later }) => later.targets.length >= minWordsPerRound);

  // `better` is a strict total order (its last key is the video id), so using
  // it in both directions is a valid comparator.
  priced.sort((a, b) => {
    if (better(a.ranked, b.ranked, wordsPerRound, maxDurationSeconds)) return -1;
    if (better(b.ranked, a.ranked, wordsPerRound, maxDurationSeconds)) return 1;
    return 0;
  });

  const asRound = (
    candidate: Candidate,
    round: BestRound
  ): StarterCandidateRound => ({
    targets: round.targets,
    occurrences: occurrencesIn(candidate.video.cues, round.targets),
    payoffEnd: round.payoffEnd,
  });

  return priced.map(({ candidate, round1, later, round1Ready }) => ({
    video: candidate.video,
    asRound1: asRound(candidate, round1),
    asLaterRound: asRound(candidate, later),
    round1Ready,
    topic: classifyStarterTopic(candidate.video),
    transcriptEnd: transcriptEndOf(candidate.video),
    freshCount: later.freshCount,
    durationSeconds: candidate.video.durationSeconds ?? null,
  }));
}

/** Normalized identities a round teaches — the highlight set for the clip. */
export function roundTargetIds(round: StarterRound): Set<string> {
  return new Set(round.targets.map((t) => t.entry.id));
}

/** Total cards in a plan, for the SRS-seeded count the exit can claim. */
export function plannedCardCount(plan: readonly StarterRound[]): number {
  return plan.reduce((n, round) => n + round.targets.length, 0);
}

/** normalizeAnswer identity of a spoken word — exported so the highlight
    overlay keys on exactly what the planner keyed on. */
export function spokenId(text: string): string {
  return normalizeAnswer(text);
}

/** Where in the clip a target word is actually said. */
export type TargetOccurrence = {
  /** Cue holding the first audible occurrence. Becomes SavedWord.cueIndex, so
      /vocab's replay link lands on the line where the user heard the word. */
  cueIndex: number;
  /** Audible span of that occurrence, seconds. */
  start: number;
  end: number;
};

/**
 * First audible occurrence of every target in the round, by deck identity.
 *
 * The planner proves a target is spoken; this is WHERE. Two callers need it and
 * both would otherwise re-derive it: the clip stage ticks a word as heard once
 * the playhead passes `end`, and the card save records `cueIndex`.
 *
 * Matched accent-exactly (normalizeSurface), the same rule that chose the
 * target — matching through normalizeAnswer here could resolve "él" to an
 * earlier spoken article "el" and time the highlight to the wrong word.
 */
export function targetOccurrences(
  round: StarterRound
): Map<string, TargetOccurrence> {
  return occurrencesIn(round.video.cues, round.targets);
}

/**
 * The same lookup, over cues and targets directly.
 *
 * Separate from targetOccurrences because the RANKING needs it: pricing a
 * contender means knowing where its words land, and that has to be answerable
 * before a StarterRound exists to ask about.
 */
function occurrencesIn(
  cues: Video['cues'],
  targets: readonly StarterTarget[]
): Map<string, TargetOccurrence> {
  const wanted = new Map<string, string>(); // surface -> deck identity
  for (const target of targets) {
    wanted.set(normalizeSurface(target.entry.word), target.entry.id);
  }
  const found = new Map<string, TargetOccurrence>();
  cues.forEach((cue, cueIndex) => {
    for (const word of cue.words) {
      // The SAME floor the planner used. Any looser and this could time the
      // highlight to a 0.1s mumble of a word the planner picked for its clear
      // 0.6s utterance later in the clip.
      if (word.end - word.start < MIN_TARGET_AUDIBLE_S) continue;
      const id = wanted.get(normalizeSurface(word.text));
      if (!id || found.has(id)) continue;
      found.set(id, { cueIndex, start: word.start, end: word.end });
    }
  });
  return found;
}
