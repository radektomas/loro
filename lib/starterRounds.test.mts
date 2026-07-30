import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Video } from '../types/index.ts';
import { normalizeAnswer } from './srs.ts';
import { normalizeSurface } from './dictionary.ts';
import { STARTER_DECK, starterIndexOf } from './starterDeck.ts';
import {
  chooseRoundTargets,
  functionAllowanceFor,
  functionWordIds,
  isContentWord,
  MAX_FUNCTION_WORDS_PER_ROUND,
  MIN_TARGET_AUDIBLE_S,
  MIN_WORDS_PER_ROUND,
  PAYOFF_TAIL_S,
  PREFERRED_MAX_DURATION_S,
  planStarterRounds,
  plannedCardCount,
  roundTargetIds,
  STARTER_ROUNDS,
  targetOccurrences,
  WORDS_PER_ROUND,
} from './starterRounds.ts';

/** A clip that speaks `words`, one cue, each word one second long. */
function clip(
  id: string,
  words: string[],
  opts: { level?: Video['level']; duration?: number; embed?: boolean } = {}
): Video {
  const { level = 'A1', duration = 20, embed = true } = opts;
  return {
    id,
    src: '',
    poster: '',
    creator: 'Test',
    author: { kind: 'none' },
    level,
    cues: [
      {
        start: 0,
        end: words.length,
        words: words.map((text, i) => ({ text, start: i, end: i + 1 })),
        translations: { en: words.join(' ') },
      },
    ],
    dictionary: {},
    ...(embed ? { youtubeId: id, durationSeconds: duration } : {}),
  };
}

/**
 * A clip whose deck words are spoken from `startAt` onwards, one second each.
 *
 * The ranking is priced on payoffEnd, so WHERE a clip's words land is now a
 * ranking input in its own right — `clip()` alone cannot express it, because it
 * always starts at zero.
 */
function clipAt(
  id: string,
  words: string[],
  startAt: number,
  duration: number
): Video {
  const video = clip(id, words, { duration });
  video.cues[0].words = words.map((text, i) => ({
    text,
    start: startAt + i,
    end: startAt + i + 1,
  }));
  video.cues[0].start = startAt;
  video.cues[0].end = startAt + words.length;
  return video;
}

const NO_SAVES = new Set<string>();

