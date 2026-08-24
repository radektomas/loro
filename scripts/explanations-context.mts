import {
  batchFilename,
  batchSlices,
  lemmaUniverse,
  loadCatalogEntries,
  type CatalogEntryLike,
} from './lib/explanations.mts';
import { normalizeSurface } from '../packages/core/src/dictionary.ts';

/**
 * READ-ONLY context printer for authoring one explanations batch.
 *
 *   node scripts/explanations-context.mts             # universe + batch table
 *   node scripts/explanations-context.mts --batch 12  # everything batch 12 needs
 *
 * For each lemma in the batch it prints, as JSON on stdout: every catalog
 * gloss for the lemma (pos, note, glosses per language — the existing
 * dictionary knowledge the explanation extends, never contradicts) and up to
 * three REAL cue candidates (videoId, cueIndex, the spoken sentence, its en
 * translation) — the pool `examples` must be drawn from, since the validator
 * rejects any cue the dictionary cannot resolve to the lemma.
 *
 * Writes nothing. The author reads this, writes
 * data/explanations/batches/batch-NNN.json, and publish-explanations.mts
 * validates the result against the same catalog this printed from.
 */

const MAX_CUE_CANDIDATES = 3;

type LemmaContext = {
  lemma: string;
  glosses: {
    surface: string;
    pos: string;
    note: string | null;
    glosses: Record<string, string>;
  }[];
  cues: {
    videoId: string;
    cueIndex: number;
    sentence: string;
    en: string | null;
  }[];
};

function contextFor(videos: readonly CatalogEntryLike[], lemma: string): LemmaContext {
  const glosses: LemmaContext['glosses'] = [];
  const seenSurfaces = new Set<string>();
  const cues: LemmaContext['cues'] = [];

  for (const video of videos) {
    const dictionary = video.dictionary ?? {};
    const surfacesHere = new Set(
      Object.entries(dictionary)
        .filter(([, gloss]) => gloss.lemma === lemma)
        .map(([surface]) => surface)
    );
    if (surfacesHere.size === 0) continue;

    for (const surface of surfacesHere) {
      if (seenSurfaces.has(surface)) continue;
      seenSurfaces.add(surface);
      const gloss = dictionary[surface];
      glosses.push({
        surface,
        pos: gloss.pos,
        note: gloss.note ?? null,
        glosses: gloss.glosses ?? {},
      });
    }

    if (cues.length >= MAX_CUE_CANDIDATES) continue;
    video.cues.forEach((cue, cueIndex) => {
      if (cues.length >= MAX_CUE_CANDIDATES) return;
      const speaks = cue.words.some((word) =>
        surfacesHere.has(normalizeSurface(word.text))
      );
      if (!speaks) return;
      cues.push({
        videoId: video.id,
        cueIndex,
        sentence: cue.words.map((w) => w.text).join(' '),
        en: cue.translations?.en ?? null,
      });
    });
  }

  return { lemma, glosses, cues };
}

function main(): void {
  const videos = loadCatalogEntries();
  const universe = lemmaUniverse(videos);
  const slices = batchSlices(universe);

  const flagIndex = process.argv.indexOf('--batch');
  if (flagIndex === -1) {
    console.log(
      JSON.stringify(
        {
          lemmas: universe.length,
          batches: slices.length,
          files: slices.map((slice, i) => ({
            file: batchFilename(i),
            first: slice[0],
            last: slice[slice.length - 1],
            count: slice.length,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const batch = Number.parseInt(process.argv[flagIndex + 1] ?? '', 10);
  if (!Number.isInteger(batch) || batch < 0 || batch >= slices.length) {
    console.error(`--batch must be 0..${slices.length - 1}`);
    process.exit(1);
  }

  const slice = slices[batch];
  console.log(
    JSON.stringify(
      {
        batch,
        file: batchFilename(batch),
        lemmas: slice.map((lemma) => contextFor(videos, lemma)),
      },
      null,
      2
    )
  );
}

main();
