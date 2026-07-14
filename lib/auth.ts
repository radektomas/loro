import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured, TABLES } from '@/lib/supabase';

/**
 * Supabase Auth for Loro — email magic-link and Google OAuth.
 *
 * Signing in is always optional: it backs up progress and syncs it across
 * devices. Nothing in the core loop depends on any of these resolving, so
 * every function no-ops gracefully when Supabase isn't configured.
 */

export const authEnabled = isSupabaseConfigured;

function redirectTo(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}/auth/callback`;
}

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

/** Email magic link — no password. Sends a one-tap sign-in link. */
export async function signInWithMagicLink(email: string): Promise<SignInResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Sync is not configured.' };
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirectTo() },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Google OAuth — redirects out to Google and back to /auth/callback. */
export async function signInWithGoogle(): Promise<SignInResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Sync is not configured.' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo() },
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
