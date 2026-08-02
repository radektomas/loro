import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLANS } from './config.ts';
import {
  defaultPlan,
  formatUsd,
  getPlans,
  monthlyEquivalent,
  planById,
} from './plans.ts';

/**
 * These tests deliberately assert almost nothing about the CURRENT prices.
 *
 * A test that says `assert.equal(annual.monthlyEquivalentLabel, '$5')` has to be
 * edited the day a price moves, which makes it a second place the price lives —
 * exactly the thing the catalog exists to prevent. So the assertions are about
 * the DERIVATION: that the monthly-equivalent is the price over its interval,
 * that the discount is measured against the priciest per-month option, and that
 * rounding never leaks into the arithmetic. Those hold at any price.
 */

describe('formatUsd', () => {
  it('drops a trailing .00 — "$5", not "$5.00"', () => {
    // The annual monthly-equivalent is 4.999…; "$5/mo" is what a person says.
    assert.equal(formatUsd(5), '$5');
    assert.equal(formatUsd(4.999), '$5');
  });

  it('keeps real cents', () => {
    assert.equal(formatUsd(9.99), '$9.99');
    assert.equal(formatUsd(59.99), '$59.99');
  });
});

describe('monthlyEquivalent', () => {
  it('normalizes a yearly price over twelve months', () => {
    assert.equal(
      monthlyEquivalent({
        id: 'plus_annual',
        interval: 'year',
        priceUsd: 120,
        default: true,
      }),
      10
    );
  });

  it('leaves a monthly price alone', () => {
    assert.equal(
      monthlyEquivalent({
        id: 'plus_monthly',
        interval: 'month',
        priceUsd: 9.99,
        default: false,
      }),
      9.99
    );
  });
});

describe('getPlans', () => {
  it('returns the whole catalog', () => {
    assert.equal(getPlans().length, PLANS.length);
  });

  it('ignores the region argument for now, without changing the answer', () => {
    // The argument exists so call sites are already region-aware. Until there
    // is a per-region table, every region must get the identical catalog —
    // silently returning something different would be worse than not accepting
    // the argument at all.
    assert.deepEqual(getPlans('cz'), getPlans());
    assert.deepEqual(getPlans(undefined), getPlans());
  });

  it('derives monthlyEquivalentUsd unrounded — rounding is display only', () => {
    for (const p of getPlans()) {
      const raw = p.priceUsd / (p.interval === 'year' ? 12 : 1);
      assert.equal(p.monthlyEquivalentUsd, raw);
    }
  });

  it('measures the discount against the priciest per-month plan', () => {
    const plans = getPlans();
    const baseline = Math.max(...plans.map((p) => p.monthlyEquivalentUsd));
    for (const p of plans) {
      assert.equal(
        p.discountPercent,
        Math.round((1 - p.monthlyEquivalentUsd / baseline) * 100)
      );
    }
  });

  it('gives the baseline plan no discount badge', () => {
    // Otherwise the monthly plan would advertise "Save 0%".
    const plans = getPlans();
    const dearest = plans.reduce((a, b) =>
      a.monthlyEquivalentUsd >= b.monthlyEquivalentUsd ? a : b
    );
    assert.equal(dearest.discountPercent, 0);
  });

  it('gives the cheaper plan a real, positive discount', () => {
    const best = getPlans().reduce((a, b) =>
      a.monthlyEquivalentUsd <= b.monthlyEquivalentUsd ? a : b
    );
    assert.ok(
      best.discountPercent > 0,
      'the emphasised plan must actually be a better deal'
    );
  });

  it('always states the full amount charged, not only the per-month figure', () => {
    // Showing "$5/mo" without "$59.99 per year" is the oldest trick in
    // subscription pricing. The label the modal renders has to contain both.
    for (const p of getPlans()) {
      assert.ok(p.billedLabel.includes(p.priceLabel));
      assert.ok(p.billedLabel.includes(p.intervalLabel));
    }
  });
});

describe('defaultPlan / planById', () => {
  it('has exactly one default in the catalog', () => {
    // Two defaults (or none) would leave the modal with an arbitrary or empty
    // pre-selection.
    assert.equal(PLANS.filter((p) => p.default).length, 1);
  });

  it('pre-selects the flagged default', () => {
    assert.equal(defaultPlan().default, true);
  });

  it('pre-selects the better-value plan', () => {
    // Not a coincidence worth leaving unasserted: the emphasised, pre-selected
    // plan must be the one that saves the user money.
    assert.ok(defaultPlan().discountPercent > 0);
  });

  it('resolves a known id and refuses an unknown one', () => {
    assert.equal(planById(defaultPlan().id)?.id, defaultPlan().id);
    assert.equal(planById('plus_lifetime'), null);
  });
});
