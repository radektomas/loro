import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { signInWithApple, signInWithGoogle } from '@loro/core/auth';
import type { SignInResult } from '@loro/core/auth';
import { AUTH_REDIRECT_URL } from '../platform/config';
import { exchangeAuthUrl } from './exchange';

/**
 * The two native sign-in providers.
 *
 * Magic link is NOT here: it needs no native module and no platform code at
 * all — core's signInWithMagicLink already passes the app scheme through
 * getAuthRedirectTo, and the link comes back through exchange.ts like any
 * other callback. Only these two need a native sheet.
 *
 * BOTH RETURN core's {ok, error} SHAPE, plus a `cancelled` flag. Cancelling is
 * not a failure and must not raise an error banner — a user who backs out of
 * the Apple sheet has done something completely normal.
 */

export type NativeSignInResult = SignInResult & { cancelled?: boolean };

const CANCELLED: NativeSignInResult = { ok: false, cancelled: true };

// ------------------------------------------------------------------- google

/**
 * Google, via the system auth session.
 *
 * WHY NOT JUST CALL core's signInWithGoogle AND LET IT REDIRECT. There is
 * nothing to redirect: supabase-js only self-navigates in a browser
 * (`isBrowser() && !skipBrowserRedirect`), so on RN it would build the consent
 * URL, navigate nowhere, and resolve as if it had succeeded. Hence
 * skipBrowserRedirect and driving the URL ourselves.
 *
 * openAuthSessionAsync — NOT openBrowserAsync, and not a WebView. It is
 * ASWebAuthenticationSession on iOS, which is the only in-app option Google
 * accepts: embedded webviews are refused outright with `disallowed_useragent`,
 * because a webview the app controls could read the password. It also owns the
 * `loro://` redirect: iOS hands the URL straight back as the call's return
 * value rather than routing it through the OS, so this flow resolves HERE
 * rather than in exchange.ts's global listener.
 */
export async function startGoogleSignIn(): Promise<NativeSignInResult> {
  const start = await signInWithGoogle({ skipBrowserRedirect: true });
  if (!start.ok) return start;
  if (!start.url) {
    return { ok: false, error: 'Could not start Google sign-in.' };
  }

  const result = await WebBrowser.openAuthSessionAsync(
    start.url,
    AUTH_REDIRECT_URL
  );

  // 'cancel' is the iOS user dismissing the sheet; 'dismiss' is the same
  // gesture on some OS versions. Neither is an error.
  if (result.type !== 'success') return CANCELLED;

  const exchanged = await exchangeAuthUrl(result.url);
  if (exchanged.status === 'signed-in') return { ok: true };
  if (exchanged.status === 'error') {
    return { ok: false, error: exchanged.message };
  }
  // 'ignored' means the redirect carried neither a code nor a token hash —
  // shape we should never see from a completed OAuth round trip.
  return { ok: false, error: 'Google sign-in returned an unexpected reply.' };
}

// -------------------------------------------------------------------- apple

/**
 * True only where Sign in with Apple can actually run.
 *
 * The Platform check is the cheap half and the honest one: the module is iOS-
 * only, and App Store guideline 4.8 requires the button only on Apple
 * platforms. isAvailableAsync additionally covers older iOS versions.
 */
export function isAppleSignInSupported(): boolean {
  return Platform.OS === 'ios';
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (!isAppleSignInSupported()) return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    // Native module absent — an old dev client built before this dependency
    // landed. Hide the button rather than crash the screen that renders it.
    return false;
  }
}

/**
 * A raw nonce with real entropy: 32 bytes, hex.
 *
 * DELIBERATELY NOT platformCrypto.randomUUID(). That wrapper's last-resort
 * branch is `Date.now() + Math.random()`, which is correct for its own job —
 * opaque merge keys for funnel events, where a weak id costs one analytics row
 * — and wrong for this one. A guessable nonce weakens the replay protection
 * that the nonce exists to provide. So there is no fallback here: if the
 * native crypto module is unreachable we fail the sign-in rather than issue a
 * predictable one.
 */
function rawNonce(): string {
  const bytes = Crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Apple, via the native sheet.
 *
 * THE NONCE IS HASHED ONE WAY AND SENT RAW THE OTHER, and getting this
 * backwards is the classic failure:
 *   Apple  <- sha256(raw)   embedded verbatim in the token's `nonce` claim
 *   Supabase <- raw         it hashes, then compares against that claim
 * Send the hash to Supabase and it compares sha256(sha256(raw)) against
 * sha256(raw) — a rejection that reads exactly like a misconfigured provider.
 *
 * FULL_NAME AND EMAIL ARRIVE EXACTLY ONCE, on the very first authorisation for
 * this Apple ID + app pair. Every later sign-in returns nulls for both, by
 * design, and Apple offers no way to re-request them (short of the user
 * revoking the app in iOS Settings). We do not depend on either: the session's
 * identity comes from the token, and the email Supabase stores comes from the
 * token's claims — so a repeat sign-in works fine. Anything wanting the user's
 * NAME would have to capture it on that first pass and persist it, which
 * nothing does today.
 */
export async function startAppleSignIn(): Promise<NativeSignInResult> {
  if (!isAppleSignInSupported()) {
    return { ok: false, error: 'Apple sign-in is only available on iOS.' };
  }

  let nonce: string;
  let hashedNonce: string;
  try {
    nonce = rawNonce();
    hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      nonce
    );
  } catch {
    return { ok: false, error: 'Could not start Apple sign-in securely.' };
  }

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    // The module rejects with ERR_REQUEST_CANCELED when the user backs out.
    const code = (e as { code?: string } | null)?.code;
    if (code === 'ERR_REQUEST_CANCELED') return CANCELLED;
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Apple sign-in failed.',
    };
  }

  // Typed nullable by the module. A successful authorisation always carries
  // one, so this is a type guard rather than a case we expect.
  if (!credential.identityToken) {
    return { ok: false, error: 'Apple did not return an identity token.' };
  }

  return signInWithApple({
    identityToken: credential.identityToken,
    rawNonce: nonce,
  });
}
