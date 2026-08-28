#!/usr/bin/env node
/**
 * Loro — SHORTLIST for the onboarding taste reel. Read-only; writes nothing.
 *
 *   npm run taste-candidates            ranked table
 *   npm run taste-candidates -- --json  the same rows as JSON, for a chooser
 *   npm run taste-candidates -- --top 40
 *
 * WHAT THIS IS FOR. The three clips in apps/mobile/src/onboarding/taste.ts are
 * the last thing anyone sees before the paywall, so they are a hand-picked list
 * rather than a query — but the POOL they are picked from is worth deriving
 * mechanically, and worth re-deriving every time the catalog grows. This is
 * that derivation. It proposes; a human disposes.
 *
 * NO SUPABASE, ON PURPOSE. Titles normally live only in loro_video_candidates
 * (the embed JSON carries neither title nor description), but the on-camera
 * audit report keeps a copy of the title and channel for every video it judged,
 * so this runs entirely off two files in data/ and needs no key and no network.
 *
 * ------------------------------------------------------------------ the gate
 *
 * Three hard filters, each of them a fact about what a taste clip has to be:
 *
 *   on camera        The pitch is "real people talking". A voiceover over
 *                    b-roll may be a fine feed clip and is not a demonstration
 *                    of that sentence. Formats accepted: talking-head,
 *                    presenter, interview. Judged by the vision audit, not by
 *                    metadata — see scripts/audit-on-camera.mts.
 *   enough transcript  4+ cues and 15+ words, or the karaoke line has nothing
 *                    to do and the screen shows a video with subtitles.
 *   not denied       DENIED_IDS, mirrored from apps/mobile/src/platform/
 *                    denylist.ts. Small enough to copy, important enough that
 *                    a takedown must never resurface here.
 *
 * -------------------------------------------------------------- the ranking
 *
 * Everything past the gate is a preference, so it is a weighted score rather
 * than more filters — a clip that is slightly too long but perfect on every
 * other axis should still surface. The weights say what this screen is for:
 *
 *   level  x3.0   The single strongest signal. A taste clip that cannot be
 *                 followed argues AGAINST buying, so A1 outranks A2 outranks
 *                 B1, and B2 scores zero.
 *   pace   x2.5   Words per second of speech. 2.2 w/s is comfortable, 4+ is a
 *                 wall of sound. This is what "real speed" costs a beginner.
 *   cover  x2.5   The share of spoken surfaces that have a dictionary entry,
 *                 i.e. how much of the clip is tappable. Currently 1.0 for
 *                 every published entry; kept because the day it is not, a
 *                 clip full of dead words must not reach this screen.
 *   length x1.5   15-45s is the sweet spot. Longer still scores, just less.
 *   trans  x1.0   The share of cues with an English translation.
 *   frames x0.8   2+ frames with a speaker beats 1 — a stronger read that the
 *                 person is actually the subject rather than a passing shot.
 *
 * ⚠️ THE SCORE CANNOT READ. It ranks legibility, and it knows nothing about
 * what the clip is ABOUT. In the first pass over this pool the top of the list
 * included a sermon, an interview about daily earnings and a drinking game —
 * all of them clear, slow, well-transcribed, and all of them wrong for the
 * screen that asks a stranger for money. READ THE TRANSCRIPT BEFORE PICKING.
 * That is why this prints one.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/env.mts';

const EMBEDS_PATH = path.join(REPO_ROOT, 'data', 'embedVideos.json');
const AUDIT_PATH = path.join(REPO_ROOT, 'data', 'on-camera-audit.report.json');

/** Mirrored from apps/mobile/src/platform/denylist.ts. */
const DENIED_IDS = new Set<string>(['AQRWt2bNMHo']);

/** The formats where a person is the subject and is speaking to camera. */
const ON_CAMERA_FORMATS = new Set(['talking-head', 'presenter', 'interview']);

const MIN_CUES = 4;
const MIN_WORDS = 15;

type Word = { text: string };
type Cue = { start: number; end: number; words?: Word[]; translations?: Record<string, string> };
type Embed = {
  id: string;
  youtubeId: string;
  creator: string;
  level: string;
  durationSeconds?: number;
  cues: Cue[];
  dictionary?: Record<string, unknown>;
};
type Verdict = {
  onCamera: boolean;
  framesWithSpeaker: number;
  format: string;
  title: string;
  channel: string;
};

export type Candidate = {
  id: string;
  title: string;
  creator: string;
  level: string;
  format: string;
  frames: number;
  seconds: number;
  cues: number;
  words: number;
  /** Words per second OF SPEECH, not of runtime — silence is not pace. */
  wordsPerSecond: number;
  /** Share of spoken surfaces with a dictionary entry, so: tappable. */
  coverage: number;
  dictionarySize: number;
  translated: number;
  score: number;
  url: string;
  thumbnail: string;
  lines: { es: string; en: string }[];
};

