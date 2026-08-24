import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeLevelBlankPlan,
  MAX_USER_LEVEL,
  applyRecallLevelCredit,
  wordLevel,
} from './levels.ts';
import type { Cue, Gloss, SavedWord, Video } from './types.ts';

/**
 * Band anchors used by the fixtures below. Picked from the real band lists so
 * the tests exercise the shipped data rather than a parallel universe:
 *   band 1 'casa', band 2 'trabajo', band 3 'hotel', band 4 'lograr',
 *   band 5 'zzqqxx' (unlisted ⇒ rare). Asserted below, so a future edit to
 *   the lists that moves one of these fails loudly here instead of silently
 *   weakening every test that builds on it.
 */
const BAND_1 = 'casa';
const BAND_2 = 'trabajo';
const BAND_3 = 'hotel';
const BAND_4 = 'lograr';
const BAND_5 = 'zzqqxx';

const gloss = (lemma: string): Gloss => ({
  lemma,
  pos: 'noun',
  note: null,
  glosses: { en: `${lemma}-gloss` },
});

/** One cue per word list, timed so nothing is a zero-length artifact. */
const cue = (words: string[], at: number): Cue => ({
  start: at,
  end: at + 1,
  words: words.map((text, i) => ({
    text,
    start: at + i * 0.1,
    end: at + i * 0.1 + 0.09,
  })),
  translations: { en: 'line' },
});

/**
 * Filler occupies a cue without ever being a candidate: it is deliberately
 * left OUT of the dictionary below, so it has no gloss and therefore no
 * prompt. (It would otherwise count as band 5 — unlisted — and quietly
 * satisfy the very fallback these tests are trying to pin down.)
 */
const FILLER_WORD = 'xxxx';

/** A video whose cue i (0-based) holds the words at cueWords[i]. */
function video(cueWords: string[][], dictWords?: string[]): Video {
  const all = (dictWords ?? [...new Set(cueWords.flat())]).filter(
    (w) => w !== FILLER_WORD
  );
  return {
    id: 'v1',
    src: '',
    poster: '',
    creator: 'test',
    author: { kind: 'none' },
    level: 'A2',
    cues: cueWords.map((w, i) => cue(w, i)),
    dictionary: Object.fromEntries(all.map((w) => [w, gloss(w)])),
  } as Video;
}

/** A cue that holds space without offering a candidate. */
const filler = [FILLER_WORD];

describe('band anchors used by these tests', () => {
  it('sit in the bands the tests assume', () => {
    assert.equal(wordLevel(BAND_1), 1);
    assert.equal(wordLevel(BAND_2), 2);
    assert.equal(wordLevel(BAND_3), 3);
    assert.equal(wordLevel(BAND_4), 4);
    assert.equal(wordLevel(BAND_5), 5);
  });

  it('leaves filler out of the dictionary, so it is never a candidate', () => {
    const v = video([filler, filler, filler, filler]);
    assert.equal(computeLevelBlankPlan(v, 5, [], 'en').size, 0);
  });
});

describe('computeLevelBlankPlan — band selection', () => {
  it('prefers the exact band when the video has it', () => {
    const v = video([filler, filler, [BAND_1, BAND_2], filler, filler]);
    const plan = computeLevelBlankPlan(v, 2, [], 'en');
    assert.equal(plan.get(2)?.text, BAND_2);
    assert.equal(plan.get(2)?.level, 2);
  });

  it('falls back to a nearby band when the exact band is absent', () => {
    // A level-3 user, nothing from band 3 anywhere in the video.
    const v = video([filler, filler, [BAND_2], filler, filler]);
    const plan = computeLevelBlankPlan(v, 3, [], 'en');
    assert.equal(plan.get(2)?.text, BAND_2);
    // Reports the word's OWN band, not the user's level — the tier chip
    // must not claim a band-2 word is band-3 practice.
    assert.equal(plan.get(2)?.level, 2);
  });

  it('prefers the easier band over the harder one at equal distance', () => {
    // Level 4: band 3 and band 5 are both one step away.
    const v = video([filler, filler, [BAND_5, BAND_3], filler, filler]);
    const plan = computeLevelBlankPlan(v, 4, [], 'en');
    assert.equal(plan.get(2)?.text, BAND_3);
  });

  it('still plans blanks at the top of the ladder, above the word bands', () => {
    // THE REGRESSION: word bands stop at 5 but the tier ladder goes to 6, so
    // an exact-match rule gave a Nativo zero blue words on every video.
    const v = video([filler, filler, [BAND_5], filler, filler]);
    const plan = computeLevelBlankPlan(v, MAX_USER_LEVEL, [], 'en');
    assert.equal(plan.size, 1);
    assert.equal(plan.get(2)?.text, BAND_5);
  });

  it('plans nothing when the video offers no glossable candidate at all', () => {
    // 'xxxx' is in no band list, but it is also absent from the dictionary,
    // so it has no prompt to show.
    const v = video([filler, filler, filler, filler], []);
    assert.equal(computeLevelBlankPlan(v, 3, [], 'en').size, 0);
  });
});

