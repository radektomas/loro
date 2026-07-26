'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { authEnabled, getSession, onAuthChange, signOut } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { UGC_TABLES } from '@/lib/creators';
import { Sheet } from '@/components/Sheet';

/**
 * The account's destructive zone — GDPR / App Store 5.1.1(v) deletion.
 * Renders only for a signed-in user, below SignInCard in the profile's
 * Account section, visually separated as a danger area.
 *
 * The confirmation sheet enumerates exactly what is deleted, requires the
 * user to type their account email, and states irreversibility. On success
 * it signs out, wipes every Loro browser key, and hard-redirects to /?deleted
 * — a full reload, so no in-memory cache survives the account.
 */

type Phase = 'idle' | 'confirming' | 'deleting' | 'kept';

/**
 * Remove everything Loro (and the Supabase session) from browser storage.
 * Swept by PREFIX rather than a hand-kept list: every Loro key starts with
 * 'loro.' or 'loro:' (lib/storage.ts KEYS, lib/follows.ts KEYS, the
 * 'loro.auth' Supabase storageKey) and Supabase's own fallbacks start with
 * 'sb-'. A future key added to KEYS is covered the day it ships; a list here
 * would go stale exactly like the one this comment replaces.
 */
function wipeLocalState(): void {
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i);
      if (key && (key.startsWith('loro.') || key.startsWith('loro:') || key.startsWith('sb-'))) {
        store.removeItem(key);
      }
    }
  }
}

export function DeleteAccountCard() {
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [typedEmail, setTypedEmail] = useState('');
  const [videoCount, setVideoCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Double-submit guard that survives re-renders without waiting on state.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!authEnabled) return;
    void getSession().then(setSession);
    return onAuthChange(setSession);
  }, []);

  // Published-video count for the enumeration — RLS scopes the read to the
  // user's own rows, so this is 0 for non-creators without a special case.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !session) return;
    let cancelled = false;
    void supabase
      .from(UGC_TABLES.videos)
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', session.user.id)
      .then(({ count }) => {
        if (!cancelled) setVideoCount(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!authEnabled || !session) return null;

  const email = session.user.email ?? '';
  const emailMatches =
    typedEmail.trim().toLowerCase() === email.trim().toLowerCase();

  const close = () => {
    if (phase === 'deleting') return; // no dismissing mid-flight
    setPhase('idle');
    setTypedEmail('');
    setError(null);
  };

  const handleDelete = async () => {
    if (!emailMatches || inFlight.current) return;
    inFlight.current = true;
    setPhase('deleting');
    setError(null);
    try {
      const supabase = getSupabase();
      const token = (await supabase?.auth.getSession())?.data.session
        ?.access_token;
      if (!token) throw new Error('no session');

      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as {
        authDeleted?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? 'Deletion failed.');
        setPhase('confirming');
        return;
      }

      // Loro data is gone either way. authDeleted: false = shared sign-in
      // kept (other products use it) — say so before leaving.
      if (body.authDeleted === false) {
        setPhase('kept');
        return;
      }
      await signOut();
      wipeLocalState();
      window.location.replace('/feed?deleted=1');
    } catch {
      setError('Deletion failed.');
      setPhase('confirming');
    } finally {
      inFlight.current = false;
    }
  };

  const finishKept = async () => {
    await signOut();
    wipeLocalState();
    window.location.replace('/feed?deleted=1');
  };

  return (
    <section className="mt-8">
      <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-4">
        <h2 className="text-sm font-semibold text-red-400">Danger zone</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Permanently delete your account and everything Loro stores about
          you. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => setPhase('confirming')}
          className="mt-3 rounded-full border border-red-500/40 px-4 py-2 text-xs font-semibold text-red-400 active:bg-red-500/10"
        >
          Delete account…
        </button>
      </div>

      {phase !== 'idle' && (
        /* Sheet positions with absolute inset-0 against the nearest
           positioned ancestor — in the feed that's the slide; here on a
           scrolling page it needs a fixed viewport anchor. */
        <div className="fixed inset-0 z-40">
          <Sheet onClose={close}>
          {phase === 'kept' ? (
            <div className="pb-4">
              <h3 className="text-base font-bold text-text">
                Your Loro data is deleted
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Your learning data, uploads and profile are gone. Your sign-in
                is shared with other services and will be removed separately —
                nothing about your Loro use remains attached to it.
              </p>
              <button
                type="button"
                onClick={finishKept}
                className="mt-4 w-full rounded-full bg-accent px-4 py-3 text-sm font-semibold text-background"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="pb-4">
              <h3 className="text-base font-bold text-text">Delete account?</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                This permanently deletes:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                <li>your learning progress and streaks</li>
                <li>your saved words and review history</li>
                {videoCount !== null && videoCount > 0 ? (
                  <li className="text-red-400">
                    your creator profile and{' '}
                    {videoCount === 1
                      ? '1 published video'
                      : `${videoCount} published videos`}{' '}
                    — they disappear from every learner&apos;s feed
                  </li>
                ) : (
                  <li>your profile and any uploads</li>
                )}
                <li>your follows and account details</li>
              </ul>
              <p className="mt-3 text-sm font-semibold text-red-400">
                This cannot be undone.
              </p>

              <label className="mt-4 block text-xs text-muted" htmlFor="delete-confirm-email">
                Type <span className="font-semibold text-text">{email}</span>{' '}
                to confirm
              </label>
              <input
                id="delete-confirm-email"
                type="email"
                autoComplete="off"
                value={typedEmail}
                onChange={(e) => setTypedEmail(e.target.value)}
                className="mt-2 w-full rounded-xl border border-text/15 bg-surface px-3 py-2.5 text-sm text-text outline-none focus:border-red-400/60"
                placeholder={email}
              />

              {error && (
                <p className="mt-2 text-xs text-red-400" role="alert">
                  {error}
                </p>
              )}

              <button
                type="button"
                disabled={!emailMatches || phase === 'deleting'}
                onClick={handleDelete}
                className="mt-4 w-full rounded-full bg-red-500 px-4 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              >
                {phase === 'deleting' ? 'Deleting…' : 'Delete my account'}
              </button>
              <button
                type="button"
                onClick={close}
                disabled={phase === 'deleting'}
                className="mt-2 w-full rounded-full px-4 py-3 text-sm font-semibold text-muted"
              >
                Cancel
              </button>
            </div>
          )}
          </Sheet>
        </div>
      )}
    </section>
  );
}
