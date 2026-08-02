import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Video } from '../types.ts';
import { normalizeAnswer } from '../srs.ts';
import { normalizeSurface } from '../dictionary.ts';
import { STARTER_DECK, starterIndexOf } from './deck.ts';
import {
  chooseRoundTargets,
  describeStarterPlan,
  functionAllowanceFor,
  functionWordIds,
  isContentWord,
  MAX_FUNCTION_WORDS_PER_ROUND,
  MIN_TARGET_AUDIBLE_S,
  MIN_WORDS_PER_ROUND,
  PAYOFF_TAIL_S,
  PREFERRED_MAX_DURATION_S,
  planStarterDeck,
  planStarterRounds,
  plannedCardCount,
  roundTargetIds,
  STARTER_CLIP_ALLOWLIST,
  STARTER_ROUNDS,
  starterCandidates,
  targetOccurrences,
  WORDS_PER_ROUND,
} from './rounds.ts';

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
    //
    // allowlist: [] deliberately — this test is about the RANKING's own
    // guarantee (lowest level, short, full rounds), decoupled from
    // STARTER_CLIP_ALLOWLIST's editorial picks, which trade level for topic
    // quality on purpose (see that constant's doc) and are covered by their
    // own tripwire below.
    const { default: embeds } = await import('../../../../data/embedVideos.json', {
      with: { type: 'json' },
    });
    const videos = (embeds as unknown as Video[]).map((entry) => ({
      ...entry,
      author: { kind: 'none' as const },
    }));
    const plan = planStarterRounds({ videos, savedIds: NO_SAVES, allowlist: [] });
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

  it('every curated id is a clip the deck can actually use', async () => {
    // The tripwire for STARTER_CLIP_ALLOWLIST. A curated entry that silently
    // fails to load is the whole risk of a hand-maintained list: the deck falls
    // back to the ranking and looks fine, so nobody notices the curation was
    // never applied. Empty passes trivially — that is the shipped default.
    if (STARTER_CLIP_ALLOWLIST.length === 0) return;
    const { default: embeds } = await import('../../../../data/embedVideos.json', {
      with: { type: 'json' },
    });
    const videos = (embeds as unknown as Video[]).map((entry) => ({
      ...entry,
      author: { kind: 'none' as const },
    }));
    const usable = new Set(
      starterCandidates({ videos, savedIds: NO_SAVES }).map((c) => c.video.id)
    );
    for (const id of STARTER_CLIP_ALLOWLIST) {
      assert.ok(
        usable.has(id),
        `curated clip "${id}" cannot back a starter round — check /dev/starter-clips`
      );
    }
    // ...and the curation must actually reach the deck, not be overruled by a
    // constraint at plan time.
    const { rounds } = planStarterDeck({ videos, savedIds: NO_SAVES });
    const curated = rounds.filter((r) => r.source === 'allowlist').length;
    assert.ok(
      curated > 0,
      'the allowlist is non-empty but no round came from it'
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

describe('planStarterDeck — the curated allowlist', () => {
  const CLIPS = [
    clip('rich', ['hola', 'gracias', 'bien', 'no', 'está', 'tengo']),
    clip('picked-first', ['sí', 'adiós', 'estoy']),
    clip('picked-second', ['quiero', 'puedo', 'vamos']),
    clip('unranked', ['hablo', 'necesito', 'muy']),
  ];

  it('draws from the allowlist in the order given', () => {
    const { rounds } = planStarterDeck({
      videos: CLIPS,
      savedIds: NO_SAVES,
      allowlist: ['picked-second', 'picked-first'],
    });
    assert.deepEqual(
      rounds.map((r) => r.video.id),
      // Round 3 has no curated entry left, so the ranking fills it.
      ['picked-second', 'picked-first', 'rich']
    );
    assert.deepEqual(
      rounds.map((r) => r.source),
      ['allowlist', 'allowlist', 'ranking']
    );
  });

  it('beats the ranking — a curated clip the ranking would not pick wins', () => {
    // 'rich' has the most to teach, so the ranking picks it first; the list
    // overrules that. Nothing about the ranking changed: it still fills round 2.
    const { rounds } = planStarterDeck({
      videos: CLIPS,
      savedIds: NO_SAVES,
      allowlist: ['unranked'],
      rounds: 2,
    });
    assert.deepEqual(
      rounds.map((r) => [r.video.id, r.source]),
      [
        ['unranked', 'allowlist'],
        ['rich', 'ranking'],
      ]
    );
  });

  it('still enforces the round-1 content-only rule, and says so', () => {
    // 'glue' can deal two cards in an ordinary round (one content word plus one
    // function word) but only one content-only card, so it cannot be round 1.
    const videos = [...CLIPS, clip('glue', ['comida', 'y', 'en', 'de'])];
    const { rounds, notes } = planStarterDeck({
      videos,
      savedIds: NO_SAVES,
      allowlist: ['glue'],
      rounds: 1,
    });
    assert.equal(rounds.length, 1);
    assert.notEqual(rounds[0].video.id, 'glue');
    assert.equal(rounds[0].source, 'ranking');
    const skip = notes.find((n) => n.videoId === 'glue');
    assert.equal(skip?.outcome, 'skipped');
    assert.match(skip!.reason, /content-only/);
  });

  it('takes the same clip for a later round once glue is allowed', () => {
    // Same clip, same list. Round 1 refuses it for being glue-heavy; round 2,
    // where one function word is allowed, takes it — the skip is per round, not
    // a verdict on the entry.
    const videos = [...CLIPS, clip('glue', ['comida', 'y', 'en', 'de'])];
    const { rounds } = planStarterDeck({
      videos,
      savedIds: NO_SAVES,
      allowlist: ['glue'],
      rounds: 2,
    });
    assert.equal(rounds[1].video.id, 'glue');
    assert.equal(rounds[1].source, 'allowlist');
    assert.equal(rounds[1].targets.length, MIN_WORDS_PER_ROUND);
  });

  it('skips a curated clip whose round would run long', () => {
    // The length limit is a HARD gate on the curated path (and only there): a
    // clip picked by hand does not get to stretch a beginner's first minute.
    const long = clipAt('long', ['hola', 'gracias', 'bien'], 40, 60);
    const { rounds, notes } = planStarterDeck({
      videos: [...CLIPS, long],
      savedIds: NO_SAVES,
      allowlist: ['long'],
      rounds: 1,
    });
    assert.notEqual(rounds[0].video.id, 'long');
    const skip = notes.find((n) => n.videoId === 'long');
    assert.match(skip!.reason, /over the 30s limit/);
  });

  it('reports an id that is not a candidate, with the reason', () => {
    const { rounds, notes } = planStarterDeck({
      videos: [...CLIPS, clip('hosted', ['hola', 'gracias'], { embed: false })],
      savedIds: NO_SAVES,
      allowlist: ['nope', 'hosted'],
      rounds: 1,
    });
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].source, 'ranking');
    assert.equal(
      notes.find((n) => n.videoId === 'nope')?.reason,
      'not in the catalog'
    );
    assert.equal(
      notes.find((n) => n.videoId === 'hosted')?.reason,
      'not a YouTube embed'
    );
  });

  it('never fails to produce a deck, whatever the list says', () => {
    const { rounds } = planStarterDeck({
      videos: CLIPS,
      savedIds: NO_SAVES,
      allowlist: ['nope', 'also-nope', 'still-nope'],
    });
    assert.equal(rounds.length, STARTER_ROUNDS);
    for (const round of rounds) assert.equal(round.source, 'ranking');
  });

  it('an empty list plans exactly what the ranking alone plans', () => {
    const withEmpty = planStarterDeck({
      videos: CLIPS,
      savedIds: NO_SAVES,
      allowlist: [],
    });
    const ranked = planStarterRounds({ videos: CLIPS, savedIds: NO_SAVES });
    assert.deepEqual(
      withEmpty.rounds.map((r) => r.video.id),
      ranked.map((r) => r.video.id)
    );
    for (const round of withEmpty.rounds) {
      assert.equal(round.source, 'ranking');
    }
  });

  it('never deals the same curated clip twice', () => {
    const { rounds } = planStarterDeck({
      videos: CLIPS,
      savedIds: NO_SAVES,
      allowlist: ['rich', 'rich', 'rich'],
    });
    assert.equal(rounds.filter((r) => r.video.id === 'rich').length, 1);
  });

  it('reports one skip per reason, not one per round', () => {
    const { notes } = planStarterDeck({
      videos: CLIPS,
      savedIds: NO_SAVES,
      allowlist: ['nope'],
    });
    assert.equal(notes.filter((n) => n.videoId === 'nope').length, 1);
  });

  it('describeStarterPlan names each round’s source and every skip', () => {
    const result = planStarterDeck({
      videos: CLIPS,
      savedIds: NO_SAVES,
      allowlist: ['picked-first', 'nope'],
    });
    const text = describeStarterPlan(result).join('\n');
    assert.match(text, /round 1\s+allowlist\s+picked-first/);
    assert.match(text, /round 2\s+ranking/);
    assert.match(text, /skipped nope for round \d: not in the catalog/);
  });
});

describe('starterCandidates — the curation browser’s list', () => {
  it('offers only clips that can really back a round', () => {
    const list = starterCandidates({
      videos: [
        clip('ok', ['hola', 'gracias', 'bien']),
        clip('hosted', ['hola', 'gracias', 'bien'], { embed: false }),
        clip('thin', ['hola', 'basura', 'otra']),
        // Glue only: has deck words, but cannot deal two cards under any
        // allowance, so the planner would never take it.
        clip('allglue', ['y', 'en', 'de', 'para']),
      ],
      savedIds: NO_SAVES,
    });
    assert.deepEqual(
      list.map((c) => c.video.id),
      ['ok']
    );
  });

  it('leads with the planner’s own round-1 pick', () => {
    const videos = [
      clip('b', ['sí', 'adiós', 'estoy']),
      clip('a', ['hola', 'gracias', 'bien', 'no', 'está', 'tengo']),
      clip('c', ['quiero', 'puedo', 'vamos']),
    ];
    const list = starterCandidates({ videos, savedIds: NO_SAVES });
    const plan = planStarterRounds({ videos, savedIds: NO_SAVES });
    assert.equal(list[0].video.id, plan[0].video.id);
  });

  it('prices asRound1 exactly like the planner would price round 1', () => {
    const [row] = starterCandidates({
      videos: [clipAt('a', ['hola', 'gracias', 'bien'], 5, 60)],
      savedIds: NO_SAVES,
    });
    const [round] = planStarterRounds({
      videos: [clipAt('a', ['hola', 'gracias', 'bien'], 5, 60)],
      savedIds: NO_SAVES,
      rounds: 1,
    });
    assert.equal(row.asRound1.payoffEnd, round.payoffEnd);
    assert.deepEqual(
      row.asRound1.targets.map((t) => t.entry.word),
      round.targets.map((t) => t.entry.word)
    );
  });

  it('prices asLaterRound with one function word allowed', () => {
    // 'está' loses to the function word 'en' by frequency alone, but here it's
    // the reverse test: a clip whose best 3 unclaimed words already include a
    // function word once one is permitted.
    const [row] = starterCandidates({
      videos: [clip('a', ['hola', 'y', 'gracias'])],
      savedIds: NO_SAVES,
    });
    assert.equal(row.asLaterRound.targets.length, 3);
    assert.equal(
      row.asLaterRound.targets.filter((t) => !t.content).length,
      1
    );
  });

  it('flags a clip that cannot open the deck, and still prices both rounds', () => {
    const [row] = starterCandidates({
      videos: [clip('glue', ['hola', 'y', 'en', 'de'])],
      savedIds: NO_SAVES,
    });
    assert.equal(row.round1Ready, false);
    // Round 1 (content-only): only "hola" clears it.
    assert.equal(row.asRound1.targets.length, 1);
    // A later round (one function word allowed): content word plus one glue
    // word is a legal round 2/3.
    assert.equal(row.asLaterRound.targets.length, 2);
    assert.ok(row.asLaterRound.targets.some((t) => !t.content));
  });

  it('carries the audible span of every word it shows', () => {
    const [row] = starterCandidates({
      videos: [clipAt('a', ['hola', 'gracias', 'bien'], 2, 30)],
      savedIds: NO_SAVES,
    });
    for (const target of row.asRound1.targets) {
      const occurrence = row.asRound1.occurrences.get(target.entry.id);
      assert.ok(occurrence, `no occurrence for "${target.entry.word}"`);
      assert.ok(
        occurrence!.end - occurrence!.start >= MIN_TARGET_AUDIBLE_S,
        `"${target.entry.word}" span is under the audible floor`
      );
    }
  });

  it('skips words the user already knows, like the planner does', () => {
    const list = starterCandidates({
      videos: [clip('a', ['hola', 'gracias', 'bien', 'no', 'está'])],
      savedIds: new Set(['hola', 'gracias'].map(normalizeAnswer)),
    });
    assert.deepEqual(
      list[0].asRound1.targets.map((t) => t.entry.word),
      ['no', 'bien', 'está']
    );
  });

  it('carries the clip’s topic, so curation never needs a transcript re-read', () => {
    const [row] = starterCandidates({
      videos: [
        clip('a', [
          'hola', 'gracias', 'bien', 'comida', 'deliciosa', 'receta', 'pollo',
        ]),
      ],
      savedIds: NO_SAVES,
    });
    assert.equal(row.topic, 'food');
  });
});
