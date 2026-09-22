#!/usr/bin/env node
/**
 * Ingest whole EPISODES into a collection shelf — Peppa, Masha, Bluey, the
 * novelas when they come — from explicit YouTube ids.
 *
 *   npm run ingest-episodes -- --collection peppa --ids a,b,c [--budget-usd 1] [--dry-run]
 *
 * WHY NOT publish-embeds. That script is the reels pipeline: it selects from
 * loro_video_candidates, runs the on-camera vision gate (meaningless for
 * animation), and appends to data/embedVideos.json — the file the App Store
 * build ships inside a VERTICAL reels feed. An episode written there would
 * play landscape-in-a-portrait-box to every user tomorrow. Episodes live in
 * data/collections.json instead, which only the dev client merges in until a
 * store build filters by collection (see core/catalog/collectionVideos.ts).
 *
 * WHAT IS SHARED, deliberately: the caption fetch, the cue chunker, the
 * translation + gloss prompts, the level estimate and the dollar meter are
 * the same modules publish-embeds uses. An episode's cues are shaped and
 * priced exactly like a reel's, so the feed, the blanks, the word taps and
 * the Words tab need to know nothing new.
 *
 * SUBTITLE QUALITY (Radek, 2026-09-21: "make sure the subtitles are ON
 * POINT"). Every video is audited before a cent is spent — see auditCues():
 * word-level timing must be real, timings monotonic, no empty or glued
 * tokens, cue lengths inside the chunker's own limits, and the track must be
 * PUNCTUATED (the tell between YouTube's two ASR tiers — see repairWords).
 * A track that fails only on punctuation is REPAIRED token for token (same
 * count, same order, same timings; corrections capped and listed) and then
 * audited again. Anything else hard skips the video. The full transcript
 * with timestamps and every correction is written to raw/episodes/<id>.txt
 * (raw/ is git-ignored) so a human can read it against the video before it
 * ships. `--repair-only` stops after the repair — a few cents to see the
 * diff before spending on the gloss. `--no-repair` skips the repair.
 *
 * REPAIR CACHE. A successful repair is saved to raw/episodes/<id>.repair.json
 * and reused on the next run when the fresh ASR still has the same tokens at
 * the same times — so `--repair-only` followed by the real run pays for the
 * repair once, and a correction the reviewer disagrees with is fixed by
 * editing that file (change the "text", keep the count) instead of paying
 * for another roll of the dice.
 *
 * Money: `--budget-usd` is a hard ceiling via openaiCost; the run stops
 * cleanly between videos and everything written so far stays written.
 * Crash-safe: the file is rewritten after every video.
 *
 * Zero DB writes. Zero YouTube quota beyond one videos.list call (1 unit).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { COLLECTIONS, REELS } from '../packages/core/src/collections.ts';
import { fetchCaptions, CAPTION_FETCH_DELAY_MS } from './lib/captionFetch.mts';
import type { EmbedEntry } from './lib/catalog.mts';
import { REPO_ROOT, requireEnv } from './lib/env.mts';
import { estimateLevel } from './lib/estimateLevel.mts';
import { glossWords, translateCues } from './lib/glossCues.mts';
import {
  groupIntoCues,
  json3ToWords,
  multiWordTokenShare,
  type CueOut,
  type CueWord,
} from './lib/json3ToCues.mts';
import {
  BudgetExceededError,
  assertAffordable,
  report,
  setBudget,
  spentUsd,
} from './lib/openaiCost.mts';
import { RepairRejected, repairWords, type RepairResult } from './lib/repairWords.mts';
import { listVideos, parseIsoDuration, sleep } from './lib/youtube.mts';
import { expandNumeralTokens } from '../packages/core/src/numerals.ts';

const COLLECTIONS_PATH = path.join(REPO_ROOT, 'data', 'collections.json');
const REVIEW_DIR = path.join(REPO_ROOT, 'raw', 'episodes');

/** Same floor publish-embeds applies; an episode under it has no speech. */
const MIN_WORDS = 15;
/** Same threshold publish-embeds applies: above this the track is caption
 *  LINES, not words, and karaoke/blanks cannot work. */
const MAX_LINE_TOKEN_SHARE = 0.1;
/** The chunker's own cap (json3ToCues); a cue past it is a chunker bug. */
const MAX_CUE_SECONDS = 4.2;
/**
 * PUNCTUATION IS THE TELL between YouTube's two ASR tiers. The newer tier
 * returns capitalised, punctuated text ("Yo soy Peppa Pig." / "¿Podemos
 * salir a jugar?") and the chunker turns it into one clean sentence per cue.
 * The older tier returns a bare word stream — no sentence ends, so cues can
 * only break on pauses, run 8–11s, and split mid-sentence ("es papá pig
 * Peppa / Pig el loro / poli"). Found 2026-09-21 across three Peppa episodes
 * from the SAME channel: one punctuated, two not. Below this share of
 * sentence-terminated cues the track is the old tier and is not "on point".
 */
