'use client';

import { useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { CloseIcon } from '@/components/icons/Icons';
import { defaultPlan, getPlans, type PricedPlan } from '@loro/core/entitlements/plans';
import type { PaywallReason } from '@/lib/entitlements/paywallBus';

/**
 * The paywall moment: what a user sees when a save would exceed the free
 * saved-word limit.
 *
 * BUILT ON THE SHARED Sheet PRIMITIVE, the same bottom sheet the word sheet,
 * the glossary and the account prompt use. A paywall that arrives as an
 * unfamiliar full-screen interstitial announces "different rules apply here";
 * arriving in the app's own vocabulary keeps it a normal part of the product.
 *
 * NO PRICE IS TYPED IN THIS FILE. Every number comes from getPlans() — the
 * monthly-equivalent and the discount badge are arithmetic over the two catalog
 * prices, so a price change in lib/entitlements/config.ts moves this UI and
 * cannot leave a stale "$5/mo · save 50%" behind. Grep this file for a digit:
 * there isn't one.
 *
 * THE CTA IS A PLACEHOLDER, deliberately and visibly. There is no payment
 * provider, no checkout and no Stripe in this codebase. It logs the selected
 * plan and says so. The instrumentation is the point of shipping it early: the
 * ratio of paywall_cta_clicked to paywall_shown, and which plan id it carries,
 * is the only honest evidence about whether the limit and the prices are near
 * right — and it is evidence that has to be collected BEFORE the payment
 * integration is worth building.
 */

/**
 * Copy per entry point. The shared lines say the same thing either way; the
 * opening does not, because being refused a save and being curious about a
 * locked panel are not the same experience and copy that pretends otherwise
 * reads as a form letter.
 */
const REASON_COPY: Record<
  PaywallReason,
  { title: string; body: (savedCount: number, limit: number) => string }
> = {
  save_limit: {
    title: 'You have filled your free vocabulary',
    body: (savedCount, limit) =>
      `${savedCount} of ${limit} saved words used. Loro Plus lifts the ceiling — and unlocks your learning statistics.`,
  },
  statistics: {
    title: 'Statistics are part of Loro Plus',
    body: (savedCount) =>
      `Mastery, recall accuracy, your best streak — measured across all ${savedCount} words you have chosen. Plus lifts the saved-word limit too.`,
  },
};

const COPY = {
  /** Said plainly, because it is the thing a blocked user most needs to hear
      and the thing they will least expect. */
  reassurance:
    'Everything you have saved stays yours. Keep watching, keep reviewing — nothing you already have is locked.',
  cta: 'Get Loro Plus',
  ctaPending: 'Coming soon — thanks for the nudge',
  dismiss: 'Not now',
  perMonth: '/mo',
  save: (percent: number) => `Save ${percent}%`,
} as const;

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: PricedPlan;
  selected: boolean;
  onSelect: () => void;
}) {
  // The annual plan earns the emphasis by being the better deal, and it says so
  // with a derived number rather than a designed one.
  const featured = plan.discountPercent > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl px-4 py-3 text-left transition-all active:scale-[0.99] ${
        selected
          ? 'bg-accent-soft ring-2 ring-accent'
          : 'bg-surface ring-1 ring-text/10 hover:ring-text/20'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold capitalize text-text">
          {plan.interval === 'year' ? 'Yearly' : 'Monthly'}
        </span>
        {featured && (
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">
            {COPY.save(plan.discountPercent)}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className={`font-bold tabular-nums tracking-tight ${
            featured ? 'text-2xl text-text' : 'text-xl text-text'
          }`}
        >
          {plan.monthlyEquivalentLabel}
        </span>
        <span className="text-xs font-semibold text-muted">{COPY.perMonth}</span>
      </div>
      {/* The full charge, always visible. A monthly-equivalent shown without
          the amount that actually leaves the account is the oldest trick in
          subscription pricing and we are not doing it. */}
      <p className="mt-0.5 text-[11px] text-muted">{plan.billedLabel}</p>
    </button>
  );
}

export function PaywallModal({
  reason,
  savedCount,
  limit,
  onCta,
  onDismiss,
}: {
  reason: PaywallReason;
  savedCount: number;
  limit: number;
  /** Fires with the selected plan id. Logging lives in the host. */
  onCta: (planId: string) => void;
  onDismiss: () => void;
}) {
  const plans = getPlans();
  const [selectedId, setSelectedId] = useState(() => defaultPlan(plans).id);
  const [pending, setPending] = useState(false);
  const t = REASON_COPY[reason];

  const handleCta = () => {
    if (pending) return;
    onCta(selectedId);
    setPending(true);
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Darker than Sheet's own scrim: this covers whichever screen the save
          was attempted from, including any toast the save surface put up. */}
      <div className="absolute inset-0 bg-black/40" aria-hidden />
      <Sheet onClose={onDismiss}>
        <div className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold leading-snug tracking-tight text-text">
              {t.title}
            </h2>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close"
              className="-mt-1 shrink-0 rounded-full bg-surface p-2 text-muted transition-colors hover:text-text"
            >
              <CloseIcon width={18} height={18} />
            </button>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-muted">
            {t.body(savedCount, limit)}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted/70">
            {COPY.reassurance}
          </p>

          {/* Annual first and pre-selected (it is the catalog's default), with
              the monthly option present, equal-tappable and plainly readable —
              secondary by emphasis, never by obscurity. */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[...plans]
              .sort((a, b) => Number(b.default) - Number(a.default))
              .map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  selected={plan.id === selectedId}
                  onSelect={() => setSelectedId(plan.id)}
                />
              ))}
          </div>

          <button
            type="button"
            onClick={handleCta}
            disabled={pending}
            className={`mt-4 w-full rounded-full px-4 py-3.5 text-sm font-semibold transition-transform active:scale-[0.99] ${
              pending
                ? 'bg-accent-soft text-accent'
                : 'bg-accent text-background hover:brightness-110'
            }`}
          >
            {pending ? COPY.ctaPending : COPY.cta}
          </button>

          <button
            type="button"
            onClick={onDismiss}
            className="mt-2 w-full rounded-full bg-white/10 px-4 py-3 text-sm font-semibold text-text transition-transform active:scale-[0.99]"
          >
            {COPY.dismiss}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
