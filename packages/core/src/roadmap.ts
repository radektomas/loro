import type { SavedWord } from './types.ts';
import { distinctWords, isLearned } from './progress.ts';
import { KNOWN_BOX, normalizeAnswer } from './srs.ts';
import { normalizeSurface } from './dictionary.ts';

/**
 * THE WORD ROADMAP (Radek, 2026-09-26, branch words-roadmap — an idea on
 * trial, not a shipped rule).
 *
 * A heavy user had ~200 saved words, all of them competing for blanks at
 * once: "its a chaos". The roadmap lays the words out in the order they
 * were SAVED and lets only a handful be open at a time. Learning one opens
 * the next. Nothing is deleted and nothing is re-scheduled — a locked word
 * keeps its box and its dueAt exactly as they were; it is simply not ASKED
 * until the path reaches it.
 *
 * Pure functions only. The gate is enforced where the words are asked and
 * counted — srs.computeBlankPlan and progress.readyWords / dueCount /
 * nextDueAt — which all already receive the whole saved list, so no caller
 * has to remember to filter.
 */

/** How many not-yet-done words are open at once. */
export const OPEN_SLOTS = 20;

/** Words per city on the path, from the third city on. */
export const STAGE_SIZE = 10;

/**
 * THE FIRST CITIES ARE SHORT (Radek, 2026-10-03). Measured: trial users
 * saved about nine words in their week and not one reached a second city,
 * so the trip's best moment — the flight, the flag, two new local words —
 * never happened inside the trial. Madrid is 5 words and Sevilla 7, so the
 * first arrival lands in the first session and the second soon after; every
 * city after that is STAGE_SIZE. Games front-load their wins the same way.
 */
export const CITY_SIZES: readonly number[] = [5, 7];

/** How many words city `stage` holds (0 = Madrid). */
export function citySize(stage: number): number {
  return CITY_SIZES[stage] ?? STAGE_SIZE;
}

/** Where city `stage` starts on the path: the words of every city before it. */
export function cityStart(stage: number): number {
  let n = 0;
  for (let i = 0; i < stage; i++) n += citySize(i);
  return n;
}

/** The path cut into cities, each its own size. THE one place cities are cut. */
export function splitCities<T>(path: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0, s = 0; i < path.length; s++) {
    const n = citySize(s);
    out.push(path.slice(i, i + n));
    i += n;
  }
  return out;
}

export type RoadmapStatus = 'done' | 'open' | 'locked';

export type RoadmapNode = {
  /** normalizeAnswer(text) — the identity the planner practises on. */
  key: string;
  /** The most advanced entry for this surface (progress.distinctWords). */
  word: SavedWord;
  /** When the surface was FIRST saved, from any video — its place on the path. */
  savedAt: number;
  status: RoadmapStatus;
};

/**
 * DONE, for the path: the same line the Words tab's Learned face draws
 * (feed/wordLearned.onLearnedFace) — earned through review, or filed as
 * known (a starter-deck grant). A word that slipped is not done: it takes
 * an open slot again until it is earned back.
 */
export function isDoneOnPath(word: SavedWord): boolean {
  return word.state !== 'lapsed' && (isLearned(word) || word.state === 'known');
}

