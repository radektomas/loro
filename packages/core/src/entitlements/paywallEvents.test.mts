import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendPaywallEvent,
  mergePaywallEvents,
  PAYWALL_EVENT_CAP,
  sanitizePaywallLog,
  type PaywallEvent,
} from './paywallEvents.ts';

/** An event with a deterministic id, so ordering assertions are stable. */
const ev = (
  name: PaywallEvent['name'],
  at: number,
  extra: Partial<PaywallEvent> = {}
): PaywallEvent => ({ id: `${name}-${at}`, name, at, ...extra });

/**
 * The funnel is the only evidence about whether 50 is the right ceiling, and
 * every rule below protects a number that later gets DIVIDED by something. An
 * inflated paywall_shown quietly halves the conversion rate; a milestone that
 * fires twice quietly invents a user who got further than they did.
 */

describe('appendPaywallEvent — milestones fire once, ever', () => {
  it('refuses a milestone already anywhere in the log', () => {
    // Not just against the last entry: a user who deletes a word and re-saves
    // it passes 50 again, and counting that twice ruins the distribution.
    const log = [
      ev('saved_words_count', 1, { milestone: 50 }),
      ev('paywall_dismissed', 2),
      ev('save_blocked_by_limit', 3),
    ];
    const next = appendPaywallEvent(log, ev('saved_words_count', 9, { milestone: 50 }));
    assert.equal(next, log, 'same array — nothing to write');
  });

  it('allows a DIFFERENT milestone', () => {
    const log = [ev('saved_words_count', 1, { milestone: 10 })];
    const next = appendPaywallEvent(log, ev('saved_words_count', 2, { milestone: 25 }));
    assert.equal(next.length, 2);
  });
});

describe('appendPaywallEvent — consecutive duplicates', () => {
  it('drops a repeat of the same event name back to back', () => {
    // React effects re-run; a remounted modal would otherwise log
    // paywall_shown twice and inflate the denominator of every rate.
    const log = [ev('paywall_shown', 1)];
    assert.equal(appendPaywallEvent(log, ev('paywall_shown', 2)), log);
  });

  it('keeps a NON-consecutive repeat', () => {
    // A second block an hour later is real signal, and the user who hits the
    // wall repeatedly is the most interesting user in the dataset.
    const log = [ev('save_blocked_by_limit', 1), ev('paywall_dismissed', 2)];
    const next = appendPaywallEvent(log, ev('save_blocked_by_limit', 3));
    assert.equal(next.length, 3);
  });
});

describe('appendPaywallEvent — the cap', () => {
  it('drops the NEW event when full, never the oldest', () => {
    // A ring buffer would evict the early milestones, which are the entry point
    // of the funnel, in favour of late noise.
    const log = Array.from({ length: PAYWALL_EVENT_CAP }, (_, i) =>
      ev(i % 2 === 0 ? 'paywall_shown' : 'paywall_dismissed', i + 1)
    );
    const next = appendPaywallEvent(log, ev('save_blocked_by_limit', 9999));
    assert.equal(next, log);
    assert.equal(next[0].at, 1, 'the first event survived');
  });
});

