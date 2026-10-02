import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanWord, isProperName, wordForSave } from './dictionary.ts';
import { isLevelBlankable } from './levels.ts';
import type { Gloss } from './types.ts';

/**
 * Names are not vocabulary, and a saved word is just the word — run with
 * `npm test`. The glosses are shapes taken from the real catalog.
 */
const g = (lemma: string, en: string, pos = 'noun', note: string | null = null): Gloss => ({
  lemma,
  pos,
  note,
  glosses: { en },
});

describe('isProperName', () => {
  it('catches the names the glossing model marks', () => {
    assert.ok(isProperName('Peppa', g('peppa', 'Peppa', 'noun', 'proper noun')));
    assert.ok(isProperName('Elena', g('Elena', 'Elena')));
  });

  it('catches the ones it does not: a gloss that is the same word, capitalised', () => {
    assert.ok(isProperName('york', g('york', 'York')));
    assert.ok(isProperName('américa', g('américa', 'America')));
  });

  it('leaves real words alone, including "yo" -> "I"', () => {
    assert.equal(isProperName('yo', g('yo', 'I', 'pron')), false);
    assert.equal(isProperName('barro', g('barro', 'mud')), false);
    assert.equal(isProperName('hotel', g('hotel', 'hotel')), false);
  });

  it('keeps names out of blue blanks', () => {
    assert.equal(isLevelBlankable('york', g('york', 'York'), 3), false);
    assert.equal(isLevelBlankable('charco', g('charco', 'puddle'), 3), true);
  });
});

describe('cleanWord / wordForSave', () => {
  it('strips the sentence punctuation from both ends', () => {
    assert.equal(cleanWord('barro.'), 'barro');
    assert.equal(cleanWord('¿Podemos'), 'Podemos');
    assert.equal(cleanWord('jugar?'), 'jugar');
    assert.equal(cleanWord('"hola",'), 'hola');
  });

  it('keeps the inside of a word', () => {
    assert.equal(cleanWord('mba’éichapa?'), 'mba’éichapa');
    assert.equal(cleanWord('¡illo!'), 'illo');
  });

  it('saves lowercase, unless it is a name', () => {
    assert.equal(wordForSave('¿Podemos', g('poder', 'we can', 'verb')), 'podemos');
    assert.equal(wordForSave('Pig.', g('pig', 'Pig', 'noun', 'proper noun')), 'Pig');
  });
});
