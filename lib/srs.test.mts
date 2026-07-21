import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeBlankPlan, grade, normalizeAnswer } from './srs.ts';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

type W = { text: string; start: number; end: number };

function video(id: string, cues: string[][]) {
  return {
    id,
    cues: cues.map((words, ci) => ({
      start: ci,
      end: ci + 1,
      text: words.join(' '),
      translation: '',
      words: words.map(
        (text, wi): W => ({ text, start: ci + wi * 0.1, end: ci + wi * 0.1 + 0.4 })
      ),
    })),
  } as never;
}

/** A saved word that is due now and old enough to be blanked. */
function saved(text: string, videoId: string, over: Record<string, unknown> = {}) {
  return {
    text,
    translation: 'x',
    videoId,
    cueIndex: 0,
    state: 'learning',
    box: 1,
    dueAt: NOW - MIN,
    savedAt: NOW - 10 * MIN,
    correct: 0,
    incorrect: 0,
    lastReviewedAt: null,
    ...over,
  } as never;
}

describe('computeBlankPlan — cross-video review', () => {
  it('reviews a word in a video it was NOT saved from', () => {
    // The whole point: the feed never repeats a slide, so a word locked to
    // its origin video could never be reviewed at all.
    const plan = computeBlankPlan(
      video('vid-B', [['hola'], ['x'], ['vamos', 'ahora']]),
      [saved('vamos', 'vid-A')],
      NOW
    );
    assert.deepEqual([...plan.keys()], [2]);
    assert.equal(plan.get(2)!.text, 'vamos');
  });

  it('keeps the origin videoId so grading and /vocab stay attributed', () => {
    const plan = computeBlankPlan(
      video('vid-B', [['vamos'], ['x']]),
      [saved('vamos', 'vid-A')],
      NOW
    );
    assert.equal(plan.get(0)!.videoId, 'vid-A');
  });

  it('still reviews within the origin video', () => {
    const plan = computeBlankPlan(
      video('vid-A', [['hola'], ['vamos']]),
      [saved('vamos', 'vid-A')],
      NOW
    );
    assert.equal(plan.get(1)!.text, 'vamos');
  });

  it('matches ignoring case and accents', () => {
    const plan = computeBlankPlan(
      video('vid-B', [['¿Dónde!']]),
      [saved('donde', 'vid-A')],
      NOW
    );
    assert.equal(plan.size, 1);
  });

  it('does not blank a word the video never speaks', () => {
    const plan = computeBlankPlan(
      video('vid-B', [['hola'], ['adios']]),
      [saved('vamos', 'vid-A')],
      NOW
    );
    assert.equal(plan.size, 0);
  });
});

describe('computeBlankPlan — scheduling gates', () => {
  it('skips words that are not due yet', () => {
    const plan = computeBlankPlan(
      video('v', [['vamos']]),
      [saved('vamos', 'a', { dueAt: NOW + MIN })],
      NOW
    );
    assert.equal(plan.size, 0);
  });

  it('skips words saved less than a minute ago', () => {
    const plan = computeBlankPlan(
      video('v', [['vamos']]),
      [saved('vamos', 'a', { savedAt: NOW - 10 })],
      NOW
    );
    assert.equal(plan.size, 0);
  });

  it('skips words with no audible span — never heard, cannot be recalled', () => {
    const v = video('v', [['vamos']]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (v as any).cues[0].words[0].end = (v as any).cues[0].words[0].start;
    assert.equal(computeBlankPlan(v, [saved('vamos', 'a')], NOW).size, 0);
  });
});

describe('computeBlankPlan — pacing', () => {
  it('never blanks the same word twice in one video', () => {
    const plan = computeBlankPlan(
      video('v', [['x'], ['y'], ['vamos'], ['z'], ['vamos']]),
      [saved('vamos', 'a')],
      NOW
    );
    assert.equal(plan.size, 1);
  });

  it('allows at most one blank inside the first two cues', () => {
    const plan = computeBlankPlan(
      video('v', [['uno'], ['dos'], ['tres']]),
      [saved('uno', 'a'), saved('dos', 'a'), saved('tres', 'a')],
      NOW
    );
    assert.deepEqual([...plan.keys()], [0, 2]);
  });

  it('caps at five blanks per video', () => {
    const words = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'];
    const plan = computeBlankPlan(
      video('v', [['pad'], ['pad'], ...words.map((w) => [w])]),
      words.map((w) => saved(w, 'a')),
      NOW
    );
    assert.equal(plan.size, 5);
  });

  it('prefers the lowest box when several due words share a cue', () => {
    const plan = computeBlankPlan(
      video('v', [['pad'], ['pad'], ['facil', 'dificil']]),
      [saved('facil', 'a', { box: 3 }), saved('dificil', 'a', { box: 0 })],
      NOW
    );
    assert.equal(plan.get(2)!.text, 'dificil');
  });

  it('picks the more urgent copy when a word was saved from two videos', () => {
    const plan = computeBlankPlan(
      video('v', [['vamos']]),
      [saved('vamos', 'a', { box: 4 }), saved('vamos', 'b', { box: 0 })],
      NOW
    );
    assert.equal(plan.size, 1);
    assert.equal(plan.get(0)!.videoId, 'b');
  });
});

describe('normalizeAnswer / grade', () => {
  it('compares accents and punctuation loosely', () => {
    assert.equal(normalizeAnswer('¡Están!'), normalizeAnswer('estan'));
  });

  it('promotes on correct and resets to box 0 on wrong', () => {
    assert.equal(grade(saved('x', 'a', { box: 2 }), true, NOW).box, 3);
    const wrong = grade(saved('x', 'a', { box: 4 }), false, NOW);
    assert.equal(wrong.box, 0);
    assert.equal(wrong.state, 'lapsed');
  });
});
