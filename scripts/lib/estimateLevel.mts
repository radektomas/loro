/**
 * Estimate a CEFR-ish listening level for a clip from its speech rate.
 *
 * WHY SPEECH RATE. For a *listening* feed the dominant difficulty is how fast
 * the words arrive, not how rare they are — a learner who knows every word in
 * a sentence still fails to parse it at 240 wpm. We have exact per-word
 * timings from the ASR track, so rate is the one difficulty signal we can
 * measure honestly and cheaply. It replaced a hardcoded `level: 'A2'` on
 * every video, which was a claim we had not earned: the real spread across
 * the first published batch was 96-237 wpm, a 2.5x range.
 *
 * WHAT THIS IS NOT. It ignores vocabulary rarity, accent, idiom density and
 * audio clarity, all of which matter. It is a defensible first ordering, not
 * a placement test — treat the label as "how fast is this", and revisit once
 * there is real per-user data on which clips people actually replay.
 *
 * Rate is measured over SPEECH time (summed cue durations), not wall-clock:
 * a 60s clip with 15s of talking is not slow, it is sparse, and dividing by
 * 60 would mislabel dense speech as beginner-friendly.
 *
 * Bands are for Spanish, which is syllable-timed and runs faster in
 * words-per-minute than English at equivalent difficulty. Native short-form
 * delivery sits around 180-200 wpm; that is deliberately B1, not B2, because
 * "a normal creator talking normally" is the middle of this corpus, not the
 * top of it.
 */

import type { CueOut } from './json3ToCues.mts';

export type EstimatedLevel = 'A1' | 'A2' | 'B1' | 'B2';

/** Upper bound (exclusive) of each band, in words per minute of speech. */
const BANDS: readonly { under: number; level: EstimatedLevel }[] = [
  { under: 120, level: 'A1' },
  { under: 165, level: 'A2' },
  { under: 210, level: 'B1' },
  { under: Infinity, level: 'B2' },
];

/** Too few words to rate: the estimate would be noise, so stay conservative. */
const MIN_WORDS_TO_RATE = 12;
const FALLBACK: EstimatedLevel = 'A2';

/** Words per minute of actual speech, or null when unmeasurable. */
export function speechRate(cues: readonly CueOut[]): number | null {
  let words = 0;
  let seconds = 0;
  for (const cue of cues) {
    words += cue.words.length;
    const span = cue.end - cue.start;
    if (Number.isFinite(span) && span > 0) seconds += span;
  }
  if (words < MIN_WORDS_TO_RATE || seconds <= 0) return null;
  return words / (seconds / 60);
}

export function estimateLevel(cues: readonly CueOut[]): EstimatedLevel {
  const wpm = speechRate(cues);
  if (wpm === null) return FALLBACK;
  return BANDS.find((b) => wpm < b.under)!.level;
}
