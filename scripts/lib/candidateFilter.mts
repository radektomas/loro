import {
  BLOCKED_CHANNEL_IDS,
  DUBBING_PATTERNS,
  FILTER,
} from '../config/harvest-queries.mts';
import type { CandidateRow } from './candidates.mts';

/**
 * The eligibility filter — a pure function, deliberately.
 *
 * It touches no network and no database: everything it needs is the row plus
 * a context object. That makes it testable in isolation, and re-runnable over
 * the whole table after tuning a threshold without spending a unit of quota.
 *
 * Thresholds live in config/harvest-queries.ts. There are no numeric literals
 * in this file, on purpose — tuning happens in one place.
 */

/**
 * Every specific cause a row can be rejected for. Never a generic 'filtered':
 * these strings go into reject_reason, and tuning a threshold is only possible
 * if you can `select reject_reason, count(*) ... group by 1` and see which one
 * is actually eating your content.
 */
export const REJECT_REASONS = {
  CHANNEL_BLOCKED: 'channel_blocked',
  DURATION_UNKNOWN: 'duration_unknown',
  DURATION_TOO_SHORT: 'duration_too_short',
  DURATION_TOO_LONG: 'duration_too_long',
  NOT_EMBEDDABLE: 'not_embeddable',
  LICENSE_UNKNOWN: 'license_unknown',
  CATEGORY_MUSIC: 'category_music',
  AUDIO_LANGUAGE_NOT_ES: 'audio_language_not_es',
  DUBBING_SUSPECTED: 'dubbing_suspected',
  VIEW_COUNT_TOO_LOW: 'view_count_too_low',
  LIKE_RATIO_TOO_LOW: 'like_ratio_too_low',
  CHANNEL_SATURATED: 'channel_saturated',
} as const;

export type RejectReason =
  (typeof REJECT_REASONS)[keyof typeof REJECT_REASONS];

/** Matches the spec'd shape: reason is present exactly when eligible is false. */
export type FilterVerdict = {
  eligible: boolean;
  reason?: RejectReason;
};

/** The columns the filter reads. A full CandidateRow satisfies this. */
export type CandidateFilterInput = Pick<
  CandidateRow,
  | 'title'
  | 'description'
  | 'channel_id'
  | 'duration_seconds'
  | 'view_count'
  | 'like_count'
  | 'license'
  | 'is_embeddable'
  | 'default_audio_language'
  | 'category_id'
>;

export type FilterContext = {
  /**
   * channel_id -> how many ELIGIBLE rows that channel already has. Source
   * diversity: without it, one prolific channel that happens to rank well
   * becomes the whole feed.
   */
  eligibleCountsByChannel: ReadonlyMap<string, number>;
};

export const EMPTY_CONTEXT: FilterContext = {
  eligibleCountsByChannel: new Map<string, number>(),
};

/**
 * Lowercase and strip diacritics, so DUBBING_PATTERNS can be written without
 * accents and still match "Doblaje", "DOBLADO" and "españól" alike.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Does the metadata carry a strong signal that the audio is dubbed or
 * otherwise not original Spanish speech? See DUBBING_PATTERNS for the why.
 */
export function looksDubbed(
  title: string | null,
  description: string | null
): boolean {
  const haystack = normalizeText(`${title ?? ''}\n${description ?? ''}`);
  if (!haystack.trim()) return false;
  return DUBBING_PATTERNS.some((pattern) => pattern.test(haystack));
}

const reject = (reason: RejectReason): FilterVerdict => ({
  eligible: false,
  reason,
});

/**
 * Decide whether a discovered candidate is worth transcribing.
 *
 * Checks run cheapest-and-most-decisive first, so the reason recorded is the
 * most fundamental one: a 3-second dubbed music video is rejected as
 * 'duration_too_short', not as 'category_music'. That ordering is what makes
 * the reject_reason histogram meaningful.
 */
export function filterCandidate(
  row: CandidateFilterInput,
  context: FilterContext = EMPTY_CONTEXT
): FilterVerdict {
  // --- editorial override ------------------------------------------------
  // First, ahead of everything: a blocked channel is the most decisive fact
  // we have about a row, and it is free to check. Running it first also means
  // the 'channel_blocked' count reflects EVERY video from that channel rather
  // than only the ones that happened to pass the other checks.
  if (row.channel_id && BLOCKED_CHANNEL_IDS.has(row.channel_id)) {
    return reject(REJECT_REASONS.CHANNEL_BLOCKED);
  }

  // --- hard structural facts -------------------------------------------
  if (row.duration_seconds === null) {
    // Unparseable ISO duration. We cannot reason about a clip whose length
    // is unknown, and guessing is how 40-minute videos reach the feed.
    return reject(REJECT_REASONS.DURATION_UNKNOWN);
  }
  if (row.duration_seconds < FILTER.MIN_DURATION_SECONDS) {
    return reject(REJECT_REASONS.DURATION_TOO_SHORT);
  }
  if (row.duration_seconds > FILTER.MAX_DURATION_SECONDS) {
    return reject(REJECT_REASONS.DURATION_TOO_LONG);
  }

  // --- playability & rights ---------------------------------------------
  // Explicit false only: null means the API did not say, which the license
  // check below handles more precisely.
  if (row.is_embeddable === false) {
    return reject(REJECT_REASONS.NOT_EMBEDDABLE);
  }
  if (row.license === null) {
    // No license => no lawful way to use it. Neither branch applies: it is
    // not known-CC (so it cannot be self-hosted) and not known-standard
    // (so we cannot even justify the embed). Unknown rights are a reject,
    // never a default.
    return reject(REJECT_REASONS.LICENSE_UNKNOWN);
  }

  // --- content suitability ----------------------------------------------
  if (row.category_id === FILTER.MUSIC_CATEGORY_ID) {
    return reject(REJECT_REASONS.CATEGORY_MUSIC);
  }
  // Only when the uploader actually declared one — it is absent on most
  // videos, and absence is not evidence of non-Spanish.
  if (
    row.default_audio_language &&
    !normalizeText(row.default_audio_language).startsWith(
      FILTER.AUDIO_LANGUAGE_PREFIX
    )
  ) {
    return reject(REJECT_REASONS.AUDIO_LANGUAGE_NOT_ES);
  }
  if (looksDubbed(row.title, row.description)) {
    return reject(REJECT_REASONS.DUBBING_SUSPECTED);
  }

  // --- audience signal ---------------------------------------------------
  // Null views is treated as zero: a video whose stats are hidden entirely
  // is exactly as unvetted as one with no views.
  if ((row.view_count ?? 0) < FILTER.MIN_VIEW_COUNT) {
    return reject(REJECT_REASONS.VIEW_COUNT_TOO_LOW);
  }
  // Hidden likes (null) are UNKNOWN, not zero — plenty of good channels
  // disable the like count, and scoring them 0 would reject them all. The
  // view threshold above still applies, so nothing unvetted slips through.
  if (row.like_count !== null && row.view_count !== null && row.view_count > 0) {
    if (row.like_count / row.view_count < FILTER.MIN_LIKE_RATIO) {
      return reject(REJECT_REASONS.LIKE_RATIO_TOO_LOW);
    }
  }

  // --- source diversity --------------------------------------------------
  if (row.channel_id) {
    const already = context.eligibleCountsByChannel.get(row.channel_id) ?? 0;
    if (already > FILTER.MAX_ELIGIBLE_PER_CHANNEL) {
      return reject(REJECT_REASONS.CHANNEL_SATURATED);
    }
  }

  return { eligible: true };
}
