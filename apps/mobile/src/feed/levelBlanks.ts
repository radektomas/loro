import type { SavedWord, Video } from '@loro/core/types';
import { computeLevelBlankPlan, tierFor } from '@loro/core/levels';
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
