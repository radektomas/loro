#!/usr/bin/env node
/**
 * Loro — write the audited English blank hints (data/blankHints.json) into the
 * catalog's per-video dictionaries.
 *
 *   node scripts/apply-blank-hints.mts             # dry run: report only
 *   node scripts/apply-blank-hints.mts --apply     # rewrite the data files
 *
 * WHY. The blue (level) blank shows glosses.en as its prompt, and the old
 * per-video gloss was written "as used in these sentences" — so one word got
 * many different, sometimes wrong, hints ("sería" = "is" in one video). The
 * audit gave every blankable surface ONE checked hint; this makes the
 * dictionaries say it.
 *
 * DATA ONLY — NO APP BUILD NEEDED. Two edits per dictionary entry:
 *   - a blankable word gets glosses.en = the audited hint;
 *   - a never-blank word (lives only inside a fixed phrase: "o sea",
 *     "por favor") gets pos = 'phrase', which isLevelBlankable already
 *     rejects (JUNK_POS), so every installed build stops blanking it.
 * lemma is deliberately NOT touched: the band table is keyed by lemma, and a
 * corrected lemma would silently move words between levels.
 * Other languages (cs/de/fr) are not audited and are left as they were.
 *
 * Idempotent. Run `npm run publish-catalog` afterwards; devices pick the new
 * snapshot up on their next 24h refresh.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/env.mts';
import { isLevelBlankable } from '../packages/core/src/levels.ts';
import { lookupGloss, normalizeSurface } from '../packages/core/src/dictionary.ts';

type Hint = { hint: string; blankable: boolean };
type Entry = { pos: string; glosses: Record<string, string> };
type V = { id: string; cues: { words: { text: string }[] }[]; dictionary: Record<string, Entry> };

const apply = process.argv.includes('--apply');
const hints = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data', 'blankHints.json'), 'utf8')) as Record<string, Hint>;
const FILES = ['videos.json', 'embedVideos.json', 'collections.json'];

const blankCount = (v: V): number => {
  const seen = new Set<string>();
  for (const c of v.cues) {
    for (const w of c.words) {
      const k = normalizeSurface(w.text);
      if (!seen.has(k) && isLevelBlankable(w.text, lookupGloss(v as never, w.text), 1)) seen.add(k);
    }
  }
  return seen.size;
};

const changes: { word: string; from: string; to: string; n: number }[] = [];
const tally = new Map<string, { word: string; from: Map<string, number>; to: string }>();
let hintsSet = 0;
let phrased = 0;
const lost: string[] = [];
let fewer = 0;

for (const file of FILES) {
  const p = path.join(REPO_ROOT, 'data', file);
  const videos = JSON.parse(readFileSync(p, 'utf8')) as V[];
  for (const v of videos) {
    const before = blankCount(v);
    for (const [key, gloss] of Object.entries(v.dictionary ?? {})) {
      const h = hints[key];
      if (!h) continue;
      if (h.blankable) {
        const old = (gloss.glosses.en ?? '').trim();
        if (old !== h.hint) {
          const t = tally.get(key) ?? { word: key, from: new Map(), to: h.hint };
          t.from.set(old, (t.from.get(old) ?? 0) + 1);
          tally.set(key, t);
          gloss.glosses.en = h.hint;
          hintsSet++;
        }
      } else if (gloss.pos !== 'phrase') {
        gloss.pos = 'phrase';
        phrased++;
      }
    }
    const after = blankCount(v);
    if (after < before) fewer++;
    if (before > 0 && after === 0) lost.push(`${file}:${v.id}`);
  }
  if (apply) writeFileSync(p, `${JSON.stringify(videos, null, 2)}\n`);
}

for (const t of tally.values()) {
  const n = [...t.from.values()].reduce((a, b) => a + b, 0);
  const top = [...t.from].sort((a, b) => b[1] - a[1])[0];
  changes.push({ word: t.word, from: top[0], to: t.to, n });
}
changes.sort((a, b) => b.n - a.n);
console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${hintsSet} hints rewritten, ${phrased} entries marked pos=phrase`);
console.log(`videos with fewer level-blank candidates after: ${fewer}; videos left with ZERO: ${lost.length}`);
if (lost.length) console.log('  zero:', lost.slice(0, 20).join(', '));
console.log('biggest rewrites (word: most common old -> new, entries):');
for (const c of changes.slice(0, 30)) console.log(`  ${c.word}: "${c.from}" -> "${c.to}" (${c.n})`);
if (!apply) console.log('\nRe-run with --apply to write the files.');
