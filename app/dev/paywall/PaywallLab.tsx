'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  FREE_TIER_SAVED_WORDS_LIMIT,
  GRANDFATHER_EXISTING_USERS,
  PAYWALL_ENABLED,
  SAVED_WORDS_MILESTONES,
  SAVE_PROMPT_THRESHOLD,
} from '@loro/core/entitlements/config';
import { getPlans } from '@loro/core/entitlements/plans';
import {
  devPaywallForced,
  devTierOverride,
  setDevPaywall,
  type Tier,
} from '@loro/core/entitlements/state';
import { requestPaywall } from '@loro/core/entitlements/paywallBus';
import { useEntitlements } from '@/lib/entitlements/useEntitlements';
import { storage } from '@loro/core/storage';
import { PaywallModal } from '@/components/paywall/PaywallModal';
import { PlusStatistics } from '@/components/paywall/PlusStatistics';
import { SavedWordsCapacity } from '@/components/paywall/SavedWordsCapacity';

/**
 * The paywall lab.
 *
 * Two ways to look at the paywall, and both are needed:
 *
 *  1. IN ISOLATION — render the modal and the profile panels directly, with no
 *     gate involved. This is how the copy, the derived prices and the layout get
 *     reviewed.
 *  2. LIVE — force the paywall on for this browser session and then go and use
 *     the app. Saving words in the feed then actually hits the gate, the modal
 *     opens from wherever the save happened, and the events land in the real
 *     log. This is the only way to find out whether the seam works, as opposed
 *     to whether the component renders.
 *
 * The force switch is session-layer-backed and compiles away in production
 * (@loro/core entitlements/state.ts), so nothing here can leak into a real
 * deployment.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-semibold tabular-nums text-text">
        {value}
      </span>
    </div>
  );
}

function Button({
  onClick,
  children,
  primary,
}: {
  onClick: () => void;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-xs font-semibold transition-transform active:scale-[0.98] ${
        primary
          ? 'bg-accent text-background'
          : 'bg-white/10 text-text hover:bg-white/15'
      }`}
    >
      {children}
    </button>
  );
}

export function PaywallLab() {
  const ent = useEntitlements();
  const plans = getPlans();
  const [isolated, setIsolated] = useState<'save_limit' | 'statistics' | null>(
    null
  );
  const forced = devPaywallForced();
  const override = devTierOverride();

  const setTier = (tier: Tier | null) => setDevPaywall({ tier });

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-8 pb-safe">
      <div className="mx-auto max-w-md space-y-6">
        <header>
          <h1 className="text-xl font-bold tracking-tight text-text">
            Paywall lab
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Dev only. The paywall ships dark — PAYWALL_ENABLED is{' '}
            <span className="font-semibold text-text">
              {String(PAYWALL_ENABLED)}
            </span>
            . Force it on below to exercise the real gate.
          </p>
        </header>

        {/* ---- the catalog, as the UI actually reads it ---- */}
        <section className="rounded-3xl bg-surface p-5">
          <h2 className="text-sm font-bold text-text">Catalog</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Everything below is derived from the two prices in config.ts. If a
            number here is wrong, it is wrong in one place.
          </p>
          <div className="mt-3">
            {plans.map((p) => (
              <Row
                key={p.id}
                label={p.id}
                value={`${p.priceLabel} ${p.intervalLabel} · ${p.monthlyEquivalentLabel}/mo · −${p.discountPercent}%${p.default ? ' · default' : ''}`}
              />
            ))}
          </div>
        </section>

        {/* ---- config + live entitlement state, side by side ---- */}
        <section className="rounded-3xl bg-surface p-5">
          <h2 className="text-sm font-bold text-text">Config</h2>
          <div className="mt-3">
            <Row label="SAVE_PROMPT_THRESHOLD" value={String(SAVE_PROMPT_THRESHOLD)} />
            <Row
              label="FREE_TIER_SAVED_WORDS_LIMIT"
              value={String(FREE_TIER_SAVED_WORDS_LIMIT)}
            />
            <Row label="PAYWALL_ENABLED" value={String(PAYWALL_ENABLED)} />
            <Row
              label="GRANDFATHER_EXISTING_USERS"
              value={String(GRANDFATHER_EXISTING_USERS)}
            />
            <Row label="milestones" value={SAVED_WORDS_MILESTONES.join(', ')} />
          </div>

          <h2 className="mt-5 text-sm font-bold text-text">
            useEntitlements()
          </h2>
          <div className="mt-3">
            <Row label="tier" value={ent.tier} />
            <Row label="savedCount" value={String(ent.savedCount)} />
            <Row label="limit" value={String(ent.limit)} />
            <Row label="canSaveMore" value={String(ent.canSaveMore)} />
            <Row label="remaining" value={String(ent.remaining)} />
            <Row label="isGrandfathered" value={String(ent.isGrandfathered)} />
            <Row label="isAnonymous" value={String(ent.isAnonymous)} />
            <Row label="paywallActive" value={String(ent.paywallActive)} />
          </div>
        </section>

        {/* ---- live: force the gate on and go use the app ---- */}
        <section className="rounded-3xl bg-surface p-5">
          <h2 className="text-sm font-bold text-text">Live gate</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Forcing the paywall on applies the real limit across this browser
            session. Saving a word in the feed past the ceiling will be refused
            and open the modal from there. The tier override stands in for a
            subscription nobody can buy yet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => setDevPaywall({ forced: !forced })} primary>
              {forced ? 'Paywall forced ON — turn off' : 'Force paywall ON'}
            </Button>
            <Button onClick={() => setTier('free')}>
              tier=free{override === 'free' ? ' ✓' : ''}
            </Button>
            <Button onClick={() => setTier('plus')}>
              tier=plus{override === 'plus' ? ' ✓' : ''}
            </Button>
            <Button onClick={() => setTier(null)}>
              tier=real{override === null ? ' ✓' : ''}
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-muted">
            Then:{' '}
            <Link href="/feed" className="font-semibold text-accent underline">
              /feed
            </Link>{' '}
            to hit the gate, or{' '}
            <Link href="/profile" className="font-semibold text-accent underline">
              /profile
            </Link>{' '}
            for the panels in place.
          </p>
        </section>

        {/* ---- isolation: the modal, no gate required ---- */}
        <section className="rounded-3xl bg-surface p-5">
          <h2 className="text-sm font-bold text-text">Modal, in isolation</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => setIsolated('save_limit')}>
              reason=save_limit
            </Button>
            <Button onClick={() => setIsolated('statistics')}>
              reason=statistics
            </Button>
            <Button
              onClick={() =>
                requestPaywall({
                  reason: 'save_limit',
                  savedCount: FREE_TIER_SAVED_WORDS_LIMIT,
                  limit: FREE_TIER_SAVED_WORDS_LIMIT,
                })
              }
            >
              via the real bus + host
            </Button>
          </div>
        </section>

        {/* ---- the profile panels, out of context ---- */}
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted">
            Profile panels
          </h2>
          <SavedWordsCapacity />
          <PlusStatistics />
          <p className="px-1 text-[11px] leading-relaxed text-muted">
            Both render nothing unless the paywall is active and (for
            statistics) a session exists. Force the paywall on above.
          </p>
        </section>

        {/* ---- the event log, which is the actual deliverable ---- */}
        <section className="rounded-3xl bg-surface p-5">
          <h2 className="text-sm font-bold text-text">Event log</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            The local log, as it would be mirrored to
            loro_profiles.paywall_events on sign-in.
          </p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-2xl bg-background p-3 text-[10px] leading-relaxed text-muted">
            {JSON.stringify(storage.getPaywallEvents(), null, 2)}
          </pre>
        </section>
      </div>

      {/* Rendered directly, bypassing the bus and the host — this is the copy
          and layout review path, and it deliberately logs nothing. */}
      {isolated && (
        <PaywallModal
          reason={isolated}
          savedCount={ent.savedCount}
          limit={
            Number.isFinite(ent.limit) ? ent.limit : FREE_TIER_SAVED_WORDS_LIMIT
          }
          onCta={() => {}}
          onDismiss={() => setIsolated(null)}
        />
      )}
    </main>
  );
}
