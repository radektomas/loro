'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  authEnabled,
  getSession,
  onAuthChange,
  signInWithGoogle,
  signInWithMagicLink,
  signOut,
} from '@/lib/auth';
import { CheckIcon, CloseIcon, GlobeIcon } from '@/components/icons/Icons';

function GoogleGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * The one place Loro invites sign-in. It is never a gate: anonymous users see a
 * soft "back up & sync" prompt, signed-in users see their sync status. Renders
 * nothing at all when Supabase isn't configured.
 */
export function SignInCard() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authEnabled) {
      setReady(true);
      return;
    }
    void getSession().then((s) => {
      setSession(s);
      setReady(true);
    });
    return onAuthChange((s) => setSession(s));
  }, []);

  if (!authEnabled || !ready) return null;

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    const res = await signInWithMagicLink(email);
    setSending(false);
    if (res.ok) setSent(true);
    else setError(res.error ?? 'Something went wrong.');
  };

  const handleGoogle = async () => {
    setError(null);
    const res = await signInWithGoogle();
    if (!res.ok) setError(res.error ?? 'Something went wrong.');
  };

  // --- Signed in: quiet status + sign out.
  if (session) {
    return (
      <div className="flex items-center gap-3 rounded-3xl bg-surface p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <CheckIcon width={18} height={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">Synced</p>
          <p className="truncate text-xs text-muted">
            {session.user.email ?? 'Backed up across your devices'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="shrink-0 text-xs font-medium text-muted transition-colors hover:text-text"
        >
          Sign out
        </button>
      </div>
    );
  }

  // --- Anonymous: soft invite, expands into a small sheet.
  return (
    <div className="rounded-3xl bg-surface p-4">
      {!open ? (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <GlobeIcon width={18} height={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text">
              Back up &amp; sync
            </p>
            <p className="text-xs leading-relaxed text-muted">
              Keep your words if you switch phones. Optional — everything works
              without it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-background transition-transform active:scale-95"
          >
            Sign in
          </button>
        </div>
      ) : sent ? (
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <CheckIcon width={18} height={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text">Check your email</p>
            <p className="text-xs leading-relaxed text-muted">
              We sent a sign-in link to {email}. Open it on this device.
            </p>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-text">
              Back up &amp; sync across devices
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-muted transition-colors hover:text-text"
            >
              <CloseIcon width={16} height={16} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleGoogle()}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-surface-raised py-2.5 text-sm font-semibold text-text transition-colors hover:bg-white/10"
          >
            <GoogleGlyph />
            Continue with Google
          </button>

          <div className="my-3 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[10px] uppercase tracking-widest text-muted/70">
              or
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={handleMagicLink} className="flex flex-col gap-2">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              aria-label="Email for magic link"
              className="w-full rounded-xl bg-surface-raised px-3.5 py-2.5 text-sm text-text outline-none placeholder:text-muted/60 focus:ring-1 focus:ring-accent/40"
            />
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="rounded-xl bg-accent py-2.5 text-sm font-semibold text-background transition-transform active:scale-95 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Email me a link'}
            </button>
          </form>

          {error && <p className="mt-2 text-xs text-[#f87171]">{error}</p>}
        </div>
      )}
    </div>
  );
}