describe('planStarterRounds — clip first', () => {
  it('teaches only words the round’s clip actually speaks', () => {
    const plan = planStarterRounds({
      videos: [
        clip('a', ['hola', 'gracias', 'bien', 'basura']),
        clip('b', ['no', 'está', 'muy', 'basura']),
        clip('c', ['grande', 'nuevo', 'fácil']),
      ],
      savedIds: NO_SAVES,
    });
    assert.equal(plan.length, 3);
    for (const round of plan) {
      const spoken = new Set(
        round.video.cues.flatMap((c) => c.words.map((w) => normalizeAnswer(w.text)))
      );
      for (const target of round.targets) {
        assert.ok(
          spoken.has(target.entry.id),
          `"${target.entry.word}" is not spoken in ${round.video.id}`
        );
      }
    }
  });

  it('orders a round’s cards by frequency (deck rank)', () => {
    const [round] = planStarterRounds({
      videos: [clip('a', ['muy', 'hola', 'está'])],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.deepEqual(
      round.targets.map((t) => t.entry.word),
      ['hola', 'está', 'muy']
    );
    assert.deepEqual(
      round.targets.map((t) => t.deckIndex),
      round.targets.map((t) => starterIndexOf(t.entry.word))
    );
  });

  it('never teaches the same word in two rounds', () => {
    const plan = planStarterRounds({
      videos: [
        clip('a', ['hola', 'gracias', 'bien']),
        clip('b', ['hola', 'gracias', 'bien', 'no', 'está', 'muy']),
        clip('c', ['hola', 'no', 'está', 'muy', 'qué', 'dónde']),
      ],
      savedIds: NO_SAVES,
    });
    const seen = new Set<string>();
    for (const round of plan) {
      for (const t of round.targets) {
        assert.ok(!seen.has(t.entry.id), `"${t.entry.word}" taught twice`);
        seen.add(t.entry.id);
      }
    }
  });

  it('skips words the user already has saved', () => {
    const saved = new Set(['hola', 'gracias'].map(normalizeAnswer));
    const [round] = planStarterRounds({
      videos: [clip('a', ['hola', 'gracias', 'bien', 'no', 'está'])],
      savedIds: saved,
      rounds: 1,
    });
    for (const t of round.targets) assert.ok(!saved.has(t.entry.id));
    assert.deepEqual(
      round.targets.map((t) => t.entry.word),
      ['no', 'bien', 'está']
    );
  });

  it('matches accents exactly — the article "el" is never carded as "él"', () => {
    // Both sides of the trap in one clip: the deck's "él"/"tú"/"está" collapse
    // onto "el"/"tu"/"esta" under normalizeAnswer, so a normalized match would
    // hand a beginner "he" for a spoken article.
    const plan = planStarterRounds({
      videos: [clip('a', ['el', 'tu', 'esta', 'hola', 'gracias', 'bien'])],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.deepEqual(
      plan[0].targets.map((t) => t.entry.word),
      ['hola', 'gracias', 'bien']
    );
  });

  it('accepts the accented forms when they are what was spoken', () => {
    // The mirror image of the test above: these ARE the deck's words, so they
    // must be picked. All three are content words, so round 1 can take them.
    const [round] = planStarterRounds({
      videos: [clip('a', ['sé', 'sí', 'está'])],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.deepEqual(
      round.targets.map((t) => t.entry.word),
      ['sí', 'está', 'sé']
    );
  });

  it('ignores words with no audible span — they are never heard', () => {
    const video = clip('a', ['hola', 'gracias', 'bien', 'no']);
    // Zero-length timing: an alignment artifact, not a spoken word.
    video.cues[0].words[1] = { text: 'gracias', start: 1, end: 1 };
    const [round] = planStarterRounds({
      videos: [video],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.deepEqual(
      round.targets.map((t) => t.entry.word),
      ['hola', 'no', 'bien']
    );
  });
});

describe('planStarterRounds — the payoff constraints', () => {
  /** A clip whose words carry explicit spans, for the audibility rules. */
  function timed(
    id: string,
    words: { text: string; start: number; end: number }[]
  ): Video {
    const video = clip(
      id,
      words.map((w) => w.text)
    );
    video.cues[0].words = words;
    video.cues[0].end = Math.max(...words.map((w) => w.end));
    return video;
  }

  it('rejects a word never audible for MIN_TARGET_AUDIBLE_S', () => {
    // 0.15s is comfortably above the old 0.05s "was it spoken" floor and still
    // too short to register as a payoff — this is the case that produced the
    // 0.1s "en" the constraint was introduced for.
    const short = MIN_TARGET_AUDIBLE_S - 0.05;
    const plan = planStarterRounds({
      videos: [
        timed('a', [
          { text: 'hola', start: 0, end: short },
          { text: 'gracias', start: 1, end: 2 },
          { text: 'bien', start: 2, end: 3 },
          { text: 'muy', start: 3, end: 4 },
        ]),
      ],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.deepEqual(
      plan[0].targets.map((t) => t.entry.word),
      ['gracias', 'bien', 'muy']
    );
  });

  it('accepts a word whose LATER occurrence is long enough', () => {
    // Frequent words are often mumbled once and said clearly later. The clip
    // does teach the word; the planner must find the occurrence that works, and
    // targetOccurrences must agree so the highlight fires on that one.
    const video = timed('a', [
      { text: 'hola', start: 0, end: 0.08 },
      { text: 'gracias', start: 1, end: 2 },
      { text: 'bien', start: 2, end: 3 },
      { text: 'hola', start: 4, end: 4.9 },
    ]);
    const [round] = planStarterRounds({
      videos: [video],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.ok(round.targets.some((t) => t.entry.word === 'hola'));
    assert.equal(targetOccurrences(round).get(normalizeAnswer('hola'))?.start, 4);
  });

  it('round 1 is content words only', () => {
    // 'de' and 'y' outrank 'difícil' by frequency, and must still lose here.
    const [round] = planStarterRounds({
      videos: [clip('a', ['y', 'de', 'está', 'muy', 'difícil'])],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.deepEqual(
      round.targets.map((t) => t.entry.word),
      ['está', 'muy', 'difícil']
    );
    assert.ok(round.targets.every((t) => t.content));
    assert.equal(functionAllowanceFor(1), 0);
  });

  it('later rounds admit at most one function word', () => {
    const plan = planStarterRounds({
      videos: [
        clip('r1', ['hola', 'gracias', 'bien']),
        clip('r2', ['y', 'de', 'en', 'está', 'muy']),
      ],
      savedIds: NO_SAVES,
      rounds: 2,
    });
    const second = plan[1].targets;
    // 'y' is the most frequent word in that clip, so it takes the one slot; the
    // rest must be content even though 'de' and 'en' outrank both.
    assert.deepEqual(
      second.map((t) => t.entry.word),
      ['y', 'está', 'muy']
    );
    assert.equal(
      second.filter((t) => !t.content).length,
      MAX_FUNCTION_WORDS_PER_ROUND
    );
  });

  it('drops to two cards rather than run an all-function round', () => {
    const plan = planStarterRounds({
      videos: [
        clip('r1', ['hola', 'gracias', 'bien']),
        clip('r2', ['y', 'de', 'en', 'muy']),
      ],
      savedIds: NO_SAVES,
      rounds: 2,
    });
    assert.deepEqual(
      plan[1].targets.map((t) => t.entry.word),
      ['y', 'muy']
    );
    assert.equal(plan[1].targets.length, MIN_WORDS_PER_ROUND);
  });

  it('skips a clip that only has function words for round 1', () => {
    const plan = planStarterRounds({
      videos: [clip('glue', ['y', 'de', 'en', 'para', 'con'])],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.deepEqual(plan, []);
  });

  it('classifies the deck: glue is function, meaning is content', () => {
    for (const id of ['y', 'de', 'en', 'a', 'que', 'yo', 'esto', 'nada']) {
      assert.ok(!isContentWord(id), `"${id}" should be a function word`);
    }
    // Greetings are interjections, not one of the four named categories, but
    // they are the most teachable words a beginner meets — see the note on
    // FUNCTION_WORD_IDS.
    for (const id of ['hola', 'gracias', 'está', 'muy', 'casa', 'difícil']) {
      assert.ok(
        isContentWord(normalizeAnswer(id)),
        `"${id}" should be a content word`
      );
    }
  });

  it('has no stale entries in the function-word list', () => {
    // A rule for a word that is no longer in the deck would silently stop
    // applying; a renamed entry would silently become "content".
    const deckIds = new Set(STARTER_DECK.map((w) => w.id));
    for (const id of functionWordIds()) {
      assert.ok(deckIds.has(id), `"${id}" is not a deck word any more`);
    }
  });

  it('chooseRoundTargets ranks by frequency inside the constraints', () => {
    const targets = [
      { entry: STARTER_DECK[11], deckIndex: 11, content: false }, // y
      { entry: STARTER_DECK[28], deckIndex: 28, content: false }, // de
      { entry: STARTER_DECK[43], deckIndex: 43, content: true }, // muy
      { entry: STARTER_DECK[60], deckIndex: 60, content: true }, // bueno
    ];
    assert.deepEqual(
      chooseRoundTargets(targets, 3, 1).map((t) => t.entry.word),
      ['y', 'muy', 'bueno']
    );
    assert.deepEqual(
      chooseRoundTargets(targets, 3, 0).map((t) => t.entry.word),
      ['muy', 'bueno']
    );
  });
});

describe('planStarterRounds — clip ranking', () => {
  it('takes the lowest level available before any other preference', () => {
    const plan = planStarterRounds({
      videos: [
        // Longer, fewer words, but A1 — and A1 must still win.
        clip('a1', ['hola', 'gracias', 'bien'], { level: 'A1', duration: 29 }),
        clip('a2', ['no', 'está', 'muy', 'qué', 'dónde', 'quién'], {
          level: 'A2',
          duration: 10,
        }),
      ],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.equal(plan[0].video.id, 'a1');
  });

  it('spills into the next level when the lowest cannot fill the rounds', () => {
    const plan = planStarterRounds({
      videos: [
        clip('a1', ['hola', 'gracias', 'bien'], { level: 'A1' }),
        clip('a2', ['no', 'está', 'muy'], { level: 'A2' }),
      ],
      savedIds: NO_SAVES,
      rounds: 2,
    });
    assert.deepEqual(
      plan.map((r) => r.video.id),
      ['a1', 'a2']
    );
  });

  it('prefers the clip whose PAYOFF lands sooner, not the shorter video', () => {
    // The rule that replaced "prefer short clips". A round ends PAYOFF_TAIL_S
    // after its last target word, so a long video whose words land early IS a
    // short round — and it must beat a shorter video whose words run past the
    // preference, even though that one is richer (6 fresh words against 3).
    const plan = planStarterRounds({
      videos: [
        clipAt('late-in-a-short-video', ['hola', 'gracias', 'bien', 'no', 'está', 'muy'], 35, 45),
        clipAt('early-in-a-long-video', ['grande', 'nuevo', 'fácil'], 0, 300),
      ],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.equal(plan[0].video.id, 'early-in-a-long-video');
    assert.ok(plan[0].payoffEnd <= PREFERRED_MAX_DURATION_S);
  });

  it('ignores video duration entirely once the payoff fits', () => {
    // Both rounds end well inside the preference, so a 300s video is not
    // penalised for its length: richness decides, exactly as it does between two
    // equally short clips. This is the half of "duration matters much less" that
    // the test above does not cover.
    const plan = planStarterRounds({
      videos: [
        clipAt('thin-short-video', ['grande', 'nuevo', 'fácil'], 0, 20),
        clipAt('rich-long-video', ['hola', 'gracias', 'bien', 'no', 'está'], 0, 300),
      ],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.equal(plan[0].video.id, 'rich-long-video');
  });

  it('ranks by unsaved-word count among equally short clips', () => {
    const plan = planStarterRounds({
      videos: [
        clip('thin', ['hola', 'gracias', 'bien'], { duration: 20 }),
        clip('rich', ['no', 'está', 'muy', 'qué', 'dónde'], { duration: 20 }),
      ],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.equal(plan[0].video.id, 'rich');
  });

  it('avoids a clip the user has already seen', () => {
    const plan = planStarterRounds({
      videos: [
        clip('seen', ['hola', 'gracias', 'bien', 'no', 'está'], { duration: 10 }),
        clip('fresh', ['grande', 'nuevo', 'fácil'], { duration: 25 }),
      ],
      savedIds: NO_SAVES,
      seenIds: new Set(['seen']),
      rounds: 1,
    });
    assert.equal(plan[0].video.id, 'fresh');
  });

  it('uses a seen clip rather than dropping a round', () => {
    const plan = planStarterRounds({
      videos: [clip('seen', ['hola', 'gracias', 'bien'])],
      savedIds: NO_SAVES,
      seenIds: new Set(['seen']),
      rounds: 1,
    });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].video.id, 'seen');
  });

  it('never repeats a clip across rounds', () => {
    const plan = planStarterRounds({
      videos: [clip('only', ['hola', 'gracias', 'bien', 'no', 'está', 'muy'])],
      savedIds: NO_SAVES,
    });
    assert.equal(plan.length, 1);
  });

  it('skips hosted clips — the deck drives one YouTube player', () => {
    const plan = planStarterRounds({
      videos: [clip('hosted', ['hola', 'gracias', 'bien'], { embed: false })],
      savedIds: NO_SAVES,
    });
    assert.deepEqual(plan, []);
  });

  it('is deterministic for the same inputs', () => {
    const videos = [
      clip('a', ['hola', 'gracias', 'bien']),
      clip('b', ['no', 'está', 'muy']),
      clip('c', ['qué', 'dónde', 'quién']),
      clip('d', ['de', 'en', 'con']),
    ];
    const first = planStarterRounds({ videos, savedIds: NO_SAVES });
    const second = planStarterRounds({ videos, savedIds: NO_SAVES });
    assert.deepEqual(
      first.map((r) => [r.video.id, r.targets.map((t) => t.entry.word)]),
      second.map((r) => [r.video.id, r.targets.map((t) => t.entry.word)])
    );
  });
});

describe('planStarterRounds — falling short', () => {
  it('falls back to two cards rather than borrowing an unspoken word', () => {
    const plan = planStarterRounds({
      videos: [clip('a', ['hola', 'gracias', 'basura'])],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.equal(plan[0].targets.length, MIN_WORDS_PER_ROUND);
    assert.deepEqual(
      plan[0].targets.map((t) => t.entry.word),
      ['hola', 'gracias']
    );
  });

  it('drops a clip that cannot even fill the fallback', () => {
    const plan = planStarterRounds({
      videos: [clip('a', ['hola', 'basura', 'otra'])],
      savedIds: NO_SAVES,
    });
    assert.deepEqual(plan, []);
  });

  it('returns an empty plan when nothing is left to teach', () => {
    const plan = planStarterRounds({
      videos: [clip('a', ['hola', 'gracias', 'bien'])],
      savedIds: new Set(STARTER_DECK.map((w) => w.id)),
    });
    assert.deepEqual(plan, []);
  });
});

describe('plan helpers', () => {
  it('roundTargetIds is the highlight set, keyed like spoken words', () => {
    const [round] = planStarterRounds({
      videos: [clip('a', ['hola', 'está', 'bien'])],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    const ids = roundTargetIds(round);
    assert.equal(ids.size, 3);
    // The clip says "está"; the overlay keys on normalizeAnswer, so the
    // highlight lookup must hit even though the id is accent-folded.
    assert.ok(ids.has(normalizeAnswer('Está,')));
  });

  it('plannedCardCount counts cards, not rounds', () => {
    const plan = planStarterRounds({
      videos: [
        clip('a', ['hola', 'gracias', 'bien']),
        clip('b', ['no', 'está']),
      ],
      savedIds: NO_SAVES,
    });
    assert.equal(plannedCardCount(plan), 5);
  });
});

describe('the real catalog can back a full run', () => {
  it('every deck word resolves accent-exactly to itself', () => {
    // The planner's lookup table is keyed by normalizeSurface; if a deck word
    // ever stops round-tripping through it, targets silently vanish.
    for (const w of STARTER_DECK) {
      assert.ok(
        normalizeSurface(w.word),
        `"${w.word}" normalizes to an empty surface key`
      );
    }
  });

  it('plans three full rounds from data/embedVideos.json', async () => {
    // The one test that touches real content: the whole design assumes the
    // catalog can seed 7-9 words at the lowest level. If A1 depth ever drops
    // below that, this fails loudly instead of quietly shipping short rounds.
    const { default: embeds } = await import('../data/embedVideos.json', {
      with: { type: 'json' },
    });
    const videos = (embeds as unknown as Video[]).map((entry) => ({
      ...entry,
      author: { kind: 'none' as const },
    }));
    const plan = planStarterRounds({ videos, savedIds: NO_SAVES });
    assert.equal(plan.length, STARTER_ROUNDS);
    assert.ok(
      plannedCardCount(plan) >= 7,
      `catalog only seeds ${plannedCardCount(plan)} words`
    );

    plan.forEach((round, i) => {
      assert.equal(round.video.level, 'A1', `${round.video.id} is not A1`);
      assert.equal(round.targets.length, WORDS_PER_ROUND);

      // Every target must clear the payoff floor somewhere in the clip, and the
      // occurrence the highlight will fire on is the one that clears it.
      const occurrences = targetOccurrences(round);
      for (const target of round.targets) {
        const span = occurrences.get(target.entry.id);
        assert.ok(span, `"${target.entry.word}" has no audible occurrence`);
        assert.ok(
          span.end - span.start >= MIN_TARGET_AUDIBLE_S,
          `"${target.entry.word}" is only ${(span.end - span.start).toFixed(2)}s`
        );
      }

      // Content carries every round, and round 1 is content-only.
      const functionWords = round.targets.filter((t) => !t.content);
      assert.ok(
        functionWords.length <= functionAllowanceFor(i + 1),
        `round ${i + 1} spends ${functionWords.length} function words on ${functionWords
          .map((t) => t.entry.word)
          .join(', ')}`
      );
    });

    // EVERY round now fits the preference, which the old duration-based ranking
    // could not manage: A1 is thin, only two A1 clips are under 30s, and the
    // third round used to run 57s rather than drop to a glue round. Ranking on
    // payoffEnd instead buys a 38s clip whose three words all land by 0:15.
    //
    // Asserted for all three rather than as a floor, because this is the
    // property the change exists to guarantee. If A1 depth ever thins to where
    // it cannot hold, the answer is more A1 content or a longer preference —
    // NOT a round that quietly runs a minute.
    for (const [i, round] of plan.entries()) {
      assert.ok(
        round.payoffEnd <= PREFERRED_MAX_DURATION_S,
        `round ${i + 1} (${round.video.id}) runs ${round.payoffEnd.toFixed(1)}s, ` +
          `over the ${PREFERRED_MAX_DURATION_S}s preference`
      );
    }

    // The whole run, as the user experiences it. Pinned as a ceiling so a
    // regression in the ranking shows up as a number rather than a feeling.
    const watchTime = plan.reduce((n, r) => n + r.payoffEnd, 0);
    assert.ok(
      watchTime <= 75,
      `three rounds now take ${watchTime.toFixed(1)}s of video`
    );
  });
});

describe('payoffEnd — the round ends at the payoff, not the video', () => {
  it('ends PAYOFF_TAIL_S after the last target word is spoken', () => {
    // Targets at 0-1, 1-2, 2-3 inside a clip that keeps talking to 0:40.
    const video = clipAt('a', ['hola', 'gracias', 'bien'], 0, 40);
    video.cues.push({
      start: 10,
      end: 40,
      words: [{ text: 'basura', start: 10, end: 40 }],
      translations: { en: 'filler' },
    });
    const [round] = planStarterRounds({
      videos: [video],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.equal(round.transcriptEnd, 40);
    assert.equal(round.payoffEnd, 3 + PAYOFF_TAIL_S);
  });

  it('never runs past the transcript', () => {
    // Last target ends at 3s and the transcript stops there too: the tail has
    // nowhere to go, and holding a beginner on silence is the thing the round
    // end exists to avoid.
    const [round] = planStarterRounds({
      videos: [clipAt('a', ['hola', 'gracias', 'bien'], 0, 30)],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.equal(round.transcriptEnd, 3);
    assert.equal(round.payoffEnd, 3);
  });

  it('covers every card it dealt', () => {
    // The round cannot end before the user has heard all of it — the clip stage
    // ticks a word "heard" once the playhead passes the same occurrence.
    const [round] = planStarterRounds({
      videos: [clipAt('a', ['hola', 'gracias', 'bien', 'no', 'está'], 5, 60)],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    for (const [id, occurrence] of targetOccurrences(round)) {
      assert.ok(
        occurrence.end <= round.payoffEnd,
        `"${id}" is spoken at ${occurrence.end}s, after the round ends at ${round.payoffEnd}s`
      );
    }
  });
});
