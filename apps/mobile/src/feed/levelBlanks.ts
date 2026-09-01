import type { SavedWord, Video } from '@loro/core/types';
import {
  computeLevelBlankPlan,
  tierFor,
  wordLevel,
  type LevelBlankWord,
} from '@loro/core/levels';
import { glossText, lookupGloss, normalizeSurface } from '@loro/core/dictionary';
import { locateBlank, llog, type BlankEntry } from './recall';

/**
 * CHECKPOINT L — blue level-practice blanks. Flag and plan builder.
 *
 * THE FLAG LIVES HERE, beside the feature, for the same reason RECALL_ENABLED
 * lives in recall.ts: it is a feature switch, not an environment value, so it
 * does not belong in platform/config.ts.
 *
 * TWO DIFFERENT SYSTEMS SHARE THE WORD "LEVEL" AND THIS IS THE SECOND ONE.
 * The A1/A2/B1/B2 chip in the band is CEFR content metadata and has nothing to
 * do with this file. This is the 1-6 tier ladder (Guiri -> Nativo) that the
 * user CLIMBS by filling blue blanks — earned, never picked. Nothing here
 * reads or writes the CEFR level.
 *
 * Nothing here reimplements the level system. computeLevelBlankPlan,
 * applyLevelAnswer, tierFor and getLevelState all come from @loro/core
 * untouched; this module only resolves core's cueIndex->LevelBlankWord plan
 * into the positional shape the shared hold needs.
 */

/**
 * THE MASTER SWITCH. False ships the blue blanks dark: no level plan is
 * computed, no blue blank is ever merged into the hold, and checkpoint F's
 * green recall blanks are completely unaffected either way.
 *
 * Independent of RECALL_ENABLED on purpose — the two can be flipped in any
 * combination, and all four states are meant to work.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NOW ON. Measured against the real catalog (data/embedVideos.json, 207
 * embeds, all of them carrying a dictionary) before flipping, because the
 * failure mode of this feature is silence rather than an error — a video with
 * no glossable word in any reachable band simply renders nothing, so "on but
 * invisible" is a state it can sit in indefinitely without complaining:
 *
 *   206 of 207 videos yield at least one blue blank
 *   601 blanks total, 2.90 per video, at every user level
 *
 * WHAT A NEW USER ACTUALLY SEES, since that is the part the aggregate hides.
 * Band 1 IS the function-word list by construction (wordLevel: isFunctionWord
 * returns 1), so a fresh device at level 1 draws 91% articles and
 * prepositions — "la" prompted as "the". That reads badly in isolation and is
 * why this note exists rather than a bare `true`.
 *
 * It self-corrects in about two videos, which is the reason it is acceptable
 * rather than a bug to fix first: METER_UP is 20, so five correct fills is a
 * level, and at 2.9 blanks per video that is ~2 videos per rung. Simulated
 * over the real catalog, a user answering correctly sees function words on
 * videos 1-2 and real vocabulary from video 3 ("llaman", "verdad", "país",
 * "probar"), reaching the top of the ladder around video 10. levels.ts:250-256
 * predicts exactly this — "filling easier blanks climbs the meter toward the
 * band where the user's real level has material" — and the measurement agrees.
 *
 * ⚠️ KNOWN ROUGH EDGE, NOT FIXED HERE. Band 5 is "everything unlisted", which
 * includes numerals and proper nouns, so the top of the ladder can blank
 * "1979", "000" or "fei". Those are unanswerable as vocabulary practice. A
 * letter-bearing filter in computeLevelBlankPlan would remove them; that is a
 * change to core's selection rules and its test suite, so it is deliberately
 * left as a separate decision rather than smuggled in with the flag.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const LEVELS_ENABLED = true;

/**
 * core's level-blank plan, resolved into positions.
 *
 * `excludeCues` is the recall plan's cues, passed straight through — the web
 * does exactly this (Feed.tsx:571-580) and it is the FIRST of the two things
 * that keep green and blue blanks off each other. The second is inside core:
 * computeLevelBlankPlan skips any word already in the SRS (levels.ts:311), so
 * a due saved word can never also be offered as level practice.
 *
 * All selection, banding, capping and spacing stays in core. This chooses
 * nothing — see levels.ts:266-275 for the rules it is deferring to.
 */
