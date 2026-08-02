// Relative and extension-ed, not '@/lib/…': shared by a route handler and a
// client component, and kept import-free so neither drags the other's runtime
// in (same rule as lib/starterDeck.ts).

/**
 * The shape of the Loro Plus statistics payload — the contract between
 * /api/entitlements/stats and the /profile section that renders it.
 *
 * THE LOCK IS IN THE PAYLOAD, not in the CSS. A locked response carries the
 * metric labels and no values, so there is nothing in the DOM to un-blur. This
 * type is where that is enforced: `values` exists only on the unlocked variant,
 * so a component cannot read a number the server refused to send, and the
 * server cannot forget to strip one — a locked response that included values
 * would not typecheck.
 *
 * The labels ship in both variants on purpose. A free user should see the real
 * layout with the real metric names: "Longest streak — locked" is an honest
 * offer that says exactly what is behind the wall, where four grey rectangles
 * are a mystery box. Nobody buys a mystery box.
 */

export type StatMetricKey =
  | 'mastered'
  | 'accuracy'
  | 'longestStreak'
  | 'reviews';

export type StatMetric = {
  key: StatMetricKey;
  label: string;
  /** How to render the value. 'percent' appends %; 'count' is a bare number. */
  format: 'count' | 'percent';
  /** One line under the number, in both variants — it is part of the offer. */
  hint: string;
};

/**
 * The metric set, defined once and served BY the route so a deployment cannot
 * end up with a client asking for metrics the server does not compute.
 *
 * Deliberately not the same numbers /profile already shows for free (learned,
 * saved, current streak, this week). Locking a metric the user can currently
 * see would be a takeaway, and taking something away to sell it back is the
 * one move that would make this paywall feel dishonest. Every metric here is
 * NEW: nothing on the free profile stops working when the flag flips.
 */
export const STAT_METRICS: readonly StatMetric[] = [
  {
    key: 'mastered',
    label: 'Mastered',
    format: 'count',
    hint: 'Words at the top Leitner box',
  },
  {
    key: 'accuracy',
    label: 'Recall accuracy',
    format: 'percent',
    hint: 'Correct answers, all time',
  },
  {
    key: 'longestStreak',
    label: 'Longest streak',
    format: 'count',
    hint: 'Best run of practice days',
  },
  {
    key: 'reviews',
    label: 'Reviews done',
    format: 'count',
    hint: 'Every word you have typed back',
  },
] as const;

/**
 * Exactly one number per metric, and nothing else.
 *
 * Notably NOT the saved-word total: the capacity meter reads that from the local
 * cache, because that is the number the save gate itself counts and a user must
 * never be shown a ceiling measured differently from the one enforced on them.
 * Sending a second, server-derived copy would be an invitation for the two to
 * disagree by one during a sync.
 */
export type StatValues = Record<StatMetricKey, number>;

export type StatsResponse =
  | {
      locked: true;
      tier: 'free' | 'plus';
      metrics: readonly StatMetric[];
    }
  | {
      locked: false;
      tier: 'free' | 'plus';
      metrics: readonly StatMetric[];
      values: StatValues;
    };

/** Render one metric's value. Kept here so the route and the component agree
    on formatting without the component importing the route. */
export function formatStat(metric: StatMetric, value: number): string {
  return metric.format === 'percent' ? `${value}%` : String(value);
}
