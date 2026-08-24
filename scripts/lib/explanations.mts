import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeSurface } from '../../packages/core/src/dictionary.ts';
import {
  EXPLANATION_LANGS,
  REGISTERS,
  type WordExplanation,
} from '../../packages/core/src/explanations.ts';
import { REPO_ROOT } from './env.mts';

/**
 * The word-explanations batch pipeline — shapes, the lemma universe, and the
 * validator. See core/explanations.ts for the published blob's contract; this
 * module owns everything about how the content is AUTHORED and CHECKED before
 * publish-explanations.mts ever touches the bucket.
 *
 * THE CONTENT IS WRITTEN BY THE ASSISTANT, NOT AN API SCRIPT. Batches land in
 * data/explanations/batches/batch-NNN.json, one commit-reviewable file per
 * ~100 lemmas; a batch is valid only if its entries cover exactly its slice
 * of the universe, so resume = file presence and a bad batch is redone by
 * deleting one file. explanations-context.mts prints the catalog context
 * (glosses, real cue candidates) the author reads before writing a batch.
 *
 * VALIDATE EVERYTHING BEFORE PUBLISHING ANYTHING — the catalog publisher's
 * rule, for the same reason: a blob with holes in it renders as sheets that
 * mysteriously lack sections, and nothing downstream can tell that from a
 * word that simply has no explanation.
 */

export const EXPLANATION_BATCH_SIZE = 100;
export const BATCHES_DIR = path.join(REPO_ROOT, 'data', 'explanations', 'batches');

export type ExplanationBatch = {
  schemaVersion: 1;
  batch: number;
  /** The exact universe slice this batch is responsible for. */
  lemmas: string[];
  entries: Record<string, WordExplanation>;
};

/** The minimum of the catalog entries this module reads. Structural, so the
    raw data/*.json entries satisfy it without going through catalog.mts. */
export type CatalogEntryLike = {
  id: string;
  cues: { words: { text: string }[]; translations?: Record<string, string> }[];
  dictionary?: Record<
    string,
    {
      lemma: string;
      pos: string;
      note?: string | null;
      glosses?: Record<string, string>;
    }
  >;
};

/** Both source files, in the order the catalog publishes them. */
export function loadCatalogEntries(): CatalogEntryLike[] {
  const read = (file: string) =>
    JSON.parse(readFileSync(path.join(REPO_ROOT, 'data', file), 'utf8')) as
      CatalogEntryLike[];
  return [...read('videos.json'), ...read('embedVideos.json')];
}

/**
 * THE LEMMA UNIVERSE: every distinct Gloss.lemma across every dictionary,
 * sorted. Deterministic — same repo state, same universe, same slices — which
 * is what makes "batch 12" a stable name across machines and sessions.
 */
