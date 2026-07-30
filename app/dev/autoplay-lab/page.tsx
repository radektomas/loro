import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AutoplayLab } from './AutoplayLab';

/**
 * /dev/autoplay-lab — empirical iOS Safari autoplay diagnostics for the feed.
 *
 * DEV ONLY. NODE_ENV is inlined at build time, so in a production build this
 * route resolves to notFound() and the lab is unreachable there. noindex is
 * belt-and-braces for a preview deployment built with NODE_ENV=development.
 */
/**
 * A static `metadata` export is resolved for the matched segment even when the
 * page itself calls notFound(), which put this page's title in the production
 * 404's flight payload (verified). Generating it instead keeps the route's
 * existence out of a production response entirely.
 */
export function generateMetadata(): Metadata {
  if (process.env.NODE_ENV === 'production') return {};
  return {
    title: 'Autoplay lab — dev only',
    robots: { index: false, follow: false },
  };
}

export default function AutoplayLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AutoplayLab />;
}
