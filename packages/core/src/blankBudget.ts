import type { Video } from './types.ts';

/**
 * HOW MANY BLANKS A VIDEO CAN CARRY, AND WHERE.
 *
 * The planners were tuned on reels: 20-90 seconds, a handful of cues, a
 * flat cap of four level blanks and five recall blanks, placed walking from
 * the first cue. On a five-minute Peppa episode that put every blank in the
 * first minute and left four minutes with none — Radek, 2026-09-21: "after
 * some minutes there are no words in all of them".
 *
 * So a LONG video gets a budget by length, one level blank per
 * BLANK_EVERY_S, and the level planner places them one per window across
 * the whole run instead of front-loading. Reels keep their caps and their
 * order exactly; this only changes videos over LONG_VIDEO_S.
 */
export const LONG_VIDEO_S = 90;
export const BLANK_EVERY_S = 30;
export const MAX_LONG_BLANKS = 12;

type Timed = Pick<Video, 'durationSeconds' | 'cues'>;

/** Known duration when the catalog has it, else the last cue's end. */
export function videoLengthS(video: Timed): number {
  if (video.durationSeconds && video.durationSeconds > 0) return video.durationSeconds;
  const last = video.cues[video.cues.length - 1];
  return last ? last.end : 0;
}

export function isLongVideo(video: Timed): boolean {
  return videoLengthS(video) >= LONG_VIDEO_S;
}

/** The level-blank budget of a long video: one per BLANK_EVERY_S, capped. */
export function longBlankCount(video: Timed): number {
  return Math.max(2, Math.min(MAX_LONG_BLANKS, Math.floor(videoLengthS(video) / BLANK_EVERY_S)));
}

/** `n` equal windows of cue indexes over [from, cueCount), as [start, end). */
export function cueWindows(cueCount: number, from: number, n: number): [number, number][] {
  const span = cueCount - from;
  if (span <= 0 || n <= 0) return [];
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const s = from + Math.floor((span * i) / n);
    const e = from + Math.floor((span * (i + 1)) / n);
    if (e > s) out.push([s, e]);
  }
  return out;
}
