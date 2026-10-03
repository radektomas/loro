/**
 * THE BLUE WORDS' LEVELS — generates packages/core/src/catalog/wordBands.ts.
 *
 * Radek, 2026-10-04: "it chooses super bad hard words or numbers", and then,
 * on a table ranked by how often Loro's creators say a word: "how is gato in
 * level 6, that's like level 2 — IT NEEDS TO BE SPANISH LEVELS". Right: how
 * often a word is FILMED is not when a learner LEARNS it. "Gato" is week one
 * of every course and rarely on camera.
 *
 * SO EACH WORD CARRIES ITS CEFR LEVEL — the level at which a standard Spanish
 * course (Instituto Cervantes' Plan Curricular, the usual textbooks) teaches
 * it — and the six CEFR levels ARE the six tiers:
 *
 *   A1 Guiri · A2 Turista · B1 Se Defiende · B2 Casi Local · C1 Local · C2 Nativo
 *
 * The level comes from a model (gpt-4o, through the metered chatJson), asked
 * once per lemma and cached in data/wordLevels.json, so a re-run after new
 * videos only pays for the new words (~$0.50 for the first 4,700). It may
 * answer "X" — technical, medical, slang, regional, not standard Spanish —
 * and an X word is never asked.
 *
 * Only real vocabulary is rated: nouns, verbs, adjectives, adverbs. Never
 * grammar glue (glossary FUNCTION_WORDS), names, or number words. Keyed by the
 * gloss lemma, so every form of "poder" shares its level.
 *
 *   npm run word-bands                 (rates new words, then writes the table)
 *   npm run word-bands -- --offline    (table from the cache only, no calls)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO_ROOT } from './lib/env.mts';
import { chatJson } from './lib/glossCues.mts';
import { setBudget, spentUsd } from './lib/openaiCost.mts';
import { glossText, isProperName, lookupGloss, normalizeSurface } from '../packages/core/src/dictionary.ts';
import { isFunctionWord } from '../packages/core/src/glossary.ts';
import { numberWordBand } from '../packages/core/src/numerals.ts';
import type { Video } from '../packages/core/src/types.ts';

const OUT = path.join(REPO_ROOT, 'packages', 'core', 'src', 'catalog', 'wordBands.ts');
const CACHE = path.join(REPO_ROOT, 'data', 'wordLevels.json');
const SOURCES = ['embedVideos.json', 'collections.json'];
const CONTENT_POS = new Set(['noun', 'verb', 'adj', 'adv']);
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
const BATCH = 150;
const BUDGET_USD = 3;

const offline = process.argv.includes('--offline');

const videos: Video[] = SOURCES.flatMap((f) =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'data', f), 'utf8'))
);

/** lemma → a part of speech and an English meaning, to tell the model which word it is. */
const lemmas = new Map<string, { pos: string; en: string }>();
for (const video of videos) {
  for (const cue of video.cues) {
    for (const word of cue.words) {
      const surface = normalizeSurface(word.text);
      if (!surface || isFunctionWord(surface)) continue;
      const gloss = lookupGloss(video, word.text);
      if (!gloss) continue;
      const pos = gloss.pos.trim().toLowerCase();
      if (!CONTENT_POS.has(pos) || isProperName(word.text, gloss)) continue;
      const lemma = normalizeSurface(gloss.lemma || surface);
      if (!/^\p{L}+$/u.test(lemma) || lemma.length < 2) continue;
      if (isFunctionWord(lemma) || numberWordBand(lemma) !== null || numberWordBand(surface) !== null) continue;
      const en = glossText(gloss, 'en') ?? '';
      if (/\d/.test(en)) continue;
      if (!lemmas.has(lemma)) lemmas.set(lemma, { pos, en });
    }
  }
}

const cache: Record<string, string> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const todo = [...lemmas.keys()].filter((l) => !(l in cache)).sort();
console.log(`${videos.length} videos, ${lemmas.size} words, ${todo.length} not yet rated`);

if (todo.length > 0 && !offline) {
  loadEnv();
  setBudget(BUDGET_USD);
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const list = batch.map((l) => `${l} (${lemmas.get(l)!.pos}: ${lemmas.get(l)!.en})`).join('\n');
    const prompt =
      `You are a Spanish teacher. For each Spanish word below (lemma, part of speech, English meaning), ` +
      `give the CEFR level at which a learner normally LEARNS it in a standard Spanish course ` +
      `(Instituto Cervantes Plan Curricular, standard textbooks): A1, A2, B1, B2, C1 or C2. ` +
      `Everyday concrete words (animals, food, family, body, colours, home, city, basic verbs) are A1-A2 ` +
      `even when they are not the most frequent. Answer "X" for words a course would not teach: ` +
      `technical, medical or scientific terms, slang, vulgar words, regionalisms, English words, ` +
      `misspellings or anything that is not a standard Spanish word.\n\n` +
      `Return JSON: {"levels": {"<lemma>": "A1", ...}} with every word below.\n\n${list}`;
    const out = (await chatJson(prompt)) as { levels?: Record<string, string> };
    for (const l of batch) {
      const level = String(out.levels?.[l] ?? '').toUpperCase().trim();
      if ((LEVELS as readonly string[]).includes(level) || level === 'X') cache[l] = level;
    }
    const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(CACHE, JSON.stringify(sorted, null, 0) + '\n');
    console.log(`  rated ${Math.min(i + BATCH, todo.length)}/${todo.length}  $${spentUsd().toFixed(3)}`);
  }
}

const bands: Record<string, number> = {};
for (const lemma of [...lemmas.keys()].sort()) {
  const i = (LEVELS as readonly string[]).indexOf(cache[lemma] ?? '');
  if (i !== -1) bands[lemma] = i + 1;
}
const counts = LEVELS.map((_, i) => Object.values(bands).filter((b) => b === i + 1).length);
const unrated = [...lemmas.keys()].filter((l) => !(l in cache)).length;
writeFileSync(
  OUT,
  `/**\n * GENERATED by scripts/build-word-bands.mts — do not edit by hand. Lemma →\n * its CEFR level as a band: 1 A1 · 2 A2 · 3 B1 · 4 B2 · 5 C1 · 6 C2, the\n * same order as the tiers (Guiri … Nativo). Not listed = never a blue blank.\n */\nexport const WORD_BANDS: Readonly<Record<string, number>> = ${JSON.stringify(bands)};\n`
);
console.log(
  `table: ${Object.keys(bands).length} words; ${LEVELS.map((l, i) => `${l} ${counts[i]}`).join(' · ')}; ` +
    `X ${Object.values(cache).filter((v) => v === 'X').length}; unrated ${unrated}; spent $${spentUsd().toFixed(3)}`
);
