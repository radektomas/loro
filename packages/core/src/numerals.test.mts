import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardinal, expandNumeralTokens, genderOf, numberWordValue, numeralToWords } from './numerals.ts';

describe('cardinal', () => {
  it('units, teens, twenties', () => {
    assert.equal(cardinal(0), 'cero');
    assert.equal(cardinal(7), 'siete');
    assert.equal(cardinal(15), 'quince');
    assert.equal(cardinal(16), 'dieciséis');
    assert.equal(cardinal(22), 'veintidós');
    assert.equal(cardinal(29), 'veintinueve');
  });
  it('tens with y', () => {
    assert.equal(cardinal(30), 'treinta');
    assert.equal(cardinal(45), 'cuarenta y cinco');
    assert.equal(cardinal(99), 'noventa y nueve');
  });
  it('cien alone, ciento with a remainder, irregular hundreds', () => {
    assert.equal(cardinal(100), 'cien');
    assert.equal(cardinal(101), 'ciento uno');
    assert.equal(cardinal(150), 'ciento cincuenta');
    assert.equal(cardinal(500), 'quinientos');
    assert.equal(cardinal(700), 'setecientos');
    assert.equal(cardinal(999), 'novecientos noventa y nueve');
  });
  it('mil is never un mil; millón is', () => {
    assert.equal(cardinal(1000), 'mil');
    assert.equal(cardinal(1500), 'mil quinientos');
    assert.equal(cardinal(2000), 'dos mil');
    assert.equal(cardinal(10000), 'diez mil');
    assert.equal(cardinal(21000), 'veintiún mil');
    assert.equal(cardinal(100000), 'cien mil');
    assert.equal(cardinal(1_000_000), 'un millón');
    assert.equal(cardinal(2_500_000), 'dos millones quinientos mil');
  });
  it('years read as cardinals', () => {
    assert.equal(cardinal(1936), 'mil novecientos treinta y seis');
    assert.equal(cardinal(2014), 'dos mil catorce');
    assert.equal(cardinal(1999), 'mil novecientos noventa y nueve');
  });
  it('uno by gender', () => {
    assert.equal(cardinal(1), 'uno');
    assert.equal(cardinal(1, 'm'), 'un');
    assert.equal(cardinal(1, 'f'), 'una');
    assert.equal(cardinal(21), 'veintiuno');
    assert.equal(cardinal(21, 'm'), 'veintiún');
    assert.equal(cardinal(21, 'f'), 'veintiuna');
    assert.equal(cardinal(31, 'f'), 'treinta y una');
    assert.equal(cardinal(200, 'f'), 'doscientas');
    assert.equal(cardinal(1001, 'm'), 'mil un');
  });
  it('rejects what it cannot say', () => {
    assert.equal(cardinal(-1), null);
    assert.equal(cardinal(2.5), null);
    assert.equal(cardinal(1_000_000_000), null);
  });
});

describe('genderOf', () => {
  it('reads the next token', () => {
    assert.equal(genderOf('años'), 'm');
    assert.equal(genderOf('casa'), 'f');
    assert.equal(genderOf('personas,'), 'f');
    assert.equal(genderOf('canción'), 'f');
    assert.equal(genderOf('ciudades'), 'f');
    assert.equal(genderOf(null), 'none');
    assert.equal(genderOf('y'), 'none');
    assert.equal(genderOf('de'), 'none');
    assert.equal(genderOf('20'), 'none');
  });
});