/**
 * ONE NAMED BLANK AT ONE NAMED CUE — the walkthrough's scripted blue blank.
 *
 * The planner above chooses; this obeys. The taste reel needs the blank on a
 * specific word in a specific cue ("mi" in the last clip's cue 2, the word
 * its opening line hands out a beat earlier), and computeLevelBlankPlan can
 * never reliably deliver that: it chooses by frequency band, not by which
 * word the clip just gave away, and takes the first band-match in a cue. A
 * scripted beat names its word exactly, the same way WALKTHROUGH.word names
 * its coached word — so this resolves one word the script chose, with the
 * same gloss rules the planner enforces (no translation, no blank), and the
 * guard test pins it against the real clip.
 *
 * Returns null on any miss — a moved cue, a lost gloss — because the reel
 * degrades to "a clip you watch" rather than throwing (WALKTHROUGH.required
 * is false, and that is the contract).
 */
export function buildScriptedLevelBlank(
  video: Video,
  cueIndex: number,
  text: string,
  language: string
): BlankEntry | null {
  const cue = video.cues[cueIndex];
  if (!cue) {
    llog(`scripted blank: ${video.id} has no cue ${cueIndex}`);
    return null;
  }
  const gloss = lookupGloss(video, text);
  const translation = gloss && glossText(gloss, language);
  if (!translation) {
    llog(`scripted blank: "${text}" has no ${language} gloss in ${video.id}`);
    return null;
  }
  const at = locateBlank(cue, text);
  if (!at) {
    llog(`scripted blank: "${text}" not found in cue ${cueIndex} of ${video.id}`);
    return null;
  }
  const word: LevelBlankWord = {
    text,
    translation,
    videoId: video.id,
    cueIndex,
    // The word's OWN band, same as the planner would stamp — the tier chip
    // reads this, and a scripted blank must not lie about its difficulty.
    level: wordLevel(normalizeSurface(text), gloss?.lemma),
  };
  llog(
    `scripted blank: video=${video.id} cue${cueIndex} "${text}" ` +
      `band=${word.level} @${at.pauseAt.toFixed(2)}s`
  );
  return { kind: 'level', cueIndex, word, ...at };
}

export function buildLevelPlan(
  video: Video,
  userLevel: number,
  savedWords: SavedWord[],
  language: string,
  excludeCues: ReadonlySet<number>
): BlankEntry[] {
  const plan = computeLevelBlankPlan(
    video,
    userLevel,
    savedWords,
    language,
    excludeCues
  );

  const entries: BlankEntry[] = [];
  for (const [cueIndex, word] of plan) {
    const at = locateBlank(video.cues[cueIndex], word.text);
    if (!at) continue;
    entries.push({ kind: 'level', cueIndex, word, ...at });
  }

  if (entries.length > 0) {
    llog(
      `plan video=${video.id} userLevel=${userLevel} (${tierFor(userLevel).name}) ` +
        `blue=${entries.length} excluded=[${[...excludeCues].join(',')}] ` +
        entries
          .map(
            (e) =>
              `[cue${e.cueIndex} "${e.surface}" band=${
                e.kind === 'level' ? e.word.level : '?'
              } @${e.pauseAt.toFixed(2)}s]`
          )
          .join(' ')
    );
  } else {
    // Silence is a real outcome here, not a bug: a video with no word in any
    // reachable band simply renders nothing (levels.ts:243-248). Worth saying
    // so on device, or an empty screen looks like a broken flag.
    llog(
      `plan video=${video.id} userLevel=${userLevel} (${tierFor(userLevel).name}) ` +
        `blue=0 — no glossable unsaved word in any band for this video`
    );
  }

  return entries;
}
