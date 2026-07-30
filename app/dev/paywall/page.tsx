import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PaywallLab } from './PaywallLab';

/**
 * /dev/paywall — the paywall, reachable before it is enabled.
 *
 * DEV ONLY, on the same mechanism as /dev/autoplay-lab: NODE_ENV is inlined at
 * build time, so in a production build this route resolves to notFound() and
 * nothing here ships. generateMetadata (rather than a static export) keeps the
 * route's existence out of the production 404's flight payload.
 *
 * It exists because a paywall that has never been looked at is a paywall that
 * will be looked at for the first time by a paying customer.
 */
export function generateMetadata(): Metadata {
  if (process.env.NODE_ENV === 'production') return {};
  return {
    title: 'Paywall lab — dev only',
    robots: { index: false, follow: false },
  };
}

export default function PaywallLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PaywallLab />;
}
