'use client';

import { useEntitlements } from '@/lib/entitlements/useEntitlements';

/**
 * /profile — the free tier's saved-word capacity.
 *
 * FRAMED AS CAPACITY, NOT AS A COUNTDOWN. "34 / 50 saved words" with a filling
 * bar, never "16 words left". The difference is not decoration: a countdown
 * makes every save feel like spending, which is a reason to stop saving — and
 * saving words is the behaviour the whole product exists to produce. A capacity
 * meter says the same thing without turning the core loop into a cost.
 *
 * For the same reason there is no warning colour as it fills, no "almost full"
 * nag, and no upgrade button here. The wall announces itself when it is actually
 * reached (components/paywall/PaywallModal.tsx); until then this is information,
 * not pressure.
 *
 * Renders nothing when the limit is Infinity — which is every user in
 * production today, every plus user, every grandfathered user, and every
 * anonymous user. There is no honest way to draw a meter with no ceiling, and
 * inventing one would be the first piece of paywall UI to leak.
 */

const COPY = {
  label: 'Saved words',
  of: (savedCount: number, limit: number) => `${savedCount} / ${limit}`,
  grandfathered: 'Unlimited — you were here before the limit.',
} as const;

export function SavedWordsCapacity() {
  const { ready, savedCount, limit, isGrandfathered, paywallActive } =
    useEntitlements();

  if (!ready) return null;

  // The one case worth saying out loud: a user who kept unlimited saves when the
  // ceiling appeared should be told why, or the absence of a meter everyone else
  // has looks like a bug.
  if (paywallActive && isGrandfathered) {
    return (
      <div className="rounded-3xl bg-surface px-5 py-4">
        <p className="text-sm font-semibold text-text">{COPY.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {COPY.grandfathered}
        </p>
      </div>
    );
  }

  if (!Number.isFinite(limit)) return null;

  const pct = Math.min(100, Math.round((savedCount / limit) * 100));

  return (
    <div className="rounded-3xl bg-surface px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-text">{COPY.label}</p>
        <p className="text-sm font-semibold tabular-nums text-muted">
          {COPY.of(savedCount, limit)}
        </p>
      </div>
      <div
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={savedCount}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={COPY.label}
      >
        {/* Accent throughout, including when full. Red here would read as an
            error, and filling your vocabulary is the opposite of one. */}
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
