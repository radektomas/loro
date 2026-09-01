import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findWordOccurrences,
  pickFirstBlankTarget,
  pickReplayOccurrence,
  pickReviewTarget,
} from './occurrences.ts';
import type { SavedWord, Video } from './types.ts';

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

  it('records which word of the cue matched', () => {
    const occ = findWordOccurrences([video('a', [['y', 'el', 'perro']])], 'perro');
    assert.deepEqual([occ[0].cueIndex, occ[0].wordIndex], [0, 2]);
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
    wordIndex: 0,
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

describe('pickReviewTarget', () => {
  const NOW = 10_000_000;
  /** Due an hour ago and saved long enough ago to clear the plan's grace. */
  const saved = (text: string, videoId: string, over: Partial<SavedWord> = {}) =>
    ({
      text,
      translation: text,
      videoId,
      cueIndex: 0,
      source: 'user',
      savedAt: NOW - 60 * 60 * 1000,
      state: 'learning',
      box: 1,
      dueAt: NOW - 60 * 1000,
      correct: 0,
      incorrect: 0,
      lastReviewedAt: null,
      ...over,
    }) as SavedWord;

  const target = saved('perro', 'full');

  /** Six cues of more urgent words, then the target — past every plan cap. */
  const full = video('full', [
    ['uno'],
    ['dos'],
    ['tres'],
    ['cuatro'],
    ['cinco'],
    ['seis'],
    ['perro'],
  ]);
  const clear = video('clear', [['hola', 'perro']]);
  /** box 0 beats the target's box 1 — these fill the plan first. */
  const crowd = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'].map((w) =>
    saved(w, 'full', { box: 0 })
  );

  it('lands on the saved-from video even when its plan is full', () => {
    // The asked-for word is exempt from the caps, so a crowded video is no
    // longer a reason to send the user somewhere else.
    assert.deepEqual(
      pickReviewTarget([full, clear], target, [...crowd, target], { now: NOW }),
      { videoId: 'full', cueIndex: 6, startsAt: 6, willBlank: true }
    );
  });

  it('reports the cue and second the plan settled on', () => {
    const landing = pickReviewTarget([full, clear], target, [target], {
      now: NOW,
      preferVideoId: 'clear',
    });
    // 'perro' is the second word of clear's only cue: start 0 + 1 * 0.5.
    assert.deepEqual(landing, {
      videoId: 'clear',
      cueIndex: 0,
      startsAt: 0.5,
      willBlank: true,
    });
  });

  it('names a video anyway when nothing would blank the word', () => {
    // Not due for another hour: no video can blank it, and the caller still
    // gets somewhere honest to land.
    const later = saved('perro', 'full', { dueAt: NOW + 60 * 60 * 1000 });
    assert.deepEqual(pickReviewTarget([full, clear], later, [later], { now: NOW }), {
      videoId: 'full',
      cueIndex: 6,
      startsAt: 6,
      willBlank: false,
    });
  });

  it('a word saved seconds ago is still asked for by name', () => {
    // computeBlankPlan's one-minute grace does not apply to the word the user
    // explicitly asked to review.
    const fresh = saved('perro', 'clear', { savedAt: NOW - 10_000 });
    assert.equal(
      pickReviewTarget([clear], fresh, [fresh], { now: NOW })?.willBlank,
      true
    );
  });

  it('returns null when no embeddable video speaks the word', () => {
    const hosted = video('hosted', [['perro']], { youtubeId: null });
    assert.equal(pickReviewTarget([hosted], target, [target], { now: NOW }), null);
    assert.equal(pickReviewTarget([clear], saved('gato', 'x'), [], { now: NOW }), null);
  });
});

/**
 * The Words tab's review CTA. The scenario that forced this function into
 * existence (2026-09-01, on device): the most urgent due words were saved
 * from videos the catalog has since pruned, the old five-candidate scan
 * struck out, and the button switched tabs with no jump parked — the user
 * landed on whatever paused video the feed was left on.
 */
describe('pickFirstBlankTarget', () => {
  const NOW = 10_000_000;
  const saved = (text: string, videoId: string, over: Partial<SavedWord> = {}) =>
    ({
      text,
      translation: text,
      videoId,
      cueIndex: 0,
      source: 'user',
      savedAt: NOW - 60 * 60 * 1000,
      state: 'learning',
      box: 1,
      dueAt: NOW - 60 * 1000,
      correct: 0,
      incorrect: 0,
      lastReviewedAt: null,
      learnedAt: null,
      ...over,
    }) as SavedWord;

  const clear = video('clear', [['hola', 'perro']]);
  /** Words the catalog no longer speaks — the pruned-video graveyard, and
      MORE of them than the old scan's cap of five ever looked at. */
  const ghosts = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'].map((w) =>
    saved(w, 'pruned', { state: 'lapsed', box: 0 })
  );

  it('walks past every lost word to the first that blanks — no cap', () => {
    const findable = saved('perro', 'clear');
    const found = pickFirstBlankTarget([clear], [...ghosts, findable], [
      ...ghosts,
      findable,
    ], { now: NOW });
    assert.equal(found?.word.text, 'perro');
    assert.deepEqual(found?.landing, {
      videoId: 'clear',
      cueIndex: 0,
      startsAt: 0.5,
      willBlank: true,
    });
  });

  it('takes the caller\'s urgency order — the first blankable candidate wins', () => {
    const first = saved('hola', 'clear');
    const second = saved('perro', 'clear');
    const found = pickFirstBlankTarget([clear], [first, second], [first, second], {
      now: NOW,
    });
    assert.equal(found?.word.text, 'hola');
  });

  it('prefers the video the word was saved from', () => {
    const elsewhere = video('elsewhere', [['perro', 'grande']]);
    const word = saved('perro', 'elsewhere');
    const found = pickFirstBlankTarget([clear, elsewhere], [word], [word], {
      now: NOW,
    });
    assert.equal(found?.landing.videoId, 'elsewhere');
  });

  it('falls back to a spoken-only landing when nothing will blank', () => {
    // Spoken in the catalog but not due for an hour: the plan refuses it, and
    // the caller still gets the word's own second to land on, flagged.
    const later = saved('perro', 'clear', { dueAt: NOW + 60 * 60 * 1000 });
    const found = pickFirstBlankTarget([clear], [...ghosts, later], [later], {
      now: NOW,
    });
    assert.deepEqual(found, {
      word: later,
      landing: { videoId: 'clear', cueIndex: 0, startsAt: 0.5, willBlank: false },
    });
  });

  it('returns null only when no candidate is spoken anywhere', () => {
    assert.equal(pickFirstBlankTarget([clear], ghosts, ghosts, { now: NOW }), null);
    assert.equal(pickFirstBlankTarget([clear], [], [], { now: NOW }), null);
  });
});
