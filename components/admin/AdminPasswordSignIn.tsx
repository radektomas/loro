'use client';

import { useState } from 'react';
import { setPassword, signInWithPassword } from '@loro/core/auth';
import { authEnabled } from '@/lib/supabaseInit';
import { LockIcon } from '@/components/icons/Icons';

/**
 * Password sign-in for the admin screens — a door that does not depend on a
 * redirect coming back to the right place.
 *
 * WHY AN ADMIN-ONLY SURFACE AND NOT A FIELD ON SignInCard. SignInCard is the
 * product's one invitation to sign in, and it is deliberately passwordless:
 * magic link or Google, nothing to forget, nothing to leak. Putting a password
 * field on it would hand every user an account credential to manage for the
 * sake of one operator's screen. This lives in components/admin/ and is
 * mounted by the admin pages only.
 *
 * WHO SIGNS IN HERE. Usually not a person's own account but the dedicated one
 * provisioned by scripts/dashboard-account.mts — a Supabase user that exists
 * only to open /admin/*, holds a password rather than an OAuth identity, and
 * so cannot be locked out by a redirect landing on the wrong origin. Any admin
 * who has set a password on their own account can use it too; the form does
 * not care which, because loro_admins is what decides.
 *
 * WHAT IT DOES NOT DO — and this is the part that is easy to get wrong later.
 * It is NOT a password gate over the dashboard, and a password does not grant
 * admin. Every number on /admin/analytics comes from a SECURITY DEFINER RPC
 * that re-checks loro_is_admin() against auth.uid() (see lib/analytics.ts), so
 * the only thing that opens those reports is a real Supabase session belonging
 * to a real row in loro_admins. This form produces exactly that session and
 * changes nothing else: a stranger with the password still has to be an admin,
 * and an admin with no password still gets in the other two ways. If someone
 * ever "simplifies" this into a client-side password check that flips a
 * boolean, the page will render and every panel will fail with "admin only".
 */

const FIELD =
  'w-full rounded-2xl bg-background px-3 py-2.5 text-sm text-text placeholder:text-muted/60 outline-none ring-1 ring-white/10 focus:ring-accent/60';

/** Where the last successful email is remembered. NEVER the password: this is
    localStorage, readable by any script that ever runs on this origin. */
const REMEMBERED_EMAIL = 'loro.admin.email';

export function AdminPasswordSignIn() {
  // Lazy initialiser, not an effect: the field is populated on first paint, so
  // it never flashes empty and never fights the browser's own autofill.
  const [email, setEmail] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(REMEMBERED_EMAIL) ?? '';
    } catch {
      // Safari in private mode throws on access rather than returning null.
      return '';
    }
  });
  const [password, setPasswordValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the failure is specifically "this account has no password yet",
      which needs a different action from "you typed it wrong". */
  const [needsSetup, setNeedsSetup] = useState(false);

  if (!authEnabled) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    setNeedsSetup(false);
    const res = await signInWithPassword(email, password);
    setBusy(false);
    if (res.ok) {
      try {
        window.localStorage.setItem(REMEMBERED_EMAIL, email.trim());
      } catch {
        // Not worth failing a successful sign-in over.
      }
      return; // The page's auth listener takes it from here.
    }
    // Supabase answers "Invalid login credentials" both for a wrong password
    // and for an account that has never had one — which is every account made
    // through Google or a magic link. Saying "wrong password" to someone whose
    // account has no password is how an afternoon disappears.
    if (/invalid login credentials/i.test(res.error ?? '')) {
      setNeedsSetup(true);
      setError(null);
    } else {
      setError(res.error ?? 'Sign-in failed.');
    }
  };

  return (
    <form onSubmit={submit} className="rounded-3xl bg-surface p-4">
      <div className="flex items-center gap-2 pb-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <LockIcon width={18} height={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">Sign in with a password</p>
          <p className="text-xs leading-relaxed text-muted">
            Stays on this origin, so it works where a redirect does not.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="username"
          className={FIELD}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPasswordValue(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className={FIELD}
        />
      </div>

      {error && (
        <p className="pt-3 text-xs leading-relaxed text-[#f87171]">{error}</p>
      )}

      {needsSetup && (
        <p className="pt-3 text-xs leading-relaxed text-muted">
          Supabase rejected that pair. It says the same thing for a wrong
          password and for an account that has never had one, so check the
          password first — and if this account was made with Google or a magic
          link, it has no password at all until something sets one. Either run{' '}
          <code className="text-[11px] text-text">
            node scripts/dashboard-account.mts --apply
          </code>{' '}
          to provision the dedicated dashboard account, or sign in below by
          Google/magic link and use “Set a password” at the bottom of the
          dashboard.
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !email.trim() || !password}
        className="mt-3 w-full rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition-transform active:scale-95 disabled:opacity-40"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

/**
 * Give the signed-in account a password, from inside the app.
 *
 * This is the other half of the form above, and the reason the pair is worth
 * having: an account created by Google or magic link has no password to sign
 * in with, and the two other ways to give it one are the Supabase dashboard
 * and the admin API — the latter needing SUPABASE_SERVICE_ROLE_KEY, which this
 * project deliberately does not carry. So it would otherwise be possible to
 * ship a password form that no account in the project can actually use.
 *
 * Collapsed by default and rendered only for admins: it is a one-time setup
 * step, not a dashboard control.
 */
export function SetAdminPassword() {
  const [open, setOpen] = useState(false);
  const [password, setPasswordValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authEnabled) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    const res = await setPassword(password);
    setBusy(false);
    if (res.ok) {
      setDone(true);
      setPasswordValue('');
    } else {
      setError(res.error ?? 'Could not set the password.');
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto mt-10 block text-xs font-medium text-muted transition-colors hover:text-text"
      >
        Set a password for this account
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-10 max-w-sm rounded-3xl bg-surface p-4">
      <p className="text-sm font-semibold text-text">Set a password</p>
      <p className="pb-3 text-xs leading-relaxed text-muted">
        For this account, on this Supabase project. It adds a second way in
        alongside Google and magic link — it does not replace either, and it
        does not grant admin: loro_admins still decides that.
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPasswordValue(e.target.value)}
        placeholder="New password"
        autoComplete="new-password"
        className={FIELD}
      />
      {error && (
        <p className="pt-3 text-xs leading-relaxed text-[#f87171]">{error}</p>
      )}
      {done && (
        <p className="pt-3 text-xs leading-relaxed text-accent">
          Set. You can now sign in with this email and password on any origin.
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !password}
        className="mt-3 w-full rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition-transform active:scale-95 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save password'}
      </button>
    </form>
  );
}