/** The app's normaliseSurface, copied rather than imported: this script must
    not pull an RN-adjacent module graph in just to lowercase a word. */
function normalizeSurface(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^a-z0-9áéíóúüñ]+|[^a-z0-9áéíóúüñ]+$/g, '');
}

function scoreOf(c: Omit<Candidate, 'score'>): number {
  const level = { A1: 1.0, A2: 0.85, B1: 0.35, B2: 0 }[c.level] ?? 0;
  const pace = Math.max(0, Math.min(1, (4.2 - c.wordsPerSecond) / 2.0));
  const length = c.seconds >= 15 && c.seconds <= 45 ? 1 : c.seconds <= 60 ? 0.5 : 0.1;
  const frames = c.frames >= 2 ? 1 : 0.6;
  return (
    level * 3.0 +
    pace * 2.5 +
    c.coverage * 2.5 +
    length * 1.5 +
    c.translated * 1.0 +
    frames * 0.8
  );
}

export function buildCandidates(): Candidate[] {
  const embeds = JSON.parse(readFileSync(EMBEDS_PATH, 'utf8')) as Embed[];
  const verdicts = (
    JSON.parse(readFileSync(AUDIT_PATH, 'utf8')) as { verdicts: Record<string, Verdict> }
  ).verdicts;

  const out: Candidate[] = [];
  for (const video of embeds) {
    if (DENIED_IDS.has(video.id) || DENIED_IDS.has(video.youtubeId)) continue;

    const verdict = verdicts[video.youtubeId];
    // An UNJUDGED video is not an on-camera video. 99 of the 336 have never
    // been through the vision audit; treating "no verdict" as a pass would put
    // exactly the content the audit exists to catch on the first screen.
    if (!verdict || !verdict.onCamera || !ON_CAMERA_FORMATS.has(verdict.format)) continue;

    const cues = video.cues ?? [];
    if (cues.length < MIN_CUES) continue;
    const words = cues.flatMap((cue) => cue.words ?? []);
    if (words.length < MIN_WORDS) continue;

    const speech = cues.reduce((total, cue) => total + (cue.end - cue.start), 0);
    if (speech <= 0) continue;

    const dictionary = video.dictionary ?? {};
    const surfaces = words.map((w) => normalizeSurface(w.text)).filter(Boolean);
    const covered = surfaces.filter((s) => s in dictionary).length;

    const base = {
      id: video.youtubeId,
      title: verdict.title,
      creator: video.creator,
      level: video.level,
      format: verdict.format,
      frames: verdict.framesWithSpeaker,
      seconds: video.durationSeconds ?? Math.round(cues[cues.length - 1].end),
      cues: cues.length,
      words: words.length,
      wordsPerSecond: Number((words.length / speech).toFixed(2)),
      coverage: surfaces.length ? Number((covered / surfaces.length).toFixed(3)) : 0,
      dictionarySize: Object.keys(dictionary).length,
      translated: Number(
        (cues.filter((cue) => cue.translations?.en).length / cues.length).toFixed(2)
      ),
      url: `https://www.youtube.com/watch?v=${video.youtubeId}`,
      thumbnail: `https://i.ytimg.com/vi/${video.youtubeId}/mqdefault.jpg`,
      lines: cues.map((cue) => ({
        es: (cue.words ?? []).map((w) => w.text).join(' '),
        en: cue.translations?.en ?? '',
      })),
    };
    out.push({ ...base, score: Number(scoreOf(base).toFixed(3)) });
  }

  out.sort((a, b) => b.score - a.score || a.seconds - b.seconds);
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  const topFlag = argv.indexOf('--top');
  const top = topFlag >= 0 ? Number(argv[topFlag + 1]) : 30;
  const candidates = buildCandidates();

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(candidates.slice(0, top), null, 2));
    return;
  }

  console.log(`\n${candidates.length} clips clear the gate.\n`);
  console.log(
    ['score', 'lvl', 'secs', 'w/s', 'cov', 'cues', 'creator', 'id'].join('\t')
  );
  for (const c of candidates.slice(0, top)) {
    console.log(
      [
        c.score.toFixed(2),
        c.level,
        `${c.seconds}s`,
        c.wordsPerSecond.toFixed(2),
        c.coverage.toFixed(2),
        c.cues,
        c.creator.slice(0, 24),
        c.id,
      ].join('\t')
    );
  }
  console.log('\nRead the transcript before picking — the score cannot.\n');
}

// Only when run directly, so buildCandidates stays importable.
if (process.argv[1]?.endsWith('taste-candidates.mts')) main();