/** The whole path, in save order: done, then the open window, then locked. */
export function buildRoadmap(
  words: readonly SavedWord[],
  openSlots: number = OPEN_SLOTS
): RoadmapNode[] {
  const firstSaved = new Map<string, number>();
  for (const w of words) {
    const key = normalizeAnswer(w.text);
    if (!key) continue;
    const held = firstSaved.get(key);
    if (held === undefined || w.savedAt < held) firstSaved.set(key, w.savedAt);
  }
  const nodes = distinctWords(words)
    .map((word) => {
      const key = normalizeAnswer(word.text);
      return { key, word, savedAt: firstSaved.get(key) ?? word.savedAt };
    })
    .sort((a, b) => a.savedAt - b.savedAt || a.key.localeCompare(b.key));

  let open = 0;
  const marked = nodes.map((n) => {
    // A surface is done when ANY of its rows is (distinctWords keeps the
    // highest box, which is the done row whenever there is one — except a
    // lapsed higher-box row, which is exactly the word that should reopen).
    if (isDoneOnPath(n.word)) return { ...n, status: 'done' as const };
    if (open < openSlots) {
      open++;
      return { ...n, status: 'open' as const };
    }
    return { ...n, status: 'locked' as const };
  });
  /**
   * LEARNED TOGETHER, THEN WHAT IS NEXT (Radek, 2026-09-26: "learned should
   * be together and the openings one are after them"). The open window is
   * chosen in SAVE order above; the path is then DRAWN done-first — in the
   * order they were learned — then the open words, then the waiting ones,
   * each of those in save order. So the road behind you is all learned and
   * the road ahead is the words in the order you met them.
   */
  const rank = { done: 0, open: 1, locked: 2 } as const;
  const doneAt = (n: RoadmapNode) => n.word.learnedAt ?? n.word.lastReviewedAt ?? n.savedAt;
  return marked.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.status === 'done' ? doneAt(a) - doneAt(b) : 0) ||
      a.savedAt - b.savedAt ||
      a.key.localeCompare(b.key)
  );
}

/**
 * BLUE WORDS ON THE TRIP (Radek, 2026-09-30: a user saving two words a week
 * "sits in Madrid for a month"). A blue level blank typed right is a word
 * the user just produced cold, so it fills the city they are in as a
 * learned stop, drawn blue so it reads as "you knew this", not "you trained
 * this". Stored by storage.saveLevelWord (loro.levelKnownWords, local).
 *
 * PATH ONLY, on purpose. srs.ts LEVEL_FILL_BOX records why: when blue fills
 * counted as learned, 43 of one user's 58 "learned" words were typed once
 * and "de" topped the list — "the hero number was counting keystrokes". So
 * these never enter the saved list, the ladder (learnedTotal) or the feed's
 * schedule, and the bare glue ("de", "la" — TRIP_GLUE) never fills a city.
 */
export type LevelKnownWord = {
  text: string;
  translation: string;
  videoId: string;
  cueIndex: number;
  /** When it was typed right — its place among the learned stops. */
  at: number;
};

/**
 * THE GLUE THAT NEVER FILLS A CITY — articles, pronouns, prepositions,
 * conjunctions and the unavoidable ser/estar/haber/ir forms. Deliberately
 * NARROWER than glossary's FUNCTION_WORDS (Radek, 2026-09-30: typed "todo"
 * right and it "appeared nowhere"): that list is "what the glossary shows
 * as already known" and carries real vocabulary — todo, mucho, siempre,
 * nunca, ahora, también, aquí, dónde — which a learner does earn. Keys are
 * normalizeSurface() forms (lowercase, accents kept).
 */
const TRIP_GLUE = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'al', 'del',
  'mi', 'mis', 'tu', 'tus', 'su', 'sus',
  'yo', 'tú', 'él', 'ella', 'ellos', 'ellas', 'usted', 'ustedes',
  'nosotros', 'nosotras', 'vosotros', 'vosotras',
  'me', 'te', 'se', 'nos', 'os', 'le', 'les',
  'y', 'e', 'o', 'u', 'ni', 'que', 'pero', 'si',
  'a', 'de', 'en', 'con', 'por', 'para',
  'no', 'sí',
  'es', 'son', 'soy', 'eres', 'somos', 'era', 'eran', 'fue',
  'está', 'están', 'estás', 'estoy', 'estamos',
  'hay', 'he', 'has', 'ha', 'han', 'va', 'van', 'voy', 'vas',
]);

/** A blue word worth a stop on the trip: anything but the bare glue. */
export function countsOnTrip(text: string): boolean {
  const key = normalizeAnswer(text);
  return key !== '' && !TRIP_GLUE.has(normalizeSurface(text));
}

