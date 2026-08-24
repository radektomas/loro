import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BATCHES_DIR,
  batchFilename,
  batchProblem,
  batchSlices,
  lemmaUniverse,
  loadCatalogEntries,
  type ExplanationBatch,
} from './lib/explanations.mts';

/**
 * Validate ONE authored explanations batch, the moment it is written:
 *
 *   node scripts/check-explanation-batch.mts --batch 12
 *
 * Exit 0 and "ok" when the file passes the same checks the publisher will
 * run; exit 1 with the first problem otherwise. The full-set check (every
 * batch present) stays the publisher's job — this exists so authoring can
 * fail fast per file instead of at the end of 48 of them.
 */

const flagIndex = process.argv.indexOf('--batch');
const index = Number.parseInt(process.argv[flagIndex + 1] ?? '', 10);
const videos = loadCatalogEntries();
const slices = batchSlices(lemmaUniverse(videos));

if (flagIndex === -1 || !Number.isInteger(index) || index < 0 || index >= slices.length) {
  console.error(`--batch must be 0..${slices.length - 1}`);
  process.exit(1);
}

const file = path.join(BATCHES_DIR, batchFilename(index));
if (!existsSync(file)) {
  console.error(`✗ ${file} does not exist`);
  process.exit(1);
}

let batch: ExplanationBatch;
try {
  batch = JSON.parse(readFileSync(file, 'utf8')) as ExplanationBatch;
} catch (error) {
  console.error(`✗ ${batchFilename(index)} is not valid JSON: ${String(error)}`);
  process.exit(1);
}

const problem = batchProblem(
  batch,
  index,
  slices[index],
  new Map(videos.map((v) => [v.id, v]))
);
if (problem) {
  console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log(`ok — ${batchFilename(index)}: ${slices[index].length} lemmas valid`);
