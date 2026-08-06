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
 */
export const LEVELS_ENABLED = false;

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