describe('mergePaywallEvents', () => {
  it('unions two devices oldest-first', () => {
    // A union, not a replace: the paywall is met on every device the user owns,
    // and dropping a phone's blocks would understate the exact number the limit
    // is judged on.
    const a = [ev('save_blocked_by_limit', 30), ev('paywall_shown', 10)];
    const b = [ev('paywall_dismissed', 20)];
    const merged = mergePaywallEvents(a, b);
    assert.deepEqual(
      merged.map((e) => e.at),
      [10, 20, 30]
    );
  });

  it('is idempotent — re-merging the same log changes nothing', () => {
    // The property the whole sign-in path rests on: a retried push or a doubled
    // auth event must converge, not duplicate.
    const log = [ev('paywall_shown', 1), ev('paywall_dismissed', 2)];
    const once = mergePaywallEvents(log, []);
    assert.deepEqual(mergePaywallEvents(once, log), once);
    assert.deepEqual(mergePaywallEvents(once, once), once);
  });

  it('keeps two identical-content events with different ids', () => {
    // Hitting the wall twice at the same count is a real, distinct event — and
    // the user who does it is the most interesting one in the dataset. Keying
    // on content would silently collapse them.
    const merged = mergePaywallEvents(
      [{ id: 'a', name: 'save_blocked_by_limit', at: 5, savedCount: 50 }],
      [{ id: 'b', name: 'save_blocked_by_limit', at: 5, savedCount: 50 }]
    );
    assert.equal(merged.length, 2);
  });

  it('first writer wins for a repeated id', () => {
    // Re-merging must never swap a stored event for a different one wearing the
    // same identity.
    const merged = mergePaywallEvents(
      [{ id: 'x', name: 'paywall_cta_clicked', at: 1, planId: 'plus_annual' }],
      [{ id: 'x', name: 'paywall_cta_clicked', at: 1, planId: 'plus_monthly' }]
    );
    assert.deepEqual(merged.map((e) => e.planId), ['plus_annual']);
  });

  it('orders deterministically when two events share a timestamp', () => {
    // Same millisecond on two devices is possible, so the sort must not depend
    // on which log was passed first.
    const a = { id: 'a', name: 'paywall_shown' as const, at: 5 };
    const b = { id: 'b', name: 'paywall_dismissed' as const, at: 5 };
    assert.deepEqual(
      mergePaywallEvents([a], [b]).map((e) => e.id),
      mergePaywallEvents([b], [a]).map((e) => e.id)
    );
  });

  it('respects the cap', () => {
    const a = Array.from({ length: PAYWALL_EVENT_CAP }, (_, i) =>
      ev('paywall_shown', i + 1)
    );
    const b = [ev('paywall_dismissed', PAYWALL_EVENT_CAP + 1)];
    assert.equal(mergePaywallEvents(a, b).length, PAYWALL_EVENT_CAP);
  });
});

describe('sanitizePaywallLog', () => {
  it('returns [] for anything that is not an array', () => {
    // The stored value is JSON from an older build or another device.
    for (const raw of [null, undefined, 0, 'x', {}]) {
      assert.deepEqual(sanitizePaywallLog(raw), []);
    }
  });

  it('drops malformed entries and keeps well-formed ones', () => {
    const out = sanitizePaywallLog([
      null,
      { id: 'a', name: 'not_an_event', at: 1 },
      { id: 'b', name: 'paywall_shown' }, // no timestamp
      { id: 'c', name: 'paywall_shown', at: 'soon' },
      { id: 'd', name: 'paywall_shown', at: 7, savedCount: 12 },
    ]);
    assert.deepEqual(out, [
      { id: 'd', name: 'paywall_shown', at: 7, savedCount: 12 },
    ]);
  });

  it('drops optional fields of the wrong type rather than passing them through', () => {
    const out = sanitizePaywallLog([
      { id: 'a', name: 'paywall_cta_clicked', at: 1, planId: 42, milestone: 'fifty' },
    ]);
    assert.deepEqual(out, [{ id: 'a', name: 'paywall_cta_clicked', at: 1 }]);
  });

  it('never synthesises a missing id', () => {
    // A fabricated id would look stable and would not be, so the same event
    // would duplicate on every merge. It keeps '' and merges on content.
    const out = sanitizePaywallLog([{ name: 'paywall_shown', at: 1 }]);
    assert.deepEqual(out, [{ id: '', name: 'paywall_shown', at: 1 }]);
    assert.equal(mergePaywallEvents(out, out).length, 1);
  });

  it('round-trips a log it produced', () => {
    const log = [
      ev('saved_words_count', 1, { milestone: 10, savedCount: 10 }),
      ev('save_blocked_by_limit', 2, { savedCount: 50 }),
      ev('paywall_shown', 3, { savedCount: 50 }),
      ev('paywall_cta_clicked', 4, { planId: 'plus_annual', savedCount: 50 }),
    ];
    assert.deepEqual(sanitizePaywallLog(log), log);
  });
});
