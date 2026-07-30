// Relative and extension-ed, not '@/lib/...': this module loads under plain
// node for its test, where neither the bundler alias nor extensionless
// specifiers resolve (same rule as lib/starterDeck.ts).
import type { Level, Video } from '../types/index.ts';
import { normalizeAnswer } from './srs.ts';
import { normalizeSurface } from './dictionary.ts';
import { STARTER_DECK, type StarterWord } from './starterDeck.ts';

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
};

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
 * Plan the deck: `rounds` clips, each with the words it will teach.
 *
 * Returns fewer rounds than asked (possibly none) when the catalog cannot back
 * them — the caller must handle a short plan rather than assume three.
 */
export function planStarterRounds(options: StarterPlanOptions): StarterRound[] {
  const {
    videos,
    savedIds,
    seenIds,
    rounds = STARTER_ROUNDS,
    wordsPerRound = WORDS_PER_ROUND,
    minWordsPerRound = MIN_WORDS_PER_ROUND,
    maxDurationSeconds = PREFERRED_MAX_DURATION_S,
  } = options;

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

  const plan: StarterRound[] = [];
  const used = new Set<string>();
  const takenVideos = new Set<string>();

  // Greedy, re-ranked every round: once round 1 claims "sí/gracias/es", the
  // clips that only spoke those words are no longer worth a round, so the
  // ranking has to be recomputed rather than sorted once up front.
  while (plan.length < rounds) {
    // The function-word allowance depends on WHICH round this is, so the cards
    // are chosen per round rather than sliced off a precomputed list.
    const allowance = functionAllowanceFor(plan.length + 1);
    let best: BestRound | null = null;
    for (const candidate of candidates) {
      if (takenVideos.has(candidate.video.id)) continue;
      const fresh = candidate.targets.filter((t) => !used.has(t.entry.id));
      const chosen = chooseRoundTargets(fresh, wordsPerRound, allowance);
      // Short of even the fallback within the constraints: this clip cannot
      // back THIS round (it may still back a later one, where a function word
      // is allowed).
      if (chosen.length < minWordsPerRound) continue;
      // `fresh.length` is carried separately from `chosen.length`: chosen is
      // capped at wordsPerRound, so it cannot express how much a clip still has
      // to teach — which is the tiebreak between two equally short full rounds.
      const contender: BestRound = {
        candidate,
        targets: chosen,
        freshCount: fresh.length,
        payoffEnd: payoffEndOf(
          candidate.video.cues,
          chosen,
          transcriptEndOf(candidate.video)
        ),
      };
      if (!best || better(contender, best, wordsPerRound, maxDurationSeconds)) {
        best = contender;
      }
    }
    if (!best) break;
    const targets = best.targets;
    for (const t of targets) used.add(t.entry.id);
    takenVideos.add(best.candidate.video.id);
    const video = best.candidate.video;
    plan.push({
      video,
      targets,
      cues: video.cues,
      transcriptEnd: transcriptEndOf(video),
      payoffEnd: best.payoffEnd,
    });
  }
  return plan;
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
