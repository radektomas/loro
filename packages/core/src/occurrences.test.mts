import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findWordOccurrences, pickReplayOccurrence } from './occurrences.ts';
import type { Video } from './types.ts';

/** Word spans default to 0.4s — comfortably over the 0.2s audibility floor. */
function video(
  id: string,
  cues: string[][],
  over: Record<string, unknown> = {}
): Video {
  return {
    id,
    youtubeId: `yt-${id}`,
    cues: cues.map((words, ci) => ({
      start: ci,
      end: ci + 1,
      translations: {},
      words: words.map((text, wi) => ({
        text,
        start: ci + wi * 0.5,
        end: ci + wi * 0.5 + 0.4,
      })),
    })),
    ...over,
  } as never;
}

describe('findWordOccurrences', () => {
  it('finds every audible occurrence across videos, accent-exactly', () => {
    const occ = findWordOccurrences(
      [video('a', [['está', 'aquí'], ['esta', 'casa']]), video('b', [['está']])],
      'está'
    );
    // "esta" (no accent) must NOT match "está" — accent-exact rule.
    assert.deepEqual(
      occ.map((o) => [o.videoId, o.cueIndex]),
      [['a', 0], ['b', 0]]
    );
    assert.equal(occ[0].youtubeId, 'yt-a');
  });

  it('skips occurrences below the audibility floor', () => {
    const v = video('a', [['perro']]);
    v.cues[0].words[0].end = v.cues[0].words[0].start + 0.1; // 0.1s mumble
    assert.deepEqual(findWordOccurrences([v], 'perro'), []);
  });

  it('matches loosely on punctuation but keeps ñ distinct', () => {
    const occ = findWordOccurrences([video('a', [['¡Mañana!']])], 'mañana');
    assert.equal(occ.length, 1);
    assert.deepEqual(findWordOccurrences([video('a', [['manana']])], 'mañana'), []);
  });
});

describe('pickReplayOccurrence', () => {
  const occ = (videoId: string, cueIndex: number, youtubeId: string | null = `yt-${videoId}`) => ({
    videoId,
    youtubeId,
    cueIndex,
    start: cueIndex,
    end: cueIndex + 0.4,
  });
  const first = () => 0;

  it('prefers an occurrence in a different video', () => {
    const picked = pickReplayOccurrence(
      [occ('a', 0), occ('a', 3), occ('b', 1)],
      { videoId: 'a', cueIndex: 0 },
      { random: first }
    );
    assert.equal(picked!.videoId, 'b');
  });

  it('falls back to another cue of the same video', () => {
    const picked = pickReplayOccurrence(
      [occ('a', 0), occ('a', 3)],
      { videoId: 'a', cueIndex: 0 },
      { random: first }
    );
    assert.deepEqual([picked!.videoId, picked!.cueIndex], ['a', 3]);
  });

  it('returns null when only the source cue exists — a first-class state', () => {
    assert.equal(
      pickReplayOccurrence([occ('a', 0)], { videoId: 'a', cueIndex: 0 }),
      null
    );
    assert.equal(pickReplayOccurrence([], { videoId: 'a', cueIndex: 0 }), null);
  });

  it('requireYoutube filters hosted clips out', () => {
    assert.equal(
      pickReplayOccurrence(
        [occ('b', 1, null)],
        { videoId: 'a', cueIndex: 0 },
        { requireYoutube: true, random: first }
      ),
      null
    );
  });
});
