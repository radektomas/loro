import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendStarterEvent,
  MAX_STARTER_EVENTS,
  mergeStarterEvents,
  parseStarterEvents,
  type StarterEvent,
} from './starterEvents.ts';

/** A card_shown event. `id` defaults to something unique per (round, card, at)
    so a test only has to name it when identity is the point. */
const card = (
  round: number,
  index: number,
  at: number,
  id = `e-${round}-${index}-${at}`
): StarterEvent => ({ id, name: 'card_shown', round, card: index, at });

describe('appendStarterEvent', () => {
  it('appends in order', () => {
    const one = appendStarterEvent([], card(1, 1, 10));
    const two = appendStarterEvent(one, card(1, 2, 20));
    assert.deepEqual(
      two.map((e) => e.at),
      [10, 20]
    );
  });

  it('drops NEW events when full, keeping the first run’s funnel', () => {
    const full = [card(1, 1, 1), card(1, 2, 2)];
    const next = appendStarterEvent(full, card(9, 9, 99), 2);
    assert.deepEqual(next, full);
  });

  it('keeps the earliest events at the real cap', () => {
    const full = Array.from({ length: MAX_STARTER_EVENTS }, (_, i) =>
      card(1, i, i)
    );
    const next = appendStarterEvent(full, {
      id: 'late',
      name: 'skipped',
      round: 3,
      card: null,
      at: 9_999,
    });
    assert.equal(next.length, MAX_STARTER_EVENTS);
    assert.equal(next[0].card, 0);
    assert.ok(!next.some((e) => e.id === 'late'));
  });

  it('ignores a consecutive duplicate of the same card slot', () => {
    // A remounted effect must not inflate the top of the funnel.
    const log = appendStarterEvent([], card(1, 1, 10));
    const again = appendStarterEvent(log, card(1, 1, 99, 'different-id'));
    assert.equal(again.length, 1);
    assert.equal(again[0].at, 10);
  });

  it('records the same slot again once something else intervened', () => {
    let log = appendStarterEvent([], card(1, 1, 10));
    log = appendStarterEvent(log, {
      id: 'a2',
      name: 'card_answered',
      round: 1,
      card: 1,
      at: 11,
    });
    log = appendStarterEvent(log, card(1, 1, 12, 'shown-again'));
    assert.equal(log.length, 3);
  });

  it('distinguishes rounds and cards', () => {
    let log = appendStarterEvent([], card(1, 1, 10));
    log = appendStarterEvent(log, card(1, 2, 11));
    log = appendStarterEvent(log, card(2, 2, 12));
    assert.equal(log.length, 3);
  });
});

describe('mergeStarterEvents', () => {
  it('unions both devices and sorts oldest first', () => {
    const merged = mergeStarterEvents([card(1, 2, 20)], [card(1, 1, 10)]);
    assert.deepEqual(
      merged.map((e) => e.at),
      [10, 20]
    );
  });

  it('does not duplicate the same event pushed twice', () => {
    const e = card(1, 1, 10);
    assert.equal(mergeStarterEvents([e], [{ ...e }]).length, 1);
  });

  it('is idempotent: merging the same local batch twice changes nothing', () => {
    // The requirement the whole `id` field exists for. A sign-in merges local
    // into remote and stores the result; a retried push, a second tab, or a
    // reload then merges the SAME local batch into that result, and must be a
    // no-op — otherwise every sign-in would inflate the funnel.
    const local = [card(1, 1, 10), card(1, 2, 20), card(1, 3, 30)];
    const remote = [card(2, 1, 40)];
    const once = mergeStarterEvents(local, remote);
    const twice = mergeStarterEvents(once, local);
    const thrice = mergeStarterEvents(twice, local);
    assert.deepEqual(twice, once);
    assert.deepEqual(thrice, once);
    assert.equal(once.length, 4);
  });

  it('keeps two same-millisecond events apart when their ids differ', () => {
    const answered: StarterEvent = {
      id: 'answered',
      name: 'card_answered',
      round: 1,
      card: 3,
      at: 500,
    };
    const started: StarterEvent = {
      id: 'started',
      name: 'clip_started',
      round: 1,
      card: null,
      at: 500,
    };
    const merged = mergeStarterEvents([answered], [started]);
    assert.equal(merged.length, 2);
    // Deterministic order despite the tie, so two devices agree.
    assert.deepEqual(mergeStarterEvents([started], [answered]), merged);
  });

  it('dedupes id-less legacy entries on their content', () => {
    const legacy: StarterEvent = {
      id: '',
      name: 'card_shown',
      round: 1,
      card: 1,
      at: 10,
    };
    assert.equal(mergeStarterEvents([legacy], [{ ...legacy }]).length, 1);
  });

  it('never loses the remote log to a local push', () => {
    const remote = [card(1, 1, 10), card(1, 2, 20)];
    const local = [card(1, 1, 30, 'local-1')];
    assert.equal(mergeStarterEvents(local, remote).length, 3);
  });

  it('caps the union', () => {
    const merged = mergeStarterEvents(
      [card(1, 1, 1), card(1, 2, 2)],
      [card(1, 3, 3)],
      2
    );
    assert.deepEqual(
      merged.map((e) => e.at),
      [1, 2]
    );
  });
});

describe('parseStarterEvents', () => {
  it('keeps well-formed events and their optional fields', () => {
    const parsed = parseStarterEvents([
      {
        id: 'x1',
        name: 'card_answered',
        round: 1,
        card: 2,
        at: 5,
        knewIt: true,
        cards: 3,
        word: 'gracias',
      },
      {
        id: 'x2',
        name: 'clip_completed',
        round: 1,
        card: null,
        at: 6,
        videoId: 'abc',
        played: false,
      },
    ]);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].id, 'x1');
    assert.equal(parsed[0].knewIt, true);
    assert.equal(parsed[0].cards, 3);
    assert.equal(parsed[0].word, 'gracias');
    assert.equal(parsed[1].videoId, 'abc');
    assert.equal(parsed[1].played, false);
  });

  it('rejects junk rather than poisoning the log', () => {
    assert.deepEqual(parseStarterEvents(null), []);
    assert.deepEqual(parseStarterEvents('nope'), []);
    assert.deepEqual(
      parseStarterEvents([
        null,
        42,
        { name: 'nope', round: 1, at: 1 },
        { name: 'card_shown', at: 1 },
        { name: 'card_shown', round: 1 },
      ]),
      []
    );
  });

  it('defaults a missing card index to null and a missing id to empty', () => {
    const [e] = parseStarterEvents([
      { name: 'round_completed', round: 2, at: 9 },
    ]);
    assert.equal(e.card, null);
    assert.equal(e.id, '');
  });

  it('survives a round-trip through JSON', () => {
    const log = [card(1, 1, 10), card(1, 2, 20)];
    assert.deepEqual(parseStarterEvents(JSON.parse(JSON.stringify(log))), log);
  });
});