describe('computeLevelBlankPlan — placement rules survive the fallback', () => {
  it('never blanks the first two cues', () => {
    const v = video([[BAND_1], [BAND_1], filler, filler]);
    const plan = computeLevelBlankPlan(v, 1, [], 'en');
    assert.equal(plan.has(0), false);
    assert.equal(plan.has(1), false);
  });

  it('leaves a gap between two blanks, including across fallback passes', () => {
    // Cue 2 is band 1 (exact for a level-1 user); cue 3 is band 5, which only
    // a later pass reaches — it must still respect the gap against cue 2.
    const v = video([filler, filler, [BAND_1], [BAND_5], [BAND_5]]);
    const plan = computeLevelBlankPlan(v, 1, [], 'en');
    const cues = [...plan.keys()].sort((a, b) => a - b);
    for (let i = 1; i < cues.length; i++) {
      assert.ok(cues[i] - cues[i - 1] >= 2, `cues ${cues} are too close`);
    }
  });

  it('honours the per-video cap', () => {
    const many = Array.from({ length: 12 }, () => [BAND_1]);
    const plan = computeLevelBlankPlan(video(many), 1, [], 'en');
    assert.ok(plan.size <= 3, `expected <= 3 for 12 cues, got ${plan.size}`);
  });

  it('never claims a cue the SRS plan already owns', () => {
    const v = video([filler, filler, [BAND_1], filler, [BAND_1], filler]);
    const plan = computeLevelBlankPlan(v, 1, [], 'en', new Set([2]));
    assert.equal(plan.has(2), false);
  });

  it('never blanks a word the user has already saved', () => {
    const saved = [{ text: BAND_1 } as SavedWord];
    const v = video([filler, filler, [BAND_1], filler]);
    assert.equal(computeLevelBlankPlan(v, 1, saved, 'en').size, 0);
  });

  it('never blanks the same word twice in one video', () => {
    const v = video([filler, filler, [BAND_1], filler, [BAND_1], filler, [BAND_2]]);
    const plan = computeLevelBlankPlan(v, 1, [], 'en');
    const texts = [...plan.values()].map((w) => w.text);
    assert.equal(new Set(texts).size, texts.length);
  });

  it('skips zero-length words — they were never audible', () => {
    const v = video([filler, filler, [BAND_1], filler]);
    v.cues[2].words[0] = { text: BAND_1, start: 2, end: 2 };
    assert.equal(computeLevelBlankPlan(v, 1, [], 'en').size, 0);
  });
});

describe('applyRecallLevelCredit', () => {
  it('is half a level blank and never demotes', () => {
    const r = applyRecallLevelCredit({ level: 2, meter: 0 });
    assert.deepEqual([r.level, r.meter, r.leveledUp, r.leveledDown], [2, 10, false, false]);
  });

  it('ten correct recalls climb a level', () => {
    let state = { level: 1, meter: 0 };
    let ups = 0;
    for (let i = 0; i < 10; i++) {
      const r = applyRecallLevelCredit(state);
      state = { level: r.level, meter: r.meter };
      if (r.leveledUp) ups++;
    }
    assert.equal(ups, 1);
    assert.equal(state.level, 2);
  });

  it('stops at the top of the ladder with a full meter', () => {
    const r = applyRecallLevelCredit({ level: MAX_USER_LEVEL, meter: 95 });
    assert.equal(r.level, MAX_USER_LEVEL);
    assert.equal(r.meter, 100);
    assert.equal(r.leveledUp, false);
  });
});
