import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StarterClipBrowser } from './StarterClipBrowser';

/**
 * /dev/starter-clips — every clip that could open the starter deck, watchable.
 *
 * DEV ONLY, on the same mechanism as /dev/paywall and /dev/autoplay-lab:
 * NODE_ENV is inlined at build time, so in a production build this route
 * resolves to notFound() and nothing here ships. generateMetadata (rather than
 * a static export) keeps the route's existence out of the production 404's
 * flight payload.
 *
 * It exists because the three starter clips are the first thing 100% of
 * from-zero users see, they are the same three for everyone, and the ranking
 * that picks them cannot see whether a clip is any GOOD — clear speech, decent
 * framing, a place a stranger wants to spend their first thirty seconds. That
 * judgement needs a human watching, which needs a list of what the deck would
 * accept and a way to play each one. Curate the result into
 * STARTER_CLIP_ALLOWLIST (lib/starterRounds.ts).
 */
export function generateMetadata(): Metadata {
  if (process.env.NODE_ENV === 'production') return {};
  return {
    title: 'Starter clips — dev only',
    robots: { index: false, follow: false },
  };
}

export default function StarterClipsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <StarterClipBrowser />;
}
