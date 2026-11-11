import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hamming, pickMatch } from '../../../lib/linkMatch.ts';

test('hamming counts differing bits between hex hashes', () => {
  assert.equal(hamming('0000000000000000', '0000000000000000'), 0);
  assert.equal(hamming('0000000000000000', '000000000000000f'), 4);
  assert.equal(hamming('ffffffffffffffff', '0000000000000000'), 64);
});

test('one clear match wins', () => {
  assert.equal(
    pickMatch([
      { mediaId: 'yes', hashDist: 3, textSim: 0.9 },
      { mediaId: 'no', hashDist: 30, textSim: 0.1 },
    ]),
    'yes'
  );
});

test('two look-alikes (a repost) are not guessed between', () => {
  assert.equal(
    pickMatch([
      { mediaId: 'a', hashDist: 4, textSim: 0.9 },
      { mediaId: 'b', hashDist: 6, textSim: 0.88 },
    ]),
    null
  );
});

test('nothing close enough is no match', () => {
  assert.equal(pickMatch([{ mediaId: 'a', hashDist: 20, textSim: 0.5 }]), null);
  assert.equal(pickMatch([]), null);
});

test('a text-only match counts when the cover hash is missing', () => {
  assert.equal(
    pickMatch([
      { mediaId: 'a', hashDist: null, textSim: 0.9 },
      { mediaId: 'b', hashDist: null, textSim: 0.2 },
    ]),
    'a'
  );
});
