import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCalibrationWords } from '../calibration.ts';
import { normalizeAnswer } from '../srs.ts';
import {
  STARTER_DECK,
  starterIndexOf,
  starterTranslation,
} from './deck.ts';

describe('starter deck integrity', () => {
  it('has the promised size', () => {
    assert.ok(
      STARTER_DECK.length >= 80,
      `deck has ${STARTER_DECK.length} words, expected at least 80`
    );
  });

  it('every entry is complete', () => {
    for (const w of STARTER_DECK) {
      assert.ok(w.word.trim(), `empty word (id ${w.id})`);
      assert.ok(w.translations.en?.trim(), `"${w.word}" has no en translation`);
      assert.ok(w.translations.cs?.trim(), `"${w.word}" has no cs translation`);
      assert.ok(w.exampleSentence.trim(), `"${w.word}" has no example`);
    }
  });

  it('words are single tokens', () => {
    for (const w of STARTER_DECK) {
      assert.ok(
        !/\s/.test(w.word),
        `"${w.word}" is not a single token — SavedWord.text is one tapped word`
      );
    }
  });

  it('ids are the normalized surface and unique', () => {
    const seen = new Set<string>();
    for (const w of STARTER_DECK) {
      assert.equal(
        w.id,
        normalizeAnswer(w.word),
        `id "${w.id}" is not normalizeAnswer("${w.word}")`
      );
      assert.ok(w.id, `"${w.word}" normalizes to nothing`);
      // Uniqueness under normalizeAnswer is what makes the skip-already-saved
      // check sound: accent pairs (sí/si, qué/que, él/el…) collapse, so two
      // entries sharing an identity would shadow each other.
      assert.ok(!seen.has(w.id), `duplicate normalized identity "${w.id}"`);
      seen.add(w.id);
    }
  });

  it('example sentences contain their own word', () => {
    for (const w of STARTER_DECK) {
      const tokens = w.exampleSentence
        .split(/\s+/)
        .map(normalizeAnswer)
        .filter(Boolean);
      // Inflections count ("bueno" -> "Buenos días", "cotidiano" -> "vida
      // cotidiana"): accept a token sharing all but the last two characters.
      const need = Math.max(2, w.id.length - 2);
      const hit = tokens.some(
        (t) => t.slice(0, need) === w.id.slice(0, need)
      );
      assert.ok(hit, `"${w.word}" does not appear in "${w.exampleSentence}"`);
    }
  });

  // THE TRIPWIRE. The calibration escape hatch commits selected words into
  // the SRS using the deck entry's translation, with deliberately NO
  // fallback — a calibration word missing from the deck would be an
  // unsaveable selection. If this fails, extend the deck (or fix the seed);
  // do not add a fallback.
  it('is a superset of the calibration seed', () => {
    for (const seed of buildCalibrationWords()) {
      const i = starterIndexOf(seed.text);
      assert.ok(
        i >= 0,
        `calibration word "${seed.text}" (${seed.level}) has no starter deck entry`
      );
    }
  });

  it('translation resolution falls back to en', () => {
    const first = STARTER_DECK[0];
    assert.equal(starterTranslation(first, 'cs'), first.translations.cs);
    assert.equal(starterTranslation(first, 'de'), first.translations.en);
  });
});
