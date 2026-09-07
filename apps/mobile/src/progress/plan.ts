import { getFrequency } from '../onboarding/flow';

/**
 * THE PLAN — the onboarding answer, finally read back.
 *
 * Screen 9 asks "How often do you want to practise?", writes the answer to
 * loro.mobile.frequency, and until 2026-09-07 nothing ever read it again.
 * The plan-build screen even showed it back as "your pace" and then the app
 * forgot. This is the one place that turns the answer into numbers, so the
 * Today card, the week card and the day-done moment all aim at the same
 * target and the copy can say "your plan" without lying.
 *
 * THE NUMBERS ARE THE OPTION'S OWN COPY TURNED INTO ANSWERS, the same way
 * steps.tsx turns it into weekly minutes for the plan-build sum line:
 *
 *   light    "A few times a week · About 5 minutes"  → 3 answers, 3 days
 *   daily    "Every day · About 10 minutes"          → 5 answers, 7 days
 *   serious  "As much as I can · 20 minutes or more" → 10 answers, 7 days
 *
 * An "answer" is one correct blank — green recall or blue fill, the same
 * pair the streak day is logged from — and the catalog runs at roughly
 * three blanks per minute-long clip, so 5 answers is two or three videos:
 * a goal that is met on an ordinary evening, not a chore. Change the copy
 * in FREQUENCY.options and these must move with it.
 *
 * NO ANSWER (skipped onboarding, or an install from before the screen
 * existed) gets the daily numbers with `pace: null`, and the copy drops
 * "your plan" for "daily goal" — a target the app set, said as such.
 */
export type Pace = 'light' | 'daily' | 'serious';

export type Plan = {
  /** The onboarding answer, or null when it was never given. */
  pace: Pace | null;
  /** Correct answers that complete a day. */
  wordsPerDay: number;
  /** Days a week the plan aims for — the week card's "N of M". */
  daysPerWeek: number;
  /** "every day" / "a few times a week" / "as much as you can" — lowercase,
      for mid-sentence use. Null when there is no plan to name. */
  paceLabel: string | null;
};

const PLANS: Record<Pace, Omit<Plan, 'pace'>> = {
  light: { wordsPerDay: 3, daysPerWeek: 3, paceLabel: 'a few times a week' },
  daily: { wordsPerDay: 5, daysPerWeek: 7, paceLabel: 'every day' },
  serious: { wordsPerDay: 10, daysPerWeek: 7, paceLabel: 'as much as you can' },
};

const DEFAULT_PLAN: Plan = {
  pace: null,
  wordsPerDay: PLANS.daily.wordsPerDay,
  daysPerWeek: PLANS.daily.daysPerWeek,
  paceLabel: null,
};

function isPace(value: string | null): value is Pace {
  return value === 'light' || value === 'daily' || value === 'serious';
}

/** Pure: the plan for a stored frequency answer. */
export function planFor(frequency: string | null): Plan {
  if (!isPace(frequency)) return DEFAULT_PLAN;
  return { pace: frequency, ...PLANS[frequency] };
}

/** The device's plan, read from MMKV. Cheap; read it where it is used. */
export function getPlan(): Plan {
  return planFor(getFrequency());
}
