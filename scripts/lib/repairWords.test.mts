import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  alignWords,
  applyRepair,
  distance,
  letters,
  MAX_CHANGED_SHARE,
  RepairRejected,
  skeleton,
} from './repairWords.mts';

const words = (...texts: string[]) =>
  texts.map((text, i) => ({ text, start: i, end: i + 0.5 }));

describe('letters / skeleton / distance', () => {
  it('letters ignores punctuation and case, keeps accents', () => {
    assert.equal(letters('Pig.'), 'pig');
    assert.equal(letters('¿Podemos'), 'podemos');
    assert.notEqual(letters('esta'), letters('está'));
  });
  it('skeleton also drops accents, so a restored accent is the same word', () => {
    assert.equal(skeleton('esta'), skeleton('está'));
    assert.equal(skeleton('Qué?'), skeleton('que'));
    assert.notEqual(skeleton('poli'), skeleton('Polly'));
  });
  it('distance ranks a mishearing as close and a hallucination as far', () => {
    assert.ok(distance('poli', 'polly') <= 0.5);
    assert.ok(distance('pepp', 'peppa') <= 0.5);
    assert.ok(distance('dinosauri', 'dinosaurio') <= 0.5);
    assert.ok(distance('lauel', 'claro') > 0.5);
    assert.ok(distance('soy', 'se') > 0.5);
  });
});

describe('alignWords', () => {
  it('carries punctuation and case onto the matching tokens', () => {
    const input = words('yo', 'soy', 'peppa', 'pig', 'este', 'es', 'george');
    const { proposed, dropped, inserted, refused } = alignWords(
      input,
      'Yo soy Peppa Pig.\nEste es George.'
    );
    assert.deepEqual(proposed, ['Yo', 'soy', 'Peppa', 'Pig.', 'Este', 'es', 'George.']);
    assert.deepEqual([dropped, inserted, refused], [[], [], []]);
  });

  it('accepts a close substitution as a correction', () => {
    const input = words('hola', 'poli', 'bonito');
    const { proposed, refused } = alignWords(input, 'Hola, Polly bonito.');
    assert.deepEqual(proposed, ['Hola,', 'Polly', 'bonito.']);
    assert.deepEqual(refused, []);
  });

  it('refuses a far substitution and keeps the original token', () => {
    const input = words('todo', 'lo', 'que', 'dice', 'lauel', 'es');
    const { proposed, refused } = alignWords(input, 'todo lo que dice. ¡Claro! Es');
    assert.equal(proposed[4], 'lauel');
    assert.deepEqual(refused, [{ i: 4, from: 'lauel', to: '¡Claro!' }]);
    assert.equal(proposed[3], 'dice.');
  });

  it('a dropped word costs ONE flagged token, not a shift of everything after it', () => {
    const input = words('el', 'señor', 'dinosaurio', 'george', 'siempre', 'se', 'baña', 'con', 'el', 'señor');
    // The model skipped "george".
    const { proposed, dropped } = alignWords(input, 'El señor dinosaurio siempre se baña con el señor');
    assert.deepEqual(dropped, [3]);
    assert.equal(proposed[3], 'george');
    assert.deepEqual(proposed.slice(4), ['siempre', 'se', 'baña', 'con', 'el', 'señor']);
  });

  it('discards a word the model inserted', () => {
    const input = words('vamos', 'hay', 'tarta');
    const { proposed, inserted } = alignWords(input, 'Vamos, hay tarta — deliciosa.');
    assert.deepEqual(proposed, ['Vamos,', 'hay', 'tarta']);
    assert.deepEqual(inserted, ['—', 'deliciosa.']);
  });
});

describe('applyRepair', () => {
  it('keeps every timing and sorts changes into the three tiers', () => {
    const pad = Array.from({ length: 20 }, () => 'y');
    const input = words('yo', 'soy', 'peppa', 'pig', 'esta', 'poli', ...pad);
    const out = applyRepair(input, ['Yo', 'soy', 'Peppa', 'Pig.', 'está', 'Polly.', ...pad]);
    assert.deepEqual(
      out.words.slice(0, 6).map((w) => [w.text, w.start, w.end]),
      [
        ['Yo', 0, 0.5],
        ['soy', 1, 1.5],
        ['Peppa', 2, 2.5],
        ['Pig.', 3, 3.5],
        ['está', 4, 4.5],
        ['Polly.', 5, 5.5],
      ]
    );
    assert.equal(out.punctuated, 3);
    assert.equal(out.accents, 1);
    assert.deepEqual(out.changes, [{ i: 5, from: 'poli', to: 'Polly.' }]);
  });

  it('rejects a token that was emptied, split, or reduced to punctuation', () => {
    assert.throws(() => applyRepair(words('a', 'b'), ['a', '']), RepairRejected);
    assert.throws(() => applyRepair(words('ya', 's'), ['ya', 'lo sé']), RepairRejected);
    assert.throws(() => applyRepair(words('a', 'b'), ['a', '...']), RepairRejected);
  });

  it('caps LETTER changes only, and quotes the first diffs when it refuses', () => {
    const n = 100;
    const input = words(...Array.from({ length: n }, (_, i) => `w${i}`));
    const limit = Math.floor(n * MAX_CHANGED_SHARE);
    const within = input.map((w, i) => (i < limit ? `x${i}` : w.text));
    assert.doesNotThrow(() => applyRepair(input, within));
    const over = input.map((w, i) => (i <= limit ? `x${i}` : w.text));
    assert.throws(() => applyRepair(input, over), /over the 8% cap.*#0 w0→x0/);
    const accented = words(...Array.from({ length: n }, () => 'esta'));
    const out = applyRepair(accented, accented.map(() => 'está'));
    assert.equal(out.accents, n);
    assert.equal(out.changes.length, 0);
  });
});
