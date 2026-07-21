import type { Json3, Json3Event } from './captionFetch.mts';

/**
 * YouTube json3 caption payload -> Loro's Cue[]/Word[] shape.
 *
 * The cue chunker is a FAITHFUL PORT of transcribe.py (group_into_cues +
 * merge_orphans) — same constants, same boundary scoring, same tie-breaks —
 * so caption-derived videos read exactly like Whisper-derived ones. The
 * subtle bits ported deliberately:
 *   - the overflow test uses the NEXT word's end, not the buffer's end
 *   - boundary ties prefer the LATEST split (score >= best), so cues pack full
 *   - merge_orphans caps at MAX_WORDS + 3 and merges into the time-closest
 *     neighbour, restarting the scan after every merge
 *
 * One honest difference: ASR captions carry word STARTS only, and usually no
 * punctuation. Word ends are synthesised (next start, capped), so the
 * sentence/clause boundary rules rarely fire and chunking leans on the pause
 * rule and the caps. That gives slightly more mechanical cue breaks than
 * Whisper's — acceptable, and exactly why the constants stay identical.
 */

export type CueWord = { text: string; start: number; end: number };
export type CueOut = {
  start: number;
  end: number;
  words: CueWord[];
  translations: Record<string, string>;
};

// transcribe.py constants — keep in lockstep.
const MAX_WORDS_PER_CUE = 9;
const MAX_SECONDS_PER_CUE = 4.2;
const MIN_WORDS_PER_CUE = 3;

/**
 * Synthesised word length cap. ASR gives no word ends; a word "ends" at the
 * next word's start unless the speaker paused — then capping the word at
 * this length leaves a visible gap, which is what the chunker's pause rule
 * (gap > 0.5s) and SubtitleTrack's karaoke highlight both key off.
 */
const MAX_WORD_SECONDS = 0.6;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Non-speech annotations the ASR track interleaves: [Música], [Aplausos]… */
const ANNOTATION = /^\[.+\]$/;

/** Flatten json3 events into timed words. */
export function json3ToWords(payload: Json3): CueWord[] {
  type Raw = { text: string; start: number; eventEnd: number };
  const raw: Raw[] = [];
  for (const event of payload.events ?? []) {
    const { tStartMs, dDurationMs, segs } = event as Json3Event;
    if (tStartMs === undefined || !segs) continue;
    const eventEnd =
      dDurationMs !== undefined ? (tStartMs + dDurationMs) / 1000 : Infinity;
    for (const seg of segs) {
      const text = (seg.utf8 ?? '').trim();
      if (!text || ANNOTATION.test(text)) continue;
      const start = (tStartMs + (seg.tOffsetMs ?? 0)) / 1000;
      raw.push({ text, start, eventEnd });
    }
  }
  raw.sort((a, b) => a.start - b.start);

  return raw.map((word, i) => {
    const next = raw[i + 1];
    const hardEnd = next ? next.start : word.eventEnd;
    const end = Math.min(
      Number.isFinite(hardEnd) ? hardEnd : word.start + MAX_WORD_SECONDS,
      word.start + MAX_WORD_SECONDS
    );
    return {
      text: word.text,
      start: round3(word.start),
      end: round3(Math.max(end, word.start + 0.05)),
    };
  });
}

// ------------------------------------------------------ transcribe.py port

const isSentenceEnd = (text: string): boolean =>
  text.length > 0 && '.?!…'.includes(text[text.length - 1]);

/** How good a place is it to split AFTER words[i]? Higher = cleaner break. */
function boundaryScore(words: readonly CueWord[], i: number): number {
  const text = words[i].text;
  if (isSentenceEnd(text)) return 100.0;
  if (text.length > 0 && ',;:'.includes(text[text.length - 1])) return 50.0;
  if (i + 1 < words.length) {
    const gap = words[i + 1].start - words[i].end;
    if (gap > 0.5) return 40.0 + gap * 20.0;
  }
  return 0.0;
}

export function groupIntoCues(words: readonly CueWord[]): CueOut[] {
  if (words.length === 0) return [];
  const cues: CueOut[] = [];

  const emit = (indices: readonly number[]): void => {
    const cueWords = indices.map((k) => words[k]);
    cues.push({
      start: cueWords[0].start,
      end: cueWords[cueWords.length - 1].end,
      words: cueWords,
      translations: {},
    });
  };

  let buffer: number[] = [];
  for (let i = 0; i < words.length; i++) {
    buffer.push(i);

    // End of sentence — always break right here.
    if (isSentenceEnd(words[i].text)) {
      emit(buffer);
      buffer = [];
      continue;
    }

    const nxt = i + 1;
    if (nxt >= words.length) continue;

    const wouldOverflow =
      buffer.length + 1 > MAX_WORDS_PER_CUE ||
      words[nxt].end - words[buffer[0]].start > MAX_SECONDS_PER_CUE;
    if (!wouldOverflow) continue;

    // Adding the next word overflows. Look back for the best boundary; on
    // ties prefer the latest, so cues pack fuller.
    let bestPos = buffer.length - 1;
    let bestScore = 0.0;
    for (let pos = 0; pos < buffer.length; pos++) {
      const score = boundaryScore(words, buffer[pos]);
      if (score >= bestScore) {
        bestPos = pos;
        bestScore = score;
      }
    }

    if (bestScore > 0) {
      emit(buffer.slice(0, bestPos + 1));
      buffer = buffer.slice(bestPos + 1);
    } else {
      emit(buffer);
      buffer = [];
    }
  }
  if (buffer.length > 0) emit(buffer);

  return mergeOrphans(cues);
}

/** Fold sub-minimum cues into their nearest neighbour (transcribe.py port). */
export function mergeOrphans(cues: CueOut[]): CueOut[] {
  const HARD_CAP = MAX_WORDS_PER_CUE + 3;
  const MIN_SECONDS = 0.8;

  const isOrphan = (c: CueOut): boolean =>
    c.words.length < MIN_WORDS_PER_CUE || c.end - c.start < MIN_SECONDS;

  const merged = (a: CueOut, b: CueOut): CueOut => {
    const ws = [...a.words, ...b.words];
    return {
      start: ws[0].start,
      end: ws[ws.length - 1].end,
      words: ws,
      translations: {},
    };
  };

  while (cues.length > 1) {
    let target: [number, number] | null = null;
    for (let idx = 0; idx < cues.length; idx++) {
      const cue = cues[idx];
      if (!isOrphan(cue)) continue;

      const options: [number, number][] = []; // [time gap, neighbour index]
      if (idx > 0) {
        const prev = cues[idx - 1];
        if (prev.words.length + cue.words.length <= HARD_CAP) {
          options.push([cue.start - prev.end, idx - 1]);
        }
      }
      if (idx + 1 < cues.length) {
        const next = cues[idx + 1];
        if (cue.words.length + next.words.length <= HARD_CAP) {
          options.push([next.start - cue.end, idx + 1]);
        }
      }
      if (options.length === 0) continue; // can't merge without blowing the cap

      options.sort((a, b) => a[0] - b[0]);
      const neighbour = options[0][1];
      target = [Math.min(idx, neighbour), Math.max(idx, neighbour)];
      break;
    }

    if (!target) break;
    const [lo, hi] = target;
    cues.splice(lo, hi - lo + 1, merged(cues[lo], cues[hi]));
  }

  return cues;
}

/** The full conversion: caption payload in, feed-ready cues out. */
export function json3ToCues(payload: Json3): CueOut[] {
  return groupIntoCues(json3ToWords(payload));
}
