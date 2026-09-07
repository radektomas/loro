import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  answeredCorrectToday,
  bumpDay,
  countForDay,
  daysMeetingGoal,
  dayKey,
  distinctWords,
  isLearned,
  learnedThisWeek,
  splitFunctionWords,
  weekKeys,
} from './progress.ts';
import type { SavedWord } from './types.ts';

/**
 * "Learned" and the daily tally — run with `npm test`.
 *
 * isLearned is the one definition the Progress page, the day-done card and
 * the week card all read, so its boundaries are pinned here: a stamp always
 * counts, a known word with two answers counts, and the two shapes that
 * used to inflate the number — deck grants and one-shot fills — do not.
 */

/** Local noon, so a timezone offset can never shift the calendar day. */
function at(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour, 0, 0).getTime();
}

// 2026-09-09 is a Wednesday; its week runs Mon 09-07 .. Sun 09-13.
const NOW = at(2026, 9, 9);

function word(over: Partial<SavedWord> = {}): SavedWord {
  return {
    text: 'ciudad',
    translation: 'city',
    videoId: 'vid',
    cueIndex: 1,
    source: 'user',
    savedAt: NOW - 3 * 86_400_000,
    state: 'learning',
    box: 1,
    dueAt: NOW + 1000,
    correct: 1,
    incorrect: 0,
    lastReviewedAt: NOW - 1000,
    learnedAt: null,
    ...over,
  };
}

describe('isLearned', () => {
  it('counts a stamped crossing, whatever the counts say', () => {
    assert.equal(isLearned(word({ state: 'known', box: 3, learnedAt: NOW })), true);
  });

  it('counts a restored known word with two or more correct answers', () => {
    assert.equal(isLearned(word({ state: 'known', box: 5, correct: 2 })), true);
    assert.equal(isLearned(word({ state: 'known', box: 4, correct: 4 })), true);
  });

  it('does not count a starter-deck grant', () => {
    assert.equal(
      isLearned(word({ source: 'deck', state: 'known', box: 3, correct: 0 })),
      false
    );
  });

  it('does not count a one-shot level fill', () => {
    assert.equal(isLearned(word({ state: 'known', box: 4, correct: 1 })), false);
  });

  it('does not count a word still learning, however many answers', () => {
    assert.equal(isLearned(word({ state: 'learning', box: 2, correct: 5 })), false);
  });
});

describe('distinctWords', () => {
  it('folds the same word saved from several videos into one', () => {
    const out = distinctWords([
      word({ text: 'de', videoId: 'a', box: 2 }),
      word({ text: 'De', videoId: 'b', box: 3 }),
      word({ text: 'de', videoId: 'c', box: 1 }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].videoId, 'b');
  });

  it('keeps genuinely different words apart', () => {
    const out = distinctWords([word({ text: 'casa' }), word({ text: 'cosa' })]);
    assert.equal(out.length, 2);
  });

  it('prefers the later stamp on a box tie', () => {
    const out = distinctWords([
      word({ text: 'sí', videoId: 'a', box: 3, learnedAt: 10 }),
      word({ text: 'si', videoId: 'b', box: 3, learnedAt: 20 }),
    ]);
    assert.equal(out[0].videoId, 'b');
  });
});

describe('weekKeys', () => {
  it('is the Mon..Sun week around now', () => {
    assert.deepEqual(weekKeys(NOW), [
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13',
    ]);
  });
});

describe('learnedThisWeek', () => {
  it('keeps only stamps inside the current local week, freshest first', () => {
    const out = learnedThisWeek(
      [
        word({ text: 'lunes', learnedAt: at(2026, 9, 7, 8) }),
        word({ text: 'domingo', learnedAt: at(2026, 9, 6, 23) }), // last week
        word({ text: 'hoy', learnedAt: at(2026, 9, 9, 9) }),
        word({ text: 'nunca' }), // no stamp
      ],
      NOW
    );
    assert.deepEqual(
      out.map((w) => w.text),
      ['hoy', 'lunes']
    );
  });

  it('ignores a restored known word with no stamp — no invented date', () => {
    const out = learnedThisWeek([word({ state: 'known', box: 5, correct: 3 })], NOW);
    assert.equal(out.length, 0);
  });

  it('shows one chip per distinct word', () => {
    const out = learnedThisWeek(
      [
        word({ text: 'que', videoId: 'a', learnedAt: at(2026, 9, 8) }),
        word({ text: 'qué', videoId: 'b', learnedAt: at(2026, 9, 9) }),
      ],
      NOW
    );
    assert.equal(out.length, 1);
  });
});

describe('splitFunctionWords', () => {
  it('sends glue to the small pile and keeps content words', () => {
    const { content, small } = splitFunctionWords([
      { text: 'de' },
      { text: 'Ciudad' },
      { text: 'está' },
      { text: 'paisaje' },
    ]);
    assert.deepEqual(content.map((w) => w.text), ['Ciudad', 'paisaje']);
    assert.deepEqual(small.map((w) => w.text), ['de', 'está']);
  });
});

describe('daily counts', () => {
  it('bumpDay increments today and starts a new day at one', () => {
    const day = dayKey(NOW);
    const once = bumpDay({}, day);
    assert.equal(countForDay(once, day), 1);
    assert.equal(countForDay(bumpDay(once, day), day), 2);
  });

  it('bumpDay prunes to the trailing window', () => {
    const counts = { '2026-01-01': 3, '2026-01-02': 1, '2026-01-03': 2 };
    const out = bumpDay(counts, '2026-01-04', 2);
    assert.deepEqual(Object.keys(out).sort(), ['2026-01-03', '2026-01-04']);
  });

  it('countForDay reads garbage as zero', () => {
    assert.equal(countForDay({ x: -2 }, 'x'), 0);
    assert.equal(countForDay({ x: Number.NaN }, 'x'), 0);
    assert.equal(countForDay({}, 'x'), 0);
  });

  it('daysMeetingGoal counts only days at or over the goal', () => {
    const counts = { '2026-09-07': 5, '2026-09-08': 2, '2026-09-09': 7 };
    assert.equal(daysMeetingGoal(counts, weekKeys(NOW), 5), 2);
    assert.equal(daysMeetingGoal(counts, weekKeys(NOW), 1), 3);
  });
});

describe('answeredCorrectToday', () => {
  it('keeps words whose last answer was today and right, freshest first', () => {
    const out = answeredCorrectToday(
      [
        word({ text: 'uno', lastReviewedAt: at(2026, 9, 9, 9) }),
        word({ text: 'dos', lastReviewedAt: at(2026, 9, 9, 11) }),
        word({ text: 'ayer', lastReviewedAt: at(2026, 9, 8, 23) }),
        word({ text: 'mal', state: 'lapsed', incorrect: 1, lastReviewedAt: at(2026, 9, 9, 10) }),
        word({ text: 'nunca', correct: 0, lastReviewedAt: null }),
      ],
      NOW
    );
    assert.deepEqual(out.map((w) => w.text), ['dos', 'uno']);
  });
});
