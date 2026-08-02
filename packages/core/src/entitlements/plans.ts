// Relative and extension-ed, not '@/lib/…': this module loads under plain node
// for its test (same rule as lib/starterDeck.ts).
import { PLANS, type Plan, type PlanId, type PlanInterval } from './config.ts';

/**
 * The price catalog as the UI consumes it: every plan with its derived numbers
 * already computed.
 *
 * ONE ACCESSOR, getPlans(region?). Components never touch PLANS and never see a
 * raw number — they render the labels on this object. Two consequences that
 * matter:
 *
 *  - A price change is a config.ts edit. No component, no copy string, and no
 *    test contains "9.99", "$5/mo" or "50% off", so none of them can be left
 *    behind. The paywall's discount badge is arithmetic, not a claim someone
 *    typed once and stopped checking.
 *  - Regional pricing is a change to THIS FILE ONLY. `region` is accepted and
 *    ignored today; when a per-region table exists it is selected here and
 *    every caller keeps working, because callers already ask for a priced
 *    catalog rather than building one.
 */

/** Months in one billing interval — the normalizer the comparison needs. */
const MONTHS_PER_INTERVAL: Record<PlanInterval, number> = {
  month: 1,
  year: 12,
};

export type PricedPlan = Plan & {
  /** priceUsd normalized to one month. Unrounded — rounding is display only. */
  monthlyEquivalentUsd: number;
  /**
   * Whole-percent saving against the most expensive per-month plan in the
   * catalog. 0 for that plan itself, so a badge can be shown on any plan with
   * a non-zero value and never needs to know which plan is "the annual one".
   */
  discountPercent: number;
  /** "$59.99" */
  priceLabel: string;
  /** "$5" — the monthly-equivalent, rounded for display. */
  monthlyEquivalentLabel: string;
  /** "per year" */
  intervalLabel: string;
  /** "$59.99 per year" — the honest full charge, for the fine print. */
  billedLabel: string;
};

/**
 * Format a USD amount for display.
 *
 * Drops a trailing ".00" — the annual plan's monthly-equivalent is 4.999, and
 * "$5/mo" is what a person would say. Real catalog prices keep their cents
 * ("$9.99") because a price that ends in .99 is never rounded away.
 */
export function formatUsd(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded)
    ? `$${rounded}`
    : `$${rounded.toFixed(2)}`;
}

/** Price per month, whatever the billing interval. */
export function monthlyEquivalent(plan: Plan): number {
  return plan.priceUsd / MONTHS_PER_INTERVAL[plan.interval];
}

/**
 * The priced catalog.
 *
 * @param region reserved. Ignored today; the USD catalog is returned for every
 *   region. It exists so the call sites are already region-aware on the day
 *   there is something to be aware of.
 */
export function getPlans(region?: string): PricedPlan[] {
  void region; // see the doc comment — deliberately unused, deliberately here.

  const monthly = PLANS.map(monthlyEquivalent);
  // The baseline is the priciest per-month option in the catalog, which is what
  // a buyer is actually choosing against. Deriving it (rather than naming the
  // monthly plan) keeps this correct if a third interval is ever added.
  const baseline = Math.max(...monthly);

  return PLANS.map((plan, i) => {
    const monthlyEquivalentUsd = monthly[i];
    const discountPercent =
      baseline > 0
        ? Math.round((1 - monthlyEquivalentUsd / baseline) * 100)
        : 0;
    const intervalLabel = plan.interval === 'year' ? 'per year' : 'per month';
    return {
      ...plan,
      monthlyEquivalentUsd,
      discountPercent,
      priceLabel: formatUsd(plan.priceUsd),
      monthlyEquivalentLabel: formatUsd(monthlyEquivalentUsd),
      intervalLabel,
      billedLabel: `${formatUsd(plan.priceUsd)} ${intervalLabel}`,
    };
  });
}

/**
 * The plan a fresh paywall should arrive pre-selected on: the one flagged
 * `default`, falling back to the first so this can never return undefined and
 * leave the modal with nothing selected.
 */
export function defaultPlan(plans: PricedPlan[] = getPlans()): PricedPlan {
  return plans.find((p) => p.default) ?? plans[0];
}

/** Look up one plan by id. Null for an unknown id (a stale stored selection). */
export function planById(
  id: string,
  plans: PricedPlan[] = getPlans()
): PricedPlan | null {
  return plans.find((p) => p.id === id) ?? null;
}

export type { PlanId, PlanInterval };