export function lemmaUniverse(videos: readonly CatalogEntryLike[]): string[] {
  const lemmas = new Set<string>();
  for (const video of videos) {
    for (const gloss of Object.values(video.dictionary ?? {})) {
      if (gloss.lemma) lemmas.add(gloss.lemma);
    }
  }
  return [...lemmas].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function batchSlices(universe: readonly string[]): string[][] {
  const slices: string[][] = [];
  for (let i = 0; i < universe.length; i += EXPLANATION_BATCH_SIZE) {
    slices.push(universe.slice(i, i + EXPLANATION_BATCH_SIZE));
  }
  return slices;
}

export function batchFilename(index: number): string {
  return `batch-${String(index).padStart(3, '0')}.json`;
}

/** Does this cue audibly-speak a word that the video's dictionary resolves to
    `lemma`? The check behind every example reference. */
function cueSpeaksLemma(
  video: CatalogEntryLike,
  cueIndex: number,
  lemma: string
): boolean {
  const cue = video.cues[cueIndex];
  if (!cue) return false;
  return cue.words.some(
    (word) => video.dictionary?.[normalizeSurface(word.text)]?.lemma === lemma
  );
}

/**
 * The single validity question, publisher-style (scripts/lib/catalog.mts
 * findProblem): the first problem found, or null. `batches` is indexed by
 * batch number; a missing batch is reported by number so the author knows
 * which file to write next.
 */
export function findProblem(
  batches: ReadonlyMap<number, ExplanationBatch>,
  videos: readonly CatalogEntryLike[]
): string | null {
  const slices = batchSlices(lemmaUniverse(videos));
  const videosById = new Map(videos.map((v) => [v.id, v]));

  for (let i = 0; i < slices.length; i++) {
    const batch = batches.get(i);
    if (!batch) return `batch ${i} is missing (${batchFilename(i)})`;
    const problem = batchProblem(batch, i, slices[i], videosById);
    if (problem) return problem;
  }
  return null;
}

/**
 * Validate ONE batch against its universe slice — the per-file half of
 * findProblem, exported so an author can check a batch the moment it is
 * written instead of only when the full set exists
 * (check-explanation-batch.mts).
 */
export function batchProblem(
  batch: ExplanationBatch,
  i: number,
  slice: readonly string[],
  videosById: ReadonlyMap<string, CatalogEntryLike>
): string | null {
  if (batch.schemaVersion !== 1) {
    return `batch ${i}: unknown schemaVersion ${String(batch.schemaVersion)}`;
  }
  if (batch.batch !== i) {
    return `batch ${i}: file says batch=${batch.batch}`;
  }
  if (
    batch.lemmas.length !== slice.length ||
    batch.lemmas.some((lemma, j) => lemma !== slice[j])
  ) {
    return `batch ${i}: lemma slice does not match the universe — the catalog changed under it; regenerate this batch`;
  }

  const keys = Object.keys(batch.entries);
  if (keys.length !== slice.length) {
    return `batch ${i}: ${keys.length} entries for ${slice.length} lemmas`;
  }

  for (const lemma of slice) {
    const entry = batch.entries[lemma];
    if (!entry) return `batch ${i}: no entry for "${lemma}"`;
    if (entry.lemma !== lemma) {
      return `batch ${i} "${lemma}": entry.lemma is "${entry.lemma}"`;
    }
    if (typeof entry.pos !== 'string' || entry.pos.trim() === '') {
      return `batch ${i} "${lemma}": empty pos`;
    }
    for (const lang of EXPLANATION_LANGS) {
      const usage = entry.usage?.[lang];
      if (typeof usage !== 'string' || usage.trim() === '') {
        return `batch ${i} "${lemma}": usage.${lang} is missing or empty`;
      }
    }
    if (entry.grammar !== null) {
      for (const lang of EXPLANATION_LANGS) {
        const grammar = entry.grammar?.[lang];
        if (typeof grammar !== 'string' || grammar.trim() === '') {
          return `batch ${i} "${lemma}": grammar.${lang} is missing or empty (grammar must be null or complete)`;
        }
      }
    }
    if (
      entry.register !== null &&
      !REGISTERS.includes(entry.register as (typeof REGISTERS)[number])
    ) {
      return `batch ${i} "${lemma}": register "${String(entry.register)}" is not recognised`;
    }
    if (
      !Array.isArray(entry.examples) ||
      entry.examples.length < 1 ||
      entry.examples.length > 3
    ) {
      return `batch ${i} "${lemma}": needs 1-3 examples`;
    }
    for (const example of entry.examples) {
      const video = videosById.get(example.videoId);
      if (!video) {
        return `batch ${i} "${lemma}": example names unknown video "${example.videoId}"`;
      }
      if (
        !Number.isInteger(example.cueIndex) ||
        example.cueIndex < 0 ||
        example.cueIndex >= video.cues.length
      ) {
        return `batch ${i} "${lemma}": example cueIndex ${example.cueIndex} out of range for "${example.videoId}"`;
      }
      if (!cueSpeaksLemma(video, example.cueIndex, lemma)) {
        return `batch ${i} "${lemma}": cue ${example.cueIndex} of "${example.videoId}" does not speak this lemma`;
      }
    }
  }
  return null;
}

/** The published record: every batch merged, keys sorted. Only meaningful
    after findProblem() returned null. */
export function mergeBatches(
  batches: ReadonlyMap<number, ExplanationBatch>
): Record<string, WordExplanation> {
  const merged: Record<string, WordExplanation> = {};
  const indices = [...batches.keys()].sort((a, b) => a - b);
  for (const index of indices) {
    const batch = batches.get(index)!;
    for (const lemma of Object.keys(batch.entries).sort()) {
      merged[lemma] = batch.entries[lemma];
    }
  }
  return merged;
}
