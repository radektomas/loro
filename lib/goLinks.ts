/**
 * The bio links: getloro.app/go/<slug> → App Store, tagged per channel.
 *
 * Instagram counts no bio-link taps (profile_links_taps only covers contact
 * buttons), so the tap is counted on our side, and Apple's campaign token
 * (ct=ig-<slug>, provider token pt from App Store Connect) lets App Analytics
 * report installs per channel. Plain relative imports: node --test loads this.
 */
import type { Account } from './cutReels.ts';

export const GO_SLUGS = {
  'radek-spanish': 'radek.spanish',
  'radek-explains': 'radek.explains.spanish',
  'loro-app': 'loro.app',
} as const satisfies Record<string, Account>;

export type GoSlug = keyof typeof GO_SLUGS;

const APP_ID = '6799623319';
/** App Store Connect provider token (Radek, 2026-11-11). Not a secret. */
const PROVIDER_TOKEN = '129194904';

export function isGoSlug(slug: string): slug is GoSlug {
  return Object.prototype.hasOwnProperty.call(GO_SLUGS, slug);
}

export function appStoreUrl(slug: string): string | null {
  if (!isGoSlug(slug)) return null;
  return `https://apps.apple.com/app/apple-store/id${APP_ID}?pt=${PROVIDER_TOKEN}&ct=ig-${slug}&mt=8`;
}

/** Link previews (Instagram/Facebook unfurl the bio link), crawlers and scripts. */
const BOT = /facebookexternalhit|facebot|twitterbot|slackbot|discordbot|whatsapp|telegrambot|bot\b|bot\/|crawler|spider|curl|wget|python-requests|headlesschrome/i;

export function uaKind(ua: string | null): 'human' | 'bot' {
  if (!ua || !ua.trim()) return 'bot';
  return BOT.test(ua) ? 'bot' : 'human';
}