/**
 * The list the PATH is drawn from: the saved words plus a learned stand-in
 * for each blue word not already saved (a saved word keeps its own row, its
 * own schedule). `blue` names the stand-ins. They are all done, so they
 * never take an open slot — the open and locked words are exactly what
 * buildRoadmap(words) alone gives, which is what the feed gates on.
 */
export function withLevelKnown(
  words: readonly SavedWord[],
  levelWords: readonly LevelKnownWord[]
): { words: SavedWord[]; blue: Set<string> } {
  const saved = new Set(words.map((w) => normalizeAnswer(w.text)));
  const blue = new Set<string>();
  const extra: SavedWord[] = [];
  for (const l of levelWords) {
    const key = normalizeAnswer(l.text);
    if (!countsOnTrip(l.text) || saved.has(key) || blue.has(key)) continue;
    blue.add(key);
    extra.push({
      text: l.text,
      translation: l.translation,
      videoId: l.videoId,
      cueIndex: l.cueIndex,
      source: 'user',
      savedAt: l.at,
      state: 'known',
      box: KNOWN_BOX,
      dueAt: Number.MAX_SAFE_INTEGER,
      correct: 1,
      incorrect: 0,
      lastReviewedAt: l.at,
      learnedAt: l.at,
    });
  }
  return { words: [...words, ...extra], blue };
}

/** The next word on the path: the first open one, where "You're here" sits. */
export function nextUp(words: readonly SavedWord[]): RoadmapNode | null {
  return buildRoadmap(words).find((n) => n.status === 'open') ?? null;
}

/**
 * The surfaces the path has not reached yet. Cached per list identity —
 * the blank planner calls this on every slide with the same array.
 */
const lockedCache = new WeakMap<readonly SavedWord[], Set<string>>();

export function lockedKeys(words: readonly SavedWord[]): Set<string> {
  const hit = lockedCache.get(words);
  if (hit) return hit;
  const keys = new Set<string>();
  for (const n of buildRoadmap(words)) if (n.status === 'locked') keys.add(n.key);
  lockedCache.set(words, keys);
  return keys;
}

/** Is this word still waiting on the path? */
export function isLocked(word: SavedWord, words: readonly SavedWord[]): boolean {
  const key = normalizeAnswer(word.text);
  return key !== '' && lockedKeys(words).has(key);
}

/**
 * What changed between two lists: the surfaces that were locked before and
 * are open now. The learned moment reads this to say which word it opened.
 */
export function newlyOpened(
  before: readonly SavedWord[],
  after: readonly SavedWord[]
): RoadmapNode[] {
  const was = lockedKeys(before);
  return buildRoadmap(after).filter((n) => n.status === 'open' && was.has(n.key));
}

/**
 * THE TRIP (Radek, 2026-09-30: stages named "any other way than stage 1-20",
 * then "make it like a little map"). Each stage (citySize words) is a
 * city on a route through the Spanish-speaking world — Spain first, then
 * across to the Americas. Past the end the route starts again, numbered
 * ("Madrid · round 2"), so a heavy saver never runs out of map.
 */
