import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { curationScore, MIN_VIEWS_TO_PUBLISH } from './curation.mts';

const ok = { category_id: '22', title: 'Un día en Madrid', view_count: 100_000 };

describe('curationScore — hard exclusions', () => {
  it('never publishes Gaming, Film & Animation or Music', () => {
    for (const category_id of ['20', '1', '10']) {
      assert.ok(curationScore({ ...ok, category_id }).score < 0, category_id);
    }
  });

  it('rejects below the view floor, and reports the actual count', () => {
    const v = curationScore({ ...ok, view_count: 500 });
    assert.ok(v.score < 0);
    assert.match(v.reason, /500 views/);
  });

  it('accepts exactly at the floor', () => {
    assert.ok(curationScore({ ...ok, view_count: MIN_VIEWS_TO_PUBLISH }).score >= 0);
  });

  it('catches kid/gaming franchises in the title', () => {
    for (const title of [
      'Mi nueva casa en Roblox',
      'SKIBIDI TOILET 79 explicado',
      'Gameplay de Minecraft',
      'FC Mobile 25 MOD/Hack - Cómo Obtener MONEDAS',
    ]) {
      assert.ok(curationScore({ ...ok, title }).score < 0, title);
    }
  });

  it('catches gaming hashtags hiding in the description', () => {
    const v = curationScore({ ...ok, description: 'suscríbete #roblox #shorts' });
    assert.ok(v.score < 0);
  });

  it('catches narrated-listicle formats', () => {
    for (const title of [
      'Los 5 animales más peligrosos del mundo',
      '¿Sabías que los pulpos tienen tres corazones?',
      'Datos increíbles sobre animales',
      'TOP 10 lugares abandonados',
    ]) {
      assert.ok(curationScore({ ...ok, title }).score < 0, title);
    }
  });

  it('always explains itself — never a bare "filtered"', () => {
    const v = curationScore({ ...ok, category_id: '20' });
    assert.ok(v.reason.length > 5 && !/^filtered$/i.test(v.reason));
  });
});

describe('curationScore — politics', () => {
  it('excludes the News & Politics category outright', () => {
    assert.ok(curationScore({ ...ok, category_id: '25' }).score < 0);
  });

  it('catches political commentary filed under People & Blogs', () => {
    // The real leak: this published before the rule existed, category 22.
    for (const title of [
      'Como hay responder a los socialistas | Manuel Ll',
      'Diferencia entre el socialismo y el comunismo',
      'POR ESTO LA GENTE VOTA A VOX #ultraderecha',
      'El gobierno de Argentina anuncia nuevas medidas',
    ]) {
      assert.ok(curationScore({ ...ok, title }).score < 0, title);
    }
  });

  it('reads the description too — the title alone often looks innocent', () => {
    // Live example: "La pregunta que desarmó el cinismo de Videla" names a
    // dictator the patterns do not list; only the description says
    // "dictadura". Dropping the description from the haystack would let this
    // and its whole channel through.
    const v = curationScore({
      ...ok,
      title: 'La pregunta que desarmó el cinismo de Videla',
      description: 'Un fragmento sobre la dictadura argentina.',
    });
    assert.ok(v.score < 0);
  });

  it('does NOT flag ordinary words that look like party names', () => {
    // "Podemos" is the verb "we can"; "morena" means brunette. A party-name
    // list flagged a fruit-preserve recipe and an animal-rescue appeal.
    for (const title of [
      'Dulce de agraz silvestre',
      'RESCATE URGENTE FUNDACIÓN SANTUARIO VEGAN',
      'Hoy podemos cocinar algo rápido',
      'La chica morena del pueblo',
    ]) {
      assert.ok(curationScore({ ...ok, title }).score >= 0, title);
    }
  });

  it('does not flag ordinary travel talk about a country', () => {
    assert.ok(
      curationScore({ ...ok, title: 'Qué ver en Perú en 3 días' }).score >= 0
    );
  });
});

describe('curationScore — ranking', () => {
  const scoreOf = (category_id: string) =>
    curationScore({ ...ok, category_id }).score;

  it('ranks people-on-camera categories above narration-heavy ones', () => {
    // People & Blogs / Travel over Science & Tech / Pets, which are
    // dominated by voiceover over stock footage.
    assert.ok(scoreOf('22') > scoreOf('28'));
    assert.ok(scoreOf('19') > scoreOf('15'));
  });

  it('keeps News & Politics below vlogs and travel', () => {
    // Real people talking, but a beginner feed should not be dominated by
    // partisan commentary.
    assert.ok(scoreOf('25') < scoreOf('22'));
    assert.ok(scoreOf('25') < scoreOf('19'));
  });

  it('gives an unknown category a neutral, publishable score', () => {
    const v = curationScore({ ...ok, category_id: '999' });
    assert.ok(v.score >= 0);
  });

  it('treats a missing category as publishable rather than dropping it', () => {
    assert.ok(curationScore({ ...ok, category_id: null }).score >= 0);
  });
});