const MIN_PUNCTUATED_CUE_SHARE = 0.5;
const SENTENCE_END = /[.!?…]["»”']?$/;

type EpisodeEntry = EmbedEntry & { collection: string };

type Options = {
  ids: string[];
  collection: string;
  budgetUsd: number;
  dryRun: boolean;
  repair: boolean;
  repairOnly: boolean;
};

function usage(msg?: string): never {
  if (msg) console.error(`\n${msg}`);
  console.error(
    '\nUsage: npm run ingest-episodes -- --collection <id> --ids a,b,c ' +
      '[--budget-usd 1] [--dry-run] [--repair-only] [--no-repair]\n' +
      `Collections: ${COLLECTIONS.filter((c) => c.id !== REELS)
        .map((c) => c.id)
        .join(', ')}\n`
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    ids: [],
    collection: '',
    budgetUsd: 1,
    dryRun: false,
    repair: true,
    repairOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? usage(`${arg} needs a value`);
    switch (arg) {
      case '--ids':
        o.ids = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--collection':
        o.collection = next();
        break;
      case '--budget-usd': {
        const v = Number(next());
        if (!Number.isFinite(v) || v <= 0) usage('--budget-usd needs a positive number');
        o.budgetUsd = v;
        break;
      }
      case '--dry-run':
        o.dryRun = true;
        break;
      case '--repair-only':
        o.repairOnly = true;
        break;
      case '--no-repair':
        o.repair = false;
        break;
      default:
        usage(`Unknown flag "${arg}"`);
    }
  }
  if (o.ids.length === 0) usage('--ids is required');
  const known = COLLECTIONS.find((c) => c.id === o.collection);
  if (!known || known.id === REELS) usage(`--collection must be one of the episode shelves`);
  return o;
}

// ── The file ────────────────────────────────────────────────────────────────

function loadCollections(): EpisodeEntry[] {
  if (!existsSync(COLLECTIONS_PATH)) return [];
  return JSON.parse(readFileSync(COLLECTIONS_PATH, 'utf8')) as EpisodeEntry[];
}

function saveCollections(entries: EpisodeEntry[]): void {
  // Atomic, same as publish-embeds: a crash mid-write leaves the old file.
  const tmp = `${COLLECTIONS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2) + '\n');
  renameSync(tmp, COLLECTIONS_PATH);
}

// ── Repair cache ────────────────────────────────────────────────────────────

type RepairCache = { source: { text: string; start: number }[]; result: RepairResult };

const repairCachePath = (id: string) => path.join(REVIEW_DIR, `${id}.repair.json`);

/** The cached repair, if the fresh ASR words are the ones it was made from. */
function loadRepair(id: string, words: readonly CueWord[]): RepairResult | null {
  const file = repairCachePath(id);
  if (!existsSync(file)) return null;
  try {
    const cache = JSON.parse(readFileSync(file, 'utf8')) as RepairCache;
    const same =
      cache.source.length === words.length &&
      cache.source.every((w, i) => w.text === words[i].text && w.start === words[i].start);
    if (!same) return null;
    if (cache.result.words.length !== words.length) return null;
    return cache.result;
  } catch {
    return null;
  }
}

function saveRepair(id: string, words: readonly CueWord[], result: RepairResult): void {
  const cache: RepairCache = {
    source: words.map((w) => ({ text: w.text, start: w.start })),
    result,
  };
  writeFileSync(repairCachePath(id), JSON.stringify(cache, null, 2) + '\n');
}

/** A stub is an entry with no dictionary — the placeholders the shelf UI was
 *  built against. The first real episode of a collection retires them. */
const isStub = (e: EpisodeEntry): boolean => Object.keys(e.dictionary ?? {}).length === 0;

/**
 * The episode's own name out of the upload's title. Channels wrap it
 * differently — "Peppa Pig - El loro Polly (episodio completo)" on the
 * Spain channel, "Peppa Pig 🐷 El escondite 🐷 Episodio Completo" too, and
 * "Una nueva decoración en la casa de Peppa | Peppa Pig | Discovery Kids
 * Latinoamérica" on Discovery Kids — so this splits on the separators
 * (dashes, pipes, emoji), drops every segment that names the show, the
 * channel or the format, strips bracketed suffixes, and keeps the longest
 * of what is left.
 */
const TITLE_SEPARATOR = /\s+[-–—|]\s+|\s*[\p{Extended_Pictographic}\uFE0F]+\s*/u;
const NOT_A_TITLE = [
  /^peppa pig(\s|$)/i, /peppa pig\s*(español|espa[nñ]ol|latino|castellano)/i,
  /discovery kids/i, /canal oficial/i, /dibujos animados/i, /para ni[nñ]os/i,
  /episodios? completos?/i, /cap[ií]tulos? completos?/i, /^español( latino)?$/i,
];
export function episodeTitle(raw: string): string {
  const segments = raw
    .split(TITLE_SEPARATOR)
    .map((seg) => seg.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ').trim())
    .filter(Boolean);
  const kept = segments.filter((seg) => !NOT_A_TITLE.some((re) => re.test(seg)));
  const pool = kept.length > 0 ? kept : segments;
  return [...pool].sort((a, b) => b.length - a.length)[0] ?? raw.trim();
}

// ── Subtitle audit ──────────────────────────────────────────────────────────

type Audit = {
  hard: string[];
  soft: string[];
  words: number;
  lineShare: number;
  punctuatedShare: number;
};

function auditCues(cues: readonly CueOut[]): Audit {
  const hard: string[] = [];
  const soft: string[] = [];
  const words = cues.reduce((n, c) => n + c.words.length, 0);
  const lineShare = multiWordTokenShare(cues);

  const punctuatedShare =
    cues.length === 0
      ? 0
      : cues.filter((c) => SENTENCE_END.test(c.words[c.words.length - 1]?.text ?? '')).length /
        cues.length;
  if (punctuatedShare < MIN_PUNCTUATED_CUE_SHARE) {
    hard.push(
      `only ${(punctuatedShare * 100).toFixed(0)}% of cues end a sentence — ` +
        'unpunctuated ASR tier, cues split mid-sentence'
    );
  }

  if (words < MIN_WORDS) hard.push(`only ${words} words — no speech to learn from`);
  if (lineShare > MAX_LINE_TOKEN_SHARE) {
    hard.push(
      `${(lineShare * 100).toFixed(0)}% of tokens are caption LINES, not words — ` +
        'karaoke and blanks cannot work'
    );
  }

  let prevEnd = -1;
  let nonMonotonic = 0;
  let badSpan = 0;
  let empty = 0;
  let longCues = 0;
  let annotations = 0;
  for (const cue of cues) {
    if (cue.end - cue.start > MAX_CUE_SECONDS + 0.01) longCues += 1;
    for (const w of cue.words) {
      if (!w.text.trim()) empty += 1;
      if (w.end <= w.start) badSpan += 1;
      if (w.start < prevEnd - 0.25) nonMonotonic += 1;
      prevEnd = Math.max(prevEnd, w.end);
      if (/^\[.+\]$/.test(w.text)) annotations += 1;
    }
  }
  if (empty) hard.push(`${empty} empty word token(s)`);
  if (badSpan) hard.push(`${badSpan} word(s) with end <= start`);
  if (nonMonotonic) hard.push(`${nonMonotonic} word(s) start before the previous one ended`);
  if (longCues) soft.push(`${longCues} cue(s) longer than ${MAX_CUE_SECONDS}s`);
  if (annotations) soft.push(`${annotations} [annotation] token(s) leaked into words`);

  // ASR tells: tokens only an acoustic model would produce.
  const all = cues.flatMap((c) => c.words);
  const glued = all.filter((w) => /\S\s\S/.test(w.text)).length;
  if (glued) soft.push(`${glued} glued token(s) (two words in one)`);
  // Spanish has exactly four one-letter words (a, e, o, y, plus u before o-).
  // Anything else that short is a clipped word: "ya s ya s", "seor", "po".
  const clipped = all.filter((w) => {
    const t = w.text.toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
    return t.length === 1 && !'aeouy'.includes(t);
  }).length;
  if (clipped) soft.push(`${clipped} clipped one-letter token(s)`);

  return { hard, soft, words, lineShare, punctuatedShare };
}

function transcriptFor(
  id: string,
  title: string,
  cues: readonly CueOut[],
  repair: RepairResult | null
): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s - m * 60).toFixed(1).padStart(4, '0');
    return `${m}:${sec}`;
  };
  const lines = [
    `${title}`,
    `https://www.youtube.com/watch?v=${id}`,
    '',
    'Read this against the video. Every line is one karaoke cue: [start–end] Spanish  →  English.',
    '',
  ];
  if (repair) {
    lines.push(
      `REPAIRED from the unpunctuated ASR tier: ${repair.punctuated} tokens gained ` +
        `punctuation/case, ${repair.accents} gained accents, ` +
        `${repair.changes.length} word(s) corrected:`
    );
    for (const c of repair.changes) lines.push(`  #${c.i}  ${c.from}  →  ${c.to}`);
    if (repair.changes.length === 0) lines.push('  (none)');
    lines.push('');
  }
  for (const c of cues) {
    const es = c.words.map((w) => w.text).join(' ');
    const en = c.translations?.en ?? '';
    lines.push(`[${fmt(c.start)}–${fmt(c.end)}]  ${es}${en ? `\n${' '.repeat(16)}→ ${en}` : ''}`);
  }
  return lines.join('\n') + '\n';
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = requireEnv('YOUTUBE_API_KEY');
  if (!options.dryRun) requireEnv('OPENAI_API_KEY');
  setBudget(options.budgetUsd);
  mkdirSync(REVIEW_DIR, { recursive: true });

  console.log(
    `\ningest-episodes → ${options.collection}  (${options.ids.length} id(s), ` +
      `budget $${options.budgetUsd.toFixed(2)}${options.dryRun ? ', DRY RUN' : ''})\n`
  );

  // One videos.list call for the whole batch: title, channel, duration,
  // embeddable. 1 quota unit.
  const meta = new Map((await listVideos(options.ids, apiKey)).map((v) => [v.id ?? '', v]));

  let entries = loadCollections();
  const stubs = entries.filter((e) => e.collection === options.collection && isStub(e));
  if (stubs.length && !options.dryRun && !options.repairOnly) {
    console.log(
      `retiring ${stubs.length} stub(s) from "${options.collection}": ` +
        stubs.map((s) => s.id).join(', ') +
        '\n'
    );
    entries = entries.filter((e) => !stubs.includes(e));
  }

  const stats = { written: 0, skipped: 0, failed: 0 };
  let budgetStopped = false;

  for (const [index, id] of options.ids.entries()) {
    console.log(`▶ ${id}`);
    try {
      const v = meta.get(id);
      if (!v) {
        console.log('   ✗ not returned by the YouTube API (private, deleted, or a typo)\n');
        stats.failed += 1;
        continue;
      }
      const title = v.snippet?.title ?? id;
      const channelTitle = v.snippet?.channelTitle ?? 'YouTube channel';
      const channelId = v.snippet?.channelId ?? '';
      const duration = parseIsoDuration(v.contentDetails?.duration) ?? 0;
      const embeddable = v.status?.embeddable !== false;
      console.log(`   ${title}`);
      console.log(
        `   ${channelTitle} · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` +
          ` · embeddable=${embeddable}` +
          (v.status?.madeForKids ? ' · madeForKids' : '')
      );
      if (!embeddable) {
        // The licence split allows ONLY the official iframe, so a video the
        // uploader will not let embed cannot be in Loro at all.
        console.log('   ✗ uploader disabled embedding — cannot ship\n');
        stats.skipped += 1;
        continue;
      }

      const { json3, track } = await fetchCaptions(id);
      // Same path as json3ToCues(), kept in two steps so a repaired word
      // list can be re-chunked with the identical chunker.
      let words: CueWord[] = expandNumeralTokens(json3ToWords(json3));
      let cues = groupIntoCues(words);
      let audit = auditCues(cues);
      const describe = (a: Audit) =>
        `${cues.length} cues, ${a.words} words, ` +
        `${(a.lineShare * 100).toFixed(1)}% line tokens, ` +
        `${(a.punctuatedShare * 100).toFixed(0)}% sentence-ended`;
      console.log(`   captions: ${track.languageCode}/${track.kind || 'uploaded'} → ${describe(audit)}`);
      for (const s of audit.soft) console.log(`   ~ ${s}`);

      // Repair when — and only when — punctuation is what failed. A track
      // with no word timing or no speech is not something a rewrite fixes.
      const onlyPunctuation =
        audit.hard.length === 1 && audit.punctuatedShare < MIN_PUNCTUATED_CUE_SHARE;
      let repair: RepairResult | null = null;
      if (audit.hard.length && onlyPunctuation && options.repair) {
        if (options.dryRun) {
          console.log(
            `   ~ unpunctuated ASR tier — would repair token-for-token (≈$0.03), then re-audit`
          );
        } else {
          const cached = loadRepair(id, words);
          if (cached) {
            repair = cached;
            console.log('   repair: reused raw/episodes/' + id + '.repair.json (nothing spent)');
          } else {
            assertAffordable();
            repair = await repairWords(words, title);
          }
          const sourceWords = words;
          words = repair.words;
          cues = groupIntoCues(words);
          audit = auditCues(cues);
          // Cache ONLY a repair the audit accepts. A cached failure would be
          // silently reused on the next run and fail again for free — which
          // is how the mini experiment poisoned two caches.
          if (!cached && audit.hard.length === 0) saveRepair(id, sourceWords, repair);
          console.log(
            `   repaired: ${repair.punctuated} tokens punctuated/capitalised, ` +
              `${repair.accents} accent fix(es), ` +
              `${repair.changes.length} word(s) corrected → ${describe(audit)}`
          );
          const ignored = (repair as RepairResult & { ignored?: string[] }).ignored ?? [];
          for (const note of ignored.slice(0, 6)) console.log(`      ~ ignored: ${note}`);
          for (const c of repair.changes.slice(0, 40)) {
            console.log(`      #${String(c.i).padStart(3)}  ${c.from}  →  ${c.to}`);
          }
          if (repair.changes.length > 40) console.log(`      … ${repair.changes.length - 40} more in the review file`);
          for (const s of audit.soft) console.log(`   ~ ${s}`);
        }
      }

      if (audit.hard.length && !(options.dryRun && onlyPunctuation && options.repair)) {
        for (const h of audit.hard) console.log(`   ✗ ${h}`);
        console.log('   ✗ subtitles not good enough — skipped\n');
        stats.skipped += 1;
        continue;
      }

      if (options.dryRun) {
        writeFileSync(path.join(REVIEW_DIR, `${id}.txt`), transcriptFor(id, title, cues, null));
        console.log(`   ✓ would translate + gloss · transcript → raw/episodes/${id}.txt\n`);
        stats.written += 1;
        continue;
      }

      if (options.repairOnly) {
        writeFileSync(path.join(REVIEW_DIR, `${id}.txt`), transcriptFor(id, title, cues, repair));
        console.log(
          `   ✓ repair only · run spend $${spentUsd().toFixed(4)} · ` +
            `transcript + corrections → raw/episodes/${id}.txt\n`
        );
        stats.written += 1;
        continue;
      }

      assertAffordable();
      await translateCues(cues, title);
      const dictionary = await glossWords(cues, title);
      console.log(`   glossed: ${Object.keys(dictionary).length} dictionary entries`);

      const entry: EpisodeEntry = {
        id,
        youtubeId: id,
        title: episodeTitle(title),
        creator: channelTitle,
        level: estimateLevel(cues),
        durationSeconds: duration,
        thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        attribution: {
          channelTitle,
          channelUrl: channelId
            ? `https://www.youtube.com/channel/${channelId}`
            : `https://www.youtube.com/watch?v=${id}`,
          videoUrl: `https://www.youtube.com/watch?v=${id}`,
          license: 'youtube',
        },
        cues,
        dictionary,
        collection: options.collection,
      };

      const existing = entries.findIndex((e) => e.id === id);
      if (existing >= 0) entries[existing] = entry;
      else entries.push(entry);
      saveCollections(entries);
      writeFileSync(path.join(REVIEW_DIR, `${id}.txt`), transcriptFor(id, title, cues, repair));

      stats.written += 1;
      console.log(
        `   ✓ written as ${entry.level} · run spend $${spentUsd().toFixed(4)} · ` +
          `transcript → raw/episodes/${id}.txt\n`
      );
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        console.log(`   ⛔ ${error.message} — stopping.\n`);
        budgetStopped = true;
        break;
      }
      if (error instanceof RepairRejected) {
        // The verifier said no. The few cents are spent; nothing was written.
        stats.skipped += 1;
        console.log(`   ✗ ${error.message} — skipped\n`);
        continue;
      }
      stats.failed += 1;
      console.log(`   ! failed: ${error instanceof Error ? error.message : error}\n`);
    }
    if (index < options.ids.length - 1) await sleep(CAPTION_FETCH_DELAY_MS);
  }

  console.log('────────────────────────────────────────');
  console.log(
    `${options.dryRun ? 'would write' : options.repairOnly ? 'repaired' : 'written'} ${stats.written} · skipped ${stats.skipped} · failed ${stats.failed}` +
      (budgetStopped ? ' · STOPPED ON BUDGET' : '')
  );
  if (!options.dryRun && !options.repairOnly) {
    console.log(`data/collections.json now holds ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
  }
  if (!options.dryRun) console.log('\nOpenAI spend:\n' + report());
  if (!options.dryRun && !options.repairOnly) {
    console.log(
      '\nNext: read raw/episodes/<id>.txt against each video, then a dev build shows the shelf.\n' +
        'publish-catalog still leaves collections.json out — nothing here reaches the App Store.'
    );
  }
}

await main();
