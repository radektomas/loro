import { Linking } from 'react-native';
import { getSupabase } from '@loro/core/supabase';

/**
 * The auth callback — RN's port of app/auth/callback/page.tsx.
 *
 * WHY THIS FILE HAS TO EXIST AT ALL. core builds its client with
 * `detectSessionInUrl: false` (supabase.ts), so supabase-js will NEVER pick a
 * session out of an incoming URL by itself. That is deliberate on both
 * platforms — one deterministic exchange path instead of two — and it means
 * the callback URL is inert until something calls the two branches below.
 *
 * THE TWO BRANCHES ARE THE WEB'S, UNCHANGED:
 *   ?code=…                 -> exchangeCodeForSession   (PKCE / OAuth / newer
 *                                                        magic links)
 *   ?token_hash=…&type=…    -> verifyOtp                (email OTP links)
 * A URL carrying neither is not an error — the OS hands us every `loro://`
 * open, including ones that have nothing to do with auth — so it is ignored.
 *
 * NOTHING HERE TOUCHES THE SESSION AFTERWARDS. A successful exchange fires
 * supabase-js's auth listener, which storage.initSync() subscribed to at boot,
 * and THAT is what runs the anonymous → signed-in merge. This file's entire
 * job is to turn a URL into a session and then get out of the way.
 */

/** A provider error handed back on the redirect itself (user cancelled,
    expired link). Supabase puts these in the fragment, not the query. */
function readError(url: URL): string | null {
  const fromHash = new URLSearchParams(url.hash.replace(/^#/, ''));
  return (
    fromHash.get('error_description') ??
    fromHash.get('error') ??
    url.searchParams.get('error_description') ??
    url.searchParams.get('error') ??
    null
  );
}

export type ExchangeResult =
  /** A session was established. */
  | { status: 'signed-in' }
  /** Not an auth URL — no code, no token hash. Nothing happened. */
  | { status: 'ignored' }
  | { status: 'error'; message: string };

/**
 * Turn a callback URL into a session.
 *
 * Safe to call with ANY url, including junk: it parses defensively and reports
 * 'ignored' rather than throwing, because the caller is a global OS listener
 * and a throw there is an unhandled rejection on a background thread.
 */
export async function exchangeAuthUrl(rawUrl: string): Promise<ExchangeResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { status: 'ignored' };
  }

  const providerError = readError(url);
  if (providerError) return { status: 'error', message: providerError };

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (!code && !(tokenHash && type)) return { status: 'ignored' };

  // Checked AFTER the shape checks so an unconfigured build still reports a
  // non-auth URL as 'ignored' rather than as a configuration error.
  const supabase = getSupabase();
  if (!supabase) {
    return { status: 'error', message: 'Sync is not configured.' };
  }

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: type as 'magiclink' | 'email' | 'signup' | 'recovery',
      });
      if (error) throw error;
    }
    return { status: 'signed-in' };
  } catch (e) {
    return {
      status: 'error',
      message: e instanceof Error ? e.message : 'Sign-in failed.',
    };
  }
}

/**
 * Listen for `loro://` opens for the whole app lifetime.
 *
 * BOTH HALVES ARE REQUIRED and they cover different launches:
 *   - getInitialURL() — the app was NOT running; the OS started it with the
 *     URL. The event never fires in this case.
 *   - addEventListener('url') — the app was already alive (the common magic-
 *     link path: you leave for Mail, come back).
 * Implementing only one produces a bug that reproduces on exactly half of
 * attempts, which is the worst kind to chase.
 *
 * Uses React Native's built-in Linking rather than expo-linking: the two
 * primitives needed are both in core RN (AuthorLine.tsx already uses it for
 * openURL), and expo-linking would be a native module added for `parse` and
 * `createURL` helpers this file does not need.
 *
 * `onResult` fires for every handled URL, including 'ignored', so a caller can
 * distinguish "nothing to do" from "signed in". Returns an unsubscribe.
 */
export function onAuthDeepLink(
  onResult: (result: ExchangeResult) => void
): () => void {
  let cancelled = false;

  const handle = (url: string | null) => {
    if (!url || cancelled) return;
    void exchangeAuthUrl(url).then((result) => {
      if (!cancelled) onResult(result);
    });
  };

  // The cold-start URL. Async, and the app may already have been torn down by
  // the time it resolves, hence the cancelled guard.
  void Linking.getInitialURL().then(handle);

  const sub = Linking.addEventListener('url', ({ url }) => handle(url));

  return () => {
    cancelled = true;
    sub.remove();
  };
}
