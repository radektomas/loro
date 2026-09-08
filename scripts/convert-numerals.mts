#!/usr/bin/env node
/**
 * Loro — spell out the digits in the shipped catalog: "100" → "cien",
 * "1936" → "mil novecientos treinta y seis".
 *
 *   node scripts/convert-numerals.mts            # dry run: report only
 *   node scripts/convert-numerals.mts --write    # rewrite the two data files
 *
 * WHY A MIGRATION AND NOT A RE-HARVEST. Captions are fetched at publish time
 * and never kept, and re-fetching 174 videos is a walk into the bot wall
 * (see loro-youtube-embed-path). The cues are plain text with timings, so
 * the conversion the ingest now does (scripts/lib/json3ToCues.mts →
 * core/numerals.ts expandNumeralTokens) is applied here to what is already
 * on disk, once. Idempotent: a second run finds nothing to convert.
 *
 * WHAT CHANGES. Cue words only, plus the dictionary: each new number word
 * gets an entry glossed with its DIGITS in every language the video carries
 * ("treinta" → "30"), so a blank prompts with the number and the learner
 * types the word; the few non-number words a numeral can produce ("coma",
 * "dólares", "euros", "ciento"'s partner "por") get real glosses. Digit
 * keys that no cue uses any more are dropped. Cue translations keep their
 * digits — "28. I'm 20 years older" is how English writes it.
 *
 * VERIFIED BEFORE WRITING: no convertible token left, every cue's words
 * still in time order inside the cue's span, every new word glossed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  expandNumeralTokens,
  numberWordValue,
  numeralToWords,
} from '../packages/core/src/numerals.ts';
import { normalizeSurface } from '../packages/core/src/dictionary.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILES = ['data/videos.json', 'data/embedVideos.json'];
const WRITE = process.argv.includes('--write');

type Word = { text: string; start: number; end: number };
type Cue = { start: number; end: number; words: Word[]; translations: Record<string, string> };
type Gloss = { lemma: string; pos: string; note: string | null; glosses: Record<string, string> };
type Video = { id: string; cues: Cue[]; dictionary?: Record<string, Gloss> };

/** Glosses for the non-number words a numeral can produce. */
const WORD_GLOSSES: Record<string, Record<string, string>> = {
  coma: { en: 'point (decimal)', cs: 'celá', de: 'Komma', fr: 'virgule' },
  dólar: { en: 'dollar', cs: 'dolar', de: 'Dollar', fr: 'dollar' },
  dólares: { en: 'dollars', cs: 'dolary', de: 'Dollar', fr: 'dollars' },
  euro: { en: 'euro', cs: 'euro', de: 'Euro', fr: 'euro' },
  euros: { en: 'euros', cs: 'eura', de: 'Euro', fr: 'euros' },
  por: { en: 'per / by', cs: 'za', de: 'pro', fr: 'pour' },
  y: { en: 'and', cs: 'a', de: 'und', fr: 'et' },
};

function glossFor(word: string, languages: string[]): Gloss | null {
  const key = normalizeSurface(word);
  const value = numberWordValue(key);
  if (value !== null) {
    const glosses: Record<string, string> = {};
    for (const lang of languages) glosses[lang] = String(value);
    return { lemma: key, pos: 'num', note: 'number', glosses };
  }
  const known = WORD_GLOSSES[key];
  if (!known) return null;
  const glosses: Record<string, string> = {};
  for (const lang of languages) glosses[lang] = known[lang] ?? known.en;
  return { lemma: key, pos: key === 'y' || key === 'por' ? 'conj' : 'noun', note: null, glosses };
}

let totalTokens = 0;
let totalCues = 0;
let totalVideos = 0;
let totalEntries = 0;
let totalDropped = 0;
const samples: string[] = [];
const leftover = new Map<string, number>();
const problems: string[] = [];

for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  const videos: Video[] = JSON.parse(readFileSync(file, 'utf8'));
  let fileTokens = 0;
  for (const video of videos) {
    const languages = Object.keys(video.cues[0]?.translations ?? { en: '' });
    if (!languages.includes('en')) languages.unshift('en');
    let videoTokens = 0;
    const dict = video.dictionary ?? {};
    const usedKeys = new Set<string>();

    for (const cue of video.cues) {
      const before = cue.words;
      const after = expandNumeralTokens(before);
      const changed = after.length !== before.length || after.some((w, i) => w.text !== before[i].text);
      if (changed) {
        const converted = before.filter((w, i) => numeralToWords(w.text, before[i + 1]?.text) !== null);
        videoTokens += converted.length;
        totalCues++;
        if (samples.length < 12) {
          samples.push(
            `${video.id}: ${before.map((w) => w.text).join(' ')}\n      → ${after.map((w) => w.text).join(' ')}`
          );
        }
        // Dictionary entries for every NEW word — the ones expansion made,
        // not the cue's other tokens (UGC cues carry multi-word tokens that
        // never had entries, and that is not this script's problem).
        const had = new Set(before.map((w) => normalizeSurface(w.text)));
        for (const w of after) {
          const key = normalizeSurface(w.text);
          if (!key || had.has(key) || dict[key]) continue;
          const gloss = glossFor(w.text, languages);
          if (!gloss) {
            problems.push(`${video.id}: no gloss for "${w.text}"`);
            continue;
          }
          dict[key] = gloss;
          totalEntries++;
        }
        cue.words = after;
      }
      // Verify: order and span.
      for (let i = 0; i < cue.words.length; i++) {
        const w = cue.words[i];
        if (w.end < w.start || (i > 0 && w.start < cue.words[i - 1].start)) {
          problems.push(`${video.id}: word order broken at "${w.text}"`);
        }
        if (/\d/.test(w.text)) {
          if (numeralToWords(w.text, cue.words[i + 1]?.text) !== null) {
            problems.push(`${video.id}: convertible token left: "${w.text}"`);
          }
          leftover.set(w.text, (leftover.get(w.text) ?? 0) + 1);
        }
        usedKeys.add(normalizeSurface(w.text));
      }
    }
    // Drop digit keys no cue uses any more.
    for (const key of Object.keys(dict)) {
      if (/\d/.test(key) && !usedKeys.has(key)) {
        delete dict[key];
        totalDropped++;
      }
    }
    if (videoTokens > 0) {
      totalVideos++;
      fileTokens += videoTokens;
      if (Object.keys(dict).length > 0) video.dictionary = dict;
    }
  }
  totalTokens += fileTokens;
  console.log(`${rel}: ${fileTokens} token(s) converted`);
  if (WRITE && fileTokens > 0) {
    writeFileSync(file, JSON.stringify(videos, null, 2) + '\n');
    console.log(`  written`);
  }
}

console.log(`\n${totalTokens} tokens in ${totalCues} cues across ${totalVideos} videos; ` +
  `${totalEntries} dictionary entries added, ${totalDropped} digit keys dropped`);
console.log('\nSamples:\n  ' + samples.join('\n  '));
console.log('\nLeft as digits: ' + [...leftover.entries()].map(([k, n]) => `${k}×${n}`).join('  '));
if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):\n  ` + problems.slice(0, 20).join('\n  '));
  process.exit(1);
}
if (!WRITE) console.log('\nDry run — pass --write to rewrite the files.');
