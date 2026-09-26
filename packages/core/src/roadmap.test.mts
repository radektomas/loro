import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRoadmap, isLocked, lockedKeys, newlyOpened, nextUp, OPEN_SLOTS } from './roadmap.ts';
import { dueCount, nextDueAt, readyWords } from './progress.ts';
import { computeBlankPlan, grade, isEarlyAnswer, isTrained, trainWord, TRAINED_FIRST_ASK_MS } from './srs.ts';
import type { SavedWord, Video } from './types.ts';

/**
 * The word roadmap — run with `npm test`. Pins the three promises the
 * Words tab path makes: save order, a fixed open window that learning
 * advances, and locked words that are neither asked nor counted.
 */

const NOW = Date.UTC(2026, 8, 26, 12);
const DAY = 86_400_000;

function word(text: string, i: number, over: Partial<SavedWord> = {}): SavedWord {
  return {
    text,
    translation: `${text}-en`,
    videoId: 'vid',
    cueIndex: 0,
    source: 'user',
    savedAt: NOW - 100 * DAY + i * 1000,
    state: 'learning',
    box: 1,
    dueAt: NOW - 1000,
    correct: 1,
    incorrect: 0,
    lastReviewedAt: NOW - DAY,
    learnedAt: null,
    ...over,
  };
}

const learned = { state: 'known' as const, box: 3, correct: 3, learnedAt: NOW - DAY, dueAt: NOW + DAY };

/** n words w0..w(n-1), saved in that order. */
function many(n: number): SavedWord[] {
  return Array.from({ length: n }, (_, i) => word(`w${i}`, i));
}

describe('buildRoadmap', () => {
  it('orders by first save, opens OPEN_SLOTS, locks the rest', () => {
    const words = many(OPEN_SLOTS + 5).reverse();
    const path = buildRoadmap(words);
    assert.deepEqual(path.map((n) => n.key).slice(0, 3), ['w0', 'w1', 'w2']);
    assert.equal(path.filter((n) => n.status === 'open').length, OPEN_SLOTS);
    assert.equal(path.filter((n) => n.status === 'locked').length, 5);
    assert.equal(path[OPEN_SLOTS].status, 'locked');
  });

  it('a learned word frees its slot for the next saved word', () => {
    const words = many(OPEN_SLOTS + 2);
    words[3] = { ...words[3], ...learned };
    const path = buildRoadmap(words);
    const byKey = new Map(path.map((n) => [n.key, n.status]));
    assert.equal(byKey.get('w3'), 'done');
    assert.equal(byKey.get(`w${OPEN_SLOTS}`), 'open');
    assert.equal(byKey.get(`w${OPEN_SLOTS + 1}`), 'locked');
  });

  it('draws learned words together first, then open, then waiting', () => {
    const words = many(OPEN_SLOTS + 3);
    words[5] = { ...words[5], ...learned, learnedAt: NOW - 2 * DAY };
    words[2] = { ...words[2], ...learned, learnedAt: NOW - DAY };
    const path = buildRoadmap(words);
    assert.deepEqual(path.slice(0, 3).map((n) => n.key), ['w5', 'w2', 'w0']);
    assert.deepEqual(path.slice(0, 3).map((n) => n.status), ['done', 'done', 'open']);
    const firstLocked = path.findIndex((n) => n.status === 'locked');
    assert.ok(path.slice(firstLocked).every((n) => n.status === 'locked'));
  });

  it('nextUp is the first open word in save order', () => {
    const words = many(5);
    words[0] = { ...words[0], ...learned };
    assert.equal(nextUp(words)?.key, 'w1');
  });

  it('a slipped word takes a slot again', () => {
    const words = many(OPEN_SLOTS + 1);
    words[0] = { ...words[0], state: 'lapsed', box: 0, learnedAt: NOW - 5 * DAY };
    assert.equal(buildRoadmap(words)[0].status, 'open');
  });

  it('one node per surface, placed at its FIRST save', () => {
    const words = [word('casa', 5), word('perro', 3), word('Casa', 1, { videoId: 'other' })];
    const path = buildRoadmap(words);
    assert.deepEqual(path.map((n) => n.key), ['casa', 'perro']);
  });
});

