'use client';

import { useEffect, useState } from 'react';
import { getSession } from '@/lib/auth';
import { useEntitlements } from '@/lib/entitlements/useEntitlements';
import { requestPaywall } from '@/lib/entitlements/paywallBus';
import {
  formatStat,
  STAT_METRICS,
  type StatsResponse,
} from '@loro/core/entitlements/stats';
import { LockIcon } from '@/components/icons/Icons';

/**
 * /profile — the Loro Plus statistics panel.
 *
 * THE VALUES ARE NOT IN THE PAGE FOR FREE USERS. This is the whole design
 * constraint: /api/entitlements/stats decides the tier server-side and a
 * free-tier response contains metric labels and no numbers at all. A CSS blur
 * over real data is defeated by one devtools inspection, and being caught doing
 * it costs more trust than the feature could ever earn. So the lock here is the
 * absence of data, and the visual treatment is only there to explain the
 * absence.
 *
 * REAL LAYOUT, REAL LABELS. The locked state renders the same four tiles in the
 * same grid with their true names and hints — "Longest streak", "Recall
 * accuracy" — because a specific offer converts and a mystery box does not. What
 * is hidden is the number, which is the only part worth paying for.
 *
 * INVISIBLE WHILE THE FLAG IS OFF. The panel renders nothing unless the paywall
 * is live, so enabling it ADDS a locked offer rather than taking working
 * statistics away from free users. A feature that appears and immediately gets
 * confiscated is the one version of this that would read as a bait and switch.
 */

const COPY = {
  title: 'Statistics',
  cta: 'Get Loro Plus — unlimited saved words and statistics',
  locked: 'Locked',
  error: 'Statistics are unavailable right now.',
} as const;

function Tile({
  label,
  hint,
  value,
}: {
  label: string;
  hint: string;
  /** null renders the locked placeholder — there is no number to render. */
  value: string | null;
}) {
  return (
    <div className="rounded-3xl bg-surface px-4 py-4">
      {value === null ? (
        // Not a blurred number: a placeholder standing where one would be. It
        // is the right width to preserve the layout and carries no information,
        // because none was sent.
        <p
          aria-hidden
          className="text-3xl font-bold tracking-widest text-text/15 select-none"
        >
          ···
        </p>
      ) : (
        <p className="text-3xl font-bold tabular-nums tracking-tight text-text">
          {value}
        </p>
      )}
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted/60">{hint}</p>
      {value === null && <span className="sr-only">{COPY.locked}</span>}
    </div>
  );
}

export function PlusStatistics() {
  const { paywallActive, isAnonymous, tier, savedCount, limit, ready } =
    useEntitlements();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  // Only signed-in users, and only once the paywall exists. `visible` gates the
  // fetch as well as the render, so a free production user never even causes a
  // request for numbers they cannot have.
  const visible = ready && paywallActive && !isAnonymous;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      const session = await getSession();
      const token = session?.access_token;
      if (!token || cancelled) return;
      try {
        // `lock=1` is honoured by the route in dev only, and is what makes the
        // locked state reachable while PAYWALL_ENABLED is still false: without
        // it the route would unlock every signed-in user (there is no Plus to
        // sell yet) and the state below could never be seen or reviewed.
        const query = tier === 'free' ? '?lock=1' : '';
        const res = await fetch(`/api/entitlements/stats${query}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        setStats((await res.json()) as StatsResponse);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, tier]);

  if (!visible) return null;

  const metrics = stats?.metrics ?? STAT_METRICS;
  const values = stats && !stats.locked ? stats.values : null;
  const locked = stats === null || stats.locked;

  const openPaywall = () => {
    requestPaywall({ reason: 'statistics', savedCount, limit });
  };

  return (
    <section className="space-y-2">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-muted">
        {COPY.title}
      </h2>

      {failed ? (
        <p className="rounded-3xl bg-surface px-4 py-5 text-sm text-muted">
          {COPY.error}
        </p>
      ) : (
        <div className="relative">
          <div className="grid grid-cols-2 gap-2">
            {metrics.map((metric) => (
              <Tile
                key={metric.key}
                label={metric.label}
                hint={metric.hint}
                value={
                  values ? formatStat(metric, values[metric.key]) : null
                }
              />
            ))}
          </div>

          {locked && (
            // An overlay, not a replacement: the real tiles stay legible
            // underneath so the offer is anchored to what it unlocks. The scrim
            // is light — there is nothing under it to protect.
            <div className="absolute inset-0 flex items-end justify-center rounded-3xl bg-background/45 p-3 backdrop-blur-[1px]">
              <button
                type="button"
                onClick={openPaywall}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-center text-[13px] font-semibold leading-tight text-background transition-transform active:scale-[0.99]"
              >
                <LockIcon width={14} height={14} />
                {COPY.cta}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
