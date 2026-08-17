import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic config wrapper around app.json. app.json stays the single place the
 * app is DESCRIBED (Expo passes it in as `config`); this file exists for the
 * two things a static file cannot do:
 *
 *  1. REFUSE TO BUILD a production binary without a usable RevenueCat key.
 *     The runtime deliberately fails OPEN when the key is missing (see
 *     platform/purchases.ts) — safe for dev and preview, but in production it
 *     would ship the hard paywall unlocked for every install, silently. The
 *     runtime cannot tell "misconfigured build" from "user with no network
 *     yet"; the build machine can, so the check belongs here.
 *
 *  2. Tell the runtime which EAS profile built it. EAS_BUILD_PROFILE exists
 *     only at build time and is not an EXPO_PUBLIC_ var, so babel never
 *     inlines it — threading it through `extra` (read back via
 *     expo-constants) is the supported channel. purchases.ts uses it to
 *     escalate fail-open logging to error level in production binaries.
 *
 * Evaluated on the EAS build worker (EAS_BUILD_PROFILE is set there, with the
 * profile's env resolved — including the "environment": "production" server
 * vars), and by newer eas-cli locally before upload under the same contract.
 * In every other context — expo start, npx expo config, prebuild by hand —
 * EAS_BUILD_PROFILE is unset and the guard deliberately stays quiet.
 */

function assertProductionHasRevenueCatKey(): void {
  if (process.env.EAS_BUILD_PROFILE !== 'production') return;
  const key = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
  if (key.startsWith('appl_')) return;
  throw new Error(
    [
      key === ''
        ? 'Production build blocked: EXPO_PUBLIC_REVENUECAT_IOS_KEY is missing or empty.'
        : 'Production build blocked: EXPO_PUBLIC_REVENUECAT_IOS_KEY is set but is not a ' +
          'RevenueCat public iOS SDK key (it must start with "appl_").',
      'Without it the app builds with the paywall failing open — every install would be free.',
      '',
      'Set it in the EAS production environment (it is a public key, plaintext is fine):',
      '  eas env:create --environment production \\',
      '    --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --value appl_... --visibility plaintext',
      'or on expo.dev: project → Environment variables → production.',
      'The value is in the RevenueCat dashboard: Project settings → API keys → Apple App Store.',
    ].join('\n')
  );
}

/**
 * Same shape as the RevenueCat guard, same reasoning: platform/config.ts falls
 * back to 'https://example.com' as the player embed origin when this var is
 * missing — quiet in dev, but a production binary would ship every YouTube
 * embed pointed at a placeholder origin, and LegalLinks would silently paper
 * over it with its own hardcoded fallback.
 */
function assertProductionHasApiOrigin(): void {
  if (process.env.EAS_BUILD_PROFILE !== 'production') return;
  const origin = process.env.EXPO_PUBLIC_API_ORIGIN ?? '';
  if (origin.startsWith('https://')) return;
  throw new Error(
    [
      origin === ''
        ? 'Production build blocked: EXPO_PUBLIC_API_ORIGIN is missing or empty.'
        : `Production build blocked: EXPO_PUBLIC_API_ORIGIN ("${origin}") is not an https URL.`,
      'Without it the player boots against the example.com placeholder origin.',
      '',
      'Set it in the EAS production environment:',
      '  eas env:create --environment production \\',
      '    --name EXPO_PUBLIC_API_ORIGIN --value https://www.getloro.app --visibility plaintext',
      'or on expo.dev: project → Environment variables → production.',
    ].join('\n')
  );
}

export default ({ config }: ConfigContext): ExpoConfig => {
  assertProductionHasRevenueCatKey();
  assertProductionHasApiOrigin();
  return {
    ...config,
    // app.json always defines both; the fallbacks only satisfy ExpoConfig's
    // required fields, since `config` arrives as a Partial.
    name: config.name ?? 'Loro',
    slug: config.slug ?? 'radektomas',
    extra: {
      ...config.extra,
      // Omitted entirely when unset — expo's config normalisation rewrites a
      // literal null here to {}, which would leak a non-string to the
      // runtime read in platform/config.ts.
      ...(process.env.EAS_BUILD_PROFILE
        ? { easBuildProfile: process.env.EAS_BUILD_PROFILE }
        : {}),
    },
  };
};
