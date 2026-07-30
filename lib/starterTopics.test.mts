import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Video } from '../types/index.ts';
import {
  classifyStarterTopic,
  scoreStarterTopics,
  STARTER_TOPIC_PREFERENCE,
} from './starterTopics.ts';

/** A clip whose transcript is `words`, one cue, one second per word. Content
    doesn't need real timing for a topic classifier — only the vocabulary. */
function transcript(words: string[]): Video {
  return {
    id: 't',
    src: '',
    poster: '',
    creator: 'Test',
    author: { kind: 'none' },
    level: 'A1',
    cues: [
      {
        start: 0,
        end: words.length,
        words: words.map((text, i) => ({ text, start: i, end: i + 1 })),
        translations: { en: words.join(' ') },
      },
    ],
    dictionary: {},
  };
}

describe('classifyStarterTopic', () => {
  it('classifies real food vocabulary as food', () => {
    const topic = classifyStarterTopic(
      transcript([
        'la', 'comida', 'está', 'deliciosa', 'esta', 'receta', 'lleva',
        'pollo', 'y', 'especias', 'pruébalo',
      ])
    );
    assert.equal(topic, 'food');
  });

  it('classifies transport, weather and place vocabulary as travel', () => {
    const topic = classifyStarterTopic(
      transcript([
        'el', 'vuelo', 'al', 'aeropuerto', 'salió', 'tarde', 'hace', 'mucho',
        'frío', 'en', 'la', 'montaña', 'reservé', 'un', 'hotel', 'cerca',
        'de', 'la', 'playa',
      ])
    );
    assert.equal(topic, 'travel');
  });

  it('classifies routine, school and money vocabulary as dailyLife', () => {
    const topic = classifyStarterTopic(
      transcript([
        'mi', 'rutina', 'empieza', 'en', 'el', 'trabajo', 'luego', 'voy',
        'al', 'colegio', 'a', 'buscar', 'a', 'los', 'niños', 'y', 'pago',
        'la', 'factura', 'del', 'banco',
      ])
    );
    assert.equal(topic, 'dailyLife');
  });

  it('classifies language, tradition and music vocabulary as culture', () => {
    const topic = classifyStarterTopic(
      transcript([
        'este', 'carácter', 'chino', 'es', 'parte', 'de', 'una', 'tradición',
        'muy', 'antigua', 'y', 'esta', 'canción', 'se', 'canta', 'en', 'la',
        'fiesta', 'del', 'pueblo',
      ])
    );
    assert.equal(topic, 'culture');
  });

  it('classifies a menu/settings walkthrough as tech — the failure this catches', () => {
    // thZaiNWBaxI verbatim: a Microsoft/Android immersive-reader walkthrough
    // that the pure ranking picked for round 3 before this module existed.
    const topic = classifyStarterTopic(
      transcript([
        'para', 'activar', 'el', 'lector', 'inmersivo', 'en', 'microsoft',
        'hecha', 'en', 'android', 'hay', 'que', 'ir', 'a', 'los', 'tres',
        'puntitos', 'de', 'abajo', 'luego', 'pulsamos', 'sobre',
        'configuración', 'bajamos', 'hasta', 'accesibilidad', 'marcamos',
        'esta', 'casilla', 'para', 'finalmente', 'activar', 'el', 'lector',
        'inmersivo',
      ])
    );
    assert.equal(topic, 'tech');
  });

  it('classifies a gadget spec-sheet as tech even with no "tutorial" framing', () => {
    // A product review reads nothing like a settings walkthrough, but it is
    // just as wrong a first minute — see the module doc.
    const topic = classifyStarterTopic(
      transcript([
        'estos', 'auriculares', 'bluetooth', 'tienen', 'buena', 'batería',
        'y', 'el', 'procesador', 'es', 'rápido', 'para', 'este', 'precio',
      ])
    );
    assert.equal(topic, 'tech');
  });

  it('falls back to "other" for content with no keyword hits at all', () => {
    // to0dx-JZ4yo verbatim: a nature documentary about a migratory bird.
    // Deliberately not travel, food, dailyLife, culture, OR tech.
    const topic = classifyStarterTopic(
      transcript([
        'el', 'vuelvepiedras', 'es', 'una', 'maravilla', 'alada', 'de', 'la',
        'naturaleza', 'anida', 'en', 'la', 'tundra', 'ártica', 'con', 'su',
        'distintivo', 'plumaje',
      ])
    );
    assert.equal(topic, 'other');
  });

  it('does not classify by prefix — "solo" must not read as the weather word "sol"', () => {
    // An earlier pass scored "sol" by prefix and picked up 56 hits, nearly all
    // of them "solo"/"solamente" — see the module doc. This is the regression
    // it guards against.
    const topic = classifyStarterTopic(
      transcript(['solo', 'quiero', 'estar', 'solamente', 'aquí', 'contigo'])
    );
    assert.equal(topic, 'other');
  });

  it('does not treat "cuenta" as a tech signal — it is usually "darse cuenta"', () => {
    // Checked by hand against the real catalog: "cuenta" is the idiom "to
    // realize" in the overwhelming majority of its occurrences, not "account".
    // See the module doc for the two real exceptions, which classify correctly
    // on their OTHER tech vocabulary instead.
    const topic = classifyStarterTopic(
      transcript([
        'no', 'me', 'di', 'cuenta', 'de', 'que', 'ya', 'era', 'tarde', 'y',
        'nos', 'dimos', 'cuenta', 'juntos',
      ])
    );
    assert.equal(topic, 'other');
  });

  it('caps one repeated keyword so it cannot alone dominate the score', () => {
    // "cocina" said many times should not out-rank a clip that actually
    // mentions several distinct food words — the cap keeps a single loud
    // token from drowning out real signal elsewhere.
    const scores = scoreStarterTopics(
      transcript(['cocina', 'cocina', 'cocina', 'cocina', 'cocina', 'cocina'])
    );
    assert.equal(scores.food, 2);
  });

  it('a tie between tech and another topic resolves to tech', () => {
    const scores = scoreStarterTopics(transcript(['pantalla', 'comida']));
    assert.equal(scores.tech, scores.food); // both score 1 — a genuine tie
    assert.equal(classifyStarterTopic(transcript(['pantalla', 'comida'])), 'tech');
  });

  it('STARTER_TOPIC_PREFERENCE excludes tech and other — they are never curated picks', () => {
    assert.ok(!STARTER_TOPIC_PREFERENCE.includes('tech'));
    assert.ok(!STARTER_TOPIC_PREFERENCE.includes('other'));
    assert.deepEqual(STARTER_TOPIC_PREFERENCE, [
      'travel',
      'dailyLife',
      'food',
      'culture',
    ]);
  });
});
