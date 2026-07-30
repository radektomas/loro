'use client';

import { useCallback, useEffect, useState } from 'react';
import { storage } from '@/lib/storage';
import {
  onPaywallRequested,
  type PaywallRequest,
} from '@/lib/entitlements/paywallBus';
import { PaywallModal } from '@/components/paywall/PaywallModal';

/**
 * Mounted ONCE at the app root (app/layout.tsx). Listens for a blocked save and
 * puts the paywall on screen.
 *
 * WHY IT LIVES AT THE ROOT. The gate is inside storage.saveWord(), which is
 * called from the feed's word sheet, the glossary sheet, and whatever save
 * surface exists next. Threading a paywall callback down to each of them would
 * mean editing every one — and would let the next one forget. Here, a refused
 * save opens the paywall wherever it happened, and a new save surface inherits
 * the behaviour by writing no code at all.
 *
 * IT RENDERS NOTHING UNTIL ASKED, and it can only be asked by a save that was
 * actually refused (lib/storage.ts refuseSave). While PAYWALL_ENABLED is false
 * the gate never fires, so this component is inert in production — no flag check
 * of its own, no branch to get wrong, and nothing to strip out on launch day.
 *
 * ALL PAYWALL INSTRUMENTATION EXCEPT THE BLOCK ITSELF IS HERE. The block is
 * logged by the gate (it happens whether or not a modal is mounted); shown,
 * cta_clicked and dismissed are properties of this component's lifecycle, so
 * keeping them here means the funnel's four events have exactly two authors and
 * neither can double-log the other's.
 */
export function PaywallHost() {
  const [request, setRequest] = useState<PaywallRequest | null>(null);

  useEffect(
    () =>
      onPaywallRequested((next) => {
        setRequest(next);
        storage.logPaywallEvent({
          name: 'paywall_shown',
          at: Date.now(),
          savedCount: next.savedCount,
        });
      }),
    []
  );

  const handleCta = useCallback(
    (planId: string) => {
      storage.logPaywallEvent({
        name: 'paywall_cta_clicked',
        at: Date.now(),
        planId,
        savedCount: request?.savedCount,
      });
      // No checkout, no provider. The modal shows its own "coming soon" state;
      // the sheet stays open so the user can read it rather than being dropped
      // back into a feed with no explanation of what just happened.
    },
    [request]
  );

  const handleDismiss = useCallback(() => {
    storage.logPaywallEvent({
      name: 'paywall_dismissed',
      at: Date.now(),
      savedCount: request?.savedCount,
    });
    setRequest(null);
  }, [request]);

  if (!request) return null;

  return (
    <PaywallModal
      reason={request.reason}
      savedCount={request.savedCount}
      limit={request.limit}
      onCta={handleCta}
      onDismiss={handleDismiss}
    />
  );
}
