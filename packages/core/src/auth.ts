import type { Session, User } from '@supabase/supabase-js';
import { getAuthRedirectTo, getSupabase, TABLES } from './supabase.ts';

/**
 * Supabase Auth for Loro — email magic-link, Google OAuth, Apple id-token.
 *
 * Signing in is always optional: it backs up progress and syncs it across
 * devices. Nothing in the core loop depends on any of these resolving, so
 * every function no-ops gracefully when Supabase isn't configured (or not
 * yet initialised — see initSupabase in ./supabase.ts).
 *
 * EVERY auth entry point below must pass the platform's redirect target
 * (getAuthRedirectTo) — omit it and Supabase falls back to the project's
 * Site URL, which lands sign-in on whatever domain that happens to name.
 * The web's "is auth enabled" render flag deliberately does NOT live here:
 * it must agree between server render and hydration, so the web derives it
 * from env vars in lib/supabaseInit.ts.
 */

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser(): Promise<User | null> {
  return (await getSession())?.user ?? null;
}

/** Subscribe to sign-in / sign-out. Returns an unsubscribe fn. */
export function onAuthChange(
  callback: (session: Session | null) => void
): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => subscription.unsubscribe();
}

export type SignInResult = { ok: boolean; error?: string };

/**
 * An OAuth start, which on some platforms is only HALF the flow.
 *
 * `url` is the provider's consent page. The web never needs it — supabase-js
 * navigates there itself — but RN has no navigation to hijack: it must open
 * the URL in a native auth session and catch the redirect back. So the URL is
 * surfaced rather than discarded, and `skipBrowserRedirect` lets the caller
 * say "hand me the URL, don't try to navigate".
 */
export type OAuthSignInResult = SignInResult & { url?: string };

/** Email magic link — no password. Sends a one-tap sign-in link. */
export async function signInWithMagicLink(email: string): Promise<SignInResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Sync is not configured.' };
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: getAuthRedirectTo() },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Google OAuth — out to Google and back to the platform's auth-callback
 * surface.
 *
 * Called with no arguments this is byte-for-byte the old behaviour: supabase-js
 * only self-navigates when `isBrowser() && !skipBrowserRedirect`, and an
 * absent option is `undefined`, which is falsy — so the web's two call sites
 * (SignInCard, SavePromptSheet) keep redirecting exactly as before and read
 * only `ok`/`error` from the result.
 *
 * RN passes `skipBrowserRedirect: true` and drives the returned `url` through
 * its own auth session instead.
 */
export async function signInWithGoogle(options?: {
  skipBrowserRedirect?: boolean;
}): Promise<OAuthSignInResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Sync is not configured.' };
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: getAuthRedirectTo(),
      skipBrowserRedirect: options?.skipBrowserRedirect,
    },
  });
  return error
    ? { ok: false, error: error.message }
    : { ok: true, url: data?.url ?? undefined };
}

/**
 * Apple Sign-In — exchange an Apple identity token for a Supabase session.
 *
 * DELIBERATELY TAKES THE CREDENTIAL RATHER THAN FETCHING IT. Obtaining the
 * token means expo-apple-authentication, a native iOS module; core is imported
 * by the Next.js web app and must stay platform-free (see the header of
 * ./supabase.ts — "core reads no env vars and touches no window"). So the
 * platform runs the native sheet and core owns only the exchange, which is the
 * half that is genuinely shared.
 *
 * THE NONCE IS TWO DIFFERENT VALUES AND MIXING THEM UP FAILS VERIFICATION.
 * The caller generates one random string, hands Apple its SHA-256 (Apple
 * embeds that hash in the token's `nonce` claim), and hands US the raw string.
 * Supabase hashes what it is given and compares. Passing the hash here means
 * comparing sha256(sha256(n)) against sha256(n) — a rejected token that looks
 * like a provider misconfiguration.
 *
 * Ships correct while the Apple provider is disabled project-side: Supabase
 * answers with an error, which becomes {ok:false} like any other failure.
 */
export async function signInWithApple(credential: {
  identityToken: string;
  /** The RAW nonce — NOT the hash that went to Apple. See above. */
  rawNonce: string;
}): Promise<SignInResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Sync is not configured.' };
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: credential.rawNonce,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * Create the user's loro_profiles row on first sign-in, stamping onboarded_at.
 * ignoreDuplicates keeps an existing row (and its original onboarded_at)
 * untouched, so this is safe to call on every sign-in. Relies on RLS scoping
 * the row to auth.uid(); if a DB trigger already inserts profiles, the upsert
 * simply finds nothing to do.
 */
export async function ensureProfile(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase
    .from(TABLES.profiles)
    .upsert(
      { id: userId, onboarded_at: new Date().toISOString() },
      { onConflict: 'id', ignoreDuplicates: true }
    );
  if (error) console.error('[loro] ensureProfile failed', error.message);
}

export type Profile = { level: string | null; onboardedAt: number | null };

export async function getProfile(): Promise<Profile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from(TABLES.profiles)
    .select('level, onboarded_at')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    level: data.level ?? null,
    onboardedAt: data.onboarded_at ? Date.parse(data.onboarded_at) : null,
  };
}

/** Persist onboarding state (level / onboarded_at) to the profile row. */
export async function updateProfile(patch: {
  level?: string;
  onboardedAt?: number;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const user = await getUser();
  if (!user) return;
  const row: Record<string, unknown> = { id: user.id };
  if (patch.level !== undefined) row.level = patch.level;
  if (patch.onboardedAt !== undefined)
    row.onboarded_at = new Date(patch.onboardedAt).toISOString();
  const { error } = await supabase
    .from(TABLES.profiles)
    .upsert(row, { onConflict: 'id' });
  if (error) console.error('[loro] updateProfile failed', error.message);
}
