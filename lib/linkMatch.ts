/**
 * Which Instagram post is this /cut reel? Compared two ways: the cover's
 * perceptual hash (dHash, 64 bits) against our rendered frames, and the
 * hook text read off the cover against the reel's hook. A guess is made only
 * when the best candidate is close AND clearly better than the runner-up, so
 * a repost or two near-identical reels never get linked by coin flip.
 * Plain relative imports: node --test loads this.
 */

/** Bits that differ between two hex hashes of equal length. */
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export type Candidate = { mediaId: string; hashDist: number | null; textSim: number | null };

export const MATCH_HASH = 12;
export const MATCH_TEXT = 0.75;
const GAP_HASH = 6;
const GAP_TEXT = 0.15;
/** Cover text this unlike the reel's hook contradicts a close hash. */
const CONTRADICT_TEXT = 0.4;
/** A lone candidate on the hash alone must be this close. */
const LONE_HASH = 6;

export function pickMatch(cands: Candidate[]): string | null {
  const dist = (c: Candidate) => c.hashDist ?? Infinity;
  const sim = (c: Candidate) => c.textSim ?? 0;
  const sorted = [...cands].sort((a, b) => dist(a) - dist(b) || sim(b) - sim(a));
  const [best, next] = sorted;
  if (!best) return null;
  const close = dist(best) <= MATCH_HASH || sim(best) >= MATCH_TEXT;
  if (!close) return null;
  // the cover's own text names a different hook: a look-alike from the same filming session
  if (best.hashDist != null && best.textSim != null && best.textSim < CONTRADICT_TEXT) return null;
  if (!next) {
    // nothing to beat: both signals must agree, or the cover is near-identical
    const both = dist(best) <= MATCH_HASH && sim(best) >= MATCH_TEXT;
    return both || dist(best) <= LONE_HASH ? best.mediaId : null;
  }
  if (next) {
    const hashGap = dist(next) - dist(best); // Infinity - Infinity = NaN → not a gap
    const textGap = sim(best) - sim(next);
    if (!(hashGap >= GAP_HASH) && !(textGap >= GAP_TEXT)) return null;
  }
  return best.mediaId;
}