export const TRIP: readonly { city: string; country: string }[] = [
  { city: 'Madrid', country: 'España' },
  { city: 'Sevilla', country: 'España' },
  { city: 'Barcelona', country: 'España' },
  { city: 'Valencia', country: 'España' },
  { city: 'Granada', country: 'España' },
  { city: 'Ciudad de México', country: 'México' },
  { city: 'Oaxaca', country: 'México' },
  { city: 'Guadalajara', country: 'México' },
  { city: 'Cancún', country: 'México' },
  { city: 'La Habana', country: 'Cuba' },
  { city: 'San Juan', country: 'Puerto Rico' },
  { city: 'Santo Domingo', country: 'República Dominicana' },
  { city: 'Ciudad de Guatemala', country: 'Guatemala' },
  { city: 'San José', country: 'Costa Rica' },
  { city: 'Panamá', country: 'Panamá' },
  { city: 'Bogotá', country: 'Colombia' },
  { city: 'Medellín', country: 'Colombia' },
  { city: 'Cartagena', country: 'Colombia' },
  { city: 'Quito', country: 'Ecuador' },
  { city: 'Lima', country: 'Perú' },
  { city: 'Cusco', country: 'Perú' },
  { city: 'La Paz', country: 'Bolivia' },
  { city: 'Santiago', country: 'Chile' },
  { city: 'Valparaíso', country: 'Chile' },
  { city: 'Mendoza', country: 'Argentina' },
  { city: 'Córdoba', country: 'Argentina' },
  { city: 'Buenos Aires', country: 'Argentina' },
  { city: 'Montevideo', country: 'Uruguay' },
  { city: 'Asunción', country: 'Paraguay' },
  { city: 'Caracas', country: 'Venezuela' },
];

/** The stop for stage `index` (0-based): its city, country and round. */
export function tripStop(index: number): { city: string; country: string; round: number; label: string } {
  const i = Math.max(0, Math.floor(index));
  const stop = TRIP[i % TRIP.length];
  const round = Math.floor(i / TRIP.length) + 1;
  return { ...stop, round, label: round > 1 ? `${stop.city} · round ${round}` : stop.city };
}

/**
 * WHERE THE TRIP IS — the city you are in, what is learned there and how
 * many countries you have reached. The Words path draws this and Progress
 * names it (Radek, 2026-09-30: a trip row instead of "ready to review"),
 * so the rule lives here once: the first city with a word still to train;
 * with every word learned, a FULL last city means you have arrived in the
 * next one (empty, waiting for words), a part-filled one means you are
 * still in it. Pass the path's own list — withLevelKnown's, blue stops
 * included — so both tabs count the same stops.
 */
export function tripPosition(words: readonly SavedWord[]): {
  stage: number;
  learnedHere: number;
  /** Words this city holds (citySize) — 5 in Madrid, 7 in Sevilla, then 10. */
  size: number;
  countries: number;
} {
  const path = buildRoadmap(words);
  const stages = splitCities(path);
  const firstOpen = stages.findIndex((nodes) => nodes.some((n) => n.status !== 'done'));
  const stage =
    firstOpen >= 0
      ? firstOpen
      : stages.length === 0
        ? 0
        : stages[stages.length - 1].length >= citySize(stages.length - 1)
          ? stages.length
          : stages.length - 1;
  const learnedHere = (stages[stage] ?? []).filter((n) => n.status === 'done').length;
  const seen = new Set<string>();
  for (let i = 0; i <= Math.min(stage, TRIP.length - 1); i++) seen.add(TRIP[i].country);
  return { stage, learnedHere, size: citySize(stage), countries: seen.size };
}

/**
 * WHEN EACH CITY WAS REACHED, for Progress's passport (Radek, 2026-10-02:
 * "make the progress page as nice as we did the words page"). Nothing
 * stores an arrival, and nothing needs to: the path is drawn done-first in
 * the order words were learned, so city s opened the moment its previous
 * city's last word did. City 0 is the first save. Index = stage, up to and
 * including the one you are in; null where there is no date to give (no
 * words yet). Same list rule as tripPosition: pass withLevelKnown's.
 */
export function cityArrivals(words: readonly SavedWord[]): (number | null)[] {
  const path = buildRoadmap(words);
  const { stage } = tripPosition(words);
  const doneAt = (n: RoadmapNode) => n.word.learnedAt ?? n.word.lastReviewedAt ?? n.savedAt;
  const out: (number | null)[] = [];
  for (let s = 0; s <= stage; s++) {
    if (s === 0) out.push(path.length ? Math.min(...path.map((n) => n.savedAt)) : null);
    else {
      const last = path[cityStart(s) - 1];
      out.push(last && last.status === 'done' ? doneAt(last) : null);
    }
  }
  return out;
}