describe('the gate', () => {
  const words = many(OPEN_SLOTS + 3);
  const lockedWord = words[OPEN_SLOTS + 1];

  it('locked words are not ready and not counted', () => {
    assert.ok(isLocked(lockedWord, words));
    assert.equal(dueCount(words, NOW), OPEN_SLOTS);
    assert.ok(!readyWords(words, NOW).includes(lockedWord));
  });

  it('nextDueAt ignores a locked word', () => {
    const w = many(OPEN_SLOTS + 1).map((x) => ({ ...x, dueAt: NOW + 10 * DAY }));
    w[OPEN_SLOTS] = { ...w[OPEN_SLOTS], dueAt: NOW + DAY };
    assert.equal(nextDueAt(w, NOW), NOW + 10 * DAY);
  });

  const video = {
    id: 'v',
    cues: [0, 1, 2, 3].map((i) => ({
      start: i * 3,
      end: i * 3 + 2,
      text: '',
      translation: '',
      words: [{ text: i === 2 ? lockedWord.text : 'nada', start: i * 3, end: i * 3 + 1 }],
    })),
  } as unknown as Video;

  it('the planner does not blank a locked word', () => {
    assert.equal(computeBlankPlan(video, words, NOW).size, 0);
  });

  it('but asking for it by name still does', () => {
    const plan = computeBlankPlan(video, words, NOW, { first: lockedWord.text });
    assert.equal(plan.get(2)?.text, lockedWord.text);
  });

  it('newlyOpened names the word a learn unlocked', () => {
    const after = words.map((w, i) => (i === 0 ? { ...w, ...learned } : w));
    assert.deepEqual(newlyOpened(words, after).map((n) => n.key), [`w${OPEN_SLOTS}`]);
    assert.equal(lockedKeys(after).has(`w${OPEN_SLOTS}`), false);
  });
});

describe('honest learning: early correct answers are practice', () => {
  const MIN = 60_000;
  it('three writes in a minute do not make a word learned', () => {
    let w = word('planes', 0, { state: 'new', box: 0, correct: 0, lastReviewedAt: null });
    w = grade(w, true, NOW); // first answer ever: always moves
    assert.equal(w.box, 1);
    w = grade(w, true, NOW + 20_000); // 20s later: practice
    w = grade(w, true, NOW + 40_000);
    assert.equal(w.box, 1);
    assert.equal(w.state, 'learning');
    assert.equal(w.lastReviewedAt, NOW, 'practice never moves the clock');
  });

  it('spaced answers still climb: 10 min, then a day', () => {
    let w = word('planes', 0, { state: 'learning', box: 1, lastReviewedAt: NOW });
    w = grade(w, true, NOW + 10 * MIN);
    assert.equal(w.box, 2);
    assert.ok(isEarlyAnswer(w, NOW + 10 * MIN + 12 * 60 * MIN));
    w = grade(w, true, NOW + 10 * MIN + DAY);
    assert.equal(w.state, 'known');
    assert.notEqual(w.learnedAt, null);
  });

  it('a wrong answer always counts', () => {
    const w = grade(word('planes', 0, { box: 2, lastReviewedAt: NOW }), false, NOW + 1000);
    assert.equal(w.state, 'lapsed');
    assert.equal(w.box, 0);
  });
});

describe('train in Words, keep in the feed', () => {
  const video = {
    id: 'v',
    cues: [0, 1, 2].map((i) => ({
      start: i * 3,
      end: i * 3 + 2,
      text: '',
      translation: '',
      words: [{ text: i === 2 ? 'quedemos' : 'nada', start: i * 3, end: i * 3 + 1 }],
    })),
  } as unknown as Video;

  it('an untrained save is not asked in the feed', () => {
    const fresh = word('quedemos', 0, { state: 'new', box: 0, correct: 0, lastReviewedAt: null });
    assert.equal(isTrained(fresh), false);
    assert.equal(computeBlankPlan(video, [fresh], NOW).size, 0);
  });

  it('training makes it learned and puts it in the feed ten minutes later', () => {
    const fresh = word('quedemos', 0, { state: 'new', box: 0, correct: 0, lastReviewedAt: null });
    const trained = trainWord(fresh, NOW);
    assert.equal(trained.state, 'known');
    assert.equal(trained.learnedAt, NOW);
    assert.equal(computeBlankPlan(video, [trained], NOW + 60_000).size, 0);
    assert.equal(computeBlankPlan(video, [trained], NOW + TRAINED_FIRST_ASK_MS).size, 1);
  });

  it('the feed keeps asking it for a few days, then it climbs', () => {
    let w = trainWord(word('quedemos', 0, { state: 'new', box: 0, correct: 0, lastReviewedAt: null }), NOW);
    w = grade(w, true, NOW + TRAINED_FIRST_ASK_MS); // 10 min: practice
    assert.equal(w.box, 3);
    assert.equal(w.dueAt, NOW + TRAINED_FIRST_ASK_MS + DAY, 'next ask is a day on, not right away');
    w = grade(w, true, NOW + 3 * DAY); // three days after training: climbs
    assert.equal(w.box, 4);
  });
});