describe('numeralToWords — caption tokens', () => {
  it('the catalog’s most common tokens', () => {
    const table: [string, string][] = [
      ['10', 'diez'], ['20', 'veinte'], ['5', 'cinco'], ['15', 'quince'], ['3', 'tres'],
      ['2', 'dos'], ['30', 'treinta'], ['4', 'cuatro'], ['12', 'doce'], ['6', 'seis'],
      ['100', 'cien'], ['40', 'cuarenta'], ['1000', 'mil'], ['14', 'catorce'],
      ['50', 'cincuenta'], ['600', 'seiscientos'], ['45', 'cuarenta y cinco'],
      ['2013', 'dos mil trece'], ['10000', 'diez mil'], ['1500', 'mil quinientos'],
    ];
    for (const [token, words] of table) assert.equal(numeralToWords(token), words, token);
  });
  it('gender from the next word, apocope before a noun', () => {
    assert.equal(numeralToWords('1', 'día'), 'un');
    assert.equal(numeralToWords('1', 'casa'), 'una');
    assert.equal(numeralToWords('1'), 'uno');
    assert.equal(numeralToWords('21', 'años'), 'veintiún');
    assert.equal(numeralToWords('21', 'personas'), 'veintiuna');
    assert.equal(numeralToWords('28', 'yo'), 'veintiocho');
  });
  it('percent, currency, separators, decimals', () => {
    assert.equal(numeralToWords('30%'), 'treinta por ciento');
    assert.equal(numeralToWords('$500'), 'quinientos dólares');
    assert.equal(numeralToWords('$1'), 'un dólar');
    assert.equal(numeralToWords('€20'), 'veinte euros');
    assert.equal(numeralToWords('1.500'), 'mil quinientos');
    assert.equal(numeralToWords('1,500'), 'mil quinientos');
    assert.equal(numeralToWords('2,5'), 'dos coma cinco');
    assert.equal(numeralToWords('2.5'), 'dos coma cinco');
  });
  it('keeps trailing punctuation', () => {
    assert.equal(numeralToWords('20,'), 'veinte,');
    assert.equal(numeralToWords('1936.'), 'mil novecientos treinta y seis.');
  });
  it('leaves what it does not understand', () => {
    for (const t of ['3:30', '10-20', '2wj', '1º', '1.500,50', '12345678901', 'abc', '', '000', '007']) {
      assert.equal(numeralToWords(t), null, t);
    }
  });
});

describe('expandNumeralTokens', () => {
  it('splits the span by letters and reads gender from the next word', () => {
    const out = expandNumeralTokens([
      { text: 'en', start: 1, end: 1.2 },
      { text: '1936', start: 1.2, end: 2.2 },
      { text: 'y', start: 2.2, end: 2.4 },
      { text: '1', start: 2.4, end: 2.6 },
      { text: 'casa', start: 2.6, end: 3 },
    ]);
    assert.deepEqual(out.map((w) => w.text), ['en', 'mil', 'novecientos', 'treinta', 'y', 'seis', 'y', 'una', 'casa']);
    assert.equal(out[1].start, 1.2);
    assert.equal(out[5].end, 2.2);
    for (let i = 1; i < out.length; i++) assert.ok(out[i].start >= out[i - 1].start);
    assert.ok(out[2].end - out[2].start > out[1].end - out[1].start); // longer word, longer share
  });
  it('is idempotent and leaves unknown tokens', () => {
    const words = [{ text: '3:30', start: 0, end: 1 }, { text: 'cien', start: 1, end: 2 }];
    assert.deepEqual(expandNumeralTokens(expandNumeralTokens(words)), words);
  });
});

describe('numberWordValue', () => {
  it('maps every word the converter can emit', () => {
    assert.equal(numberWordValue('treinta'), 30);
    assert.equal(numberWordValue('novecientos'), 900);
    assert.equal(numberWordValue('doscientas'), 200);
    assert.equal(numberWordValue('veintiún'), 21);
    assert.equal(numberWordValue('cien'), 100);
    assert.equal(numberWordValue('ciento'), 100);
    assert.equal(numberWordValue('mil'), 1000);
    assert.equal(numberWordValue('millones'), 1_000_000);
    assert.equal(numberWordValue('y'), null);
    assert.equal(numberWordValue('dólares'), null);
  });
});
