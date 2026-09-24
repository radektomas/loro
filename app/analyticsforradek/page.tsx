'use client';

import { useCallback, useEffect, useState } from 'react';
import { signInWithPassword, signOut } from '@loro/core/auth';
import { checkAdmin, loadRadekDashboard, type RadekDashboard } from '@/lib/analytics';
import { useSupabaseUser } from '@/components/creator/ugc';
import { DASH, RadekDashboardView } from '@/components/admin/RadekDashboard';

/**
 * RADEK'S NUMBERS — getloro.app/analyticsforradek (2026-09-24).
 *
 * ONE PASSWORD, NO EMAIL (Radek: "no email needed, just the password").
 * The box signs in to the existing admin account, whose address is fixed
 * below; the password is that account's Supabase password and is never in
 * this file. The data itself is still guarded where it always was: every
 * analytics function checks loro_is_admin() in the database, so this page
 * is a front door, not the lock.
 */
const ADMIN_EMAIL = 'analytics@getloro.app';

export default function AnalyticsForRadek() {
  const { user, ready } = useSupabaseUser();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RadekDashboard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setAdmin(false);
      return;
    }
    void checkAdmin().then((r) => setAdmin(r.ok ? r.data : false));
  }, [ready, user]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await loadRadekDashboard(false);
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else {
      setLoadError(r.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (admin) void refresh();
  }, [admin, refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    const r = await signInWithPassword(ADMIN_EMAIL, password);
    setBusy(false);
    setPassword('');
    if (!r.ok) setError(/invalid login credentials/i.test(r.error ?? '') ? 'Wrong password.' : r.error ?? 'Sign-in failed.');
  };

  const signedInAsAdmin = Boolean(user) && admin === true;

  return (
    <main className="min-h-[100dvh] px-4 pb-16 pt-8 sm:px-8" style={{ background: DASH.page, color: DASH.ink }}>
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black text-white"
              style={{ background: DASH.green }}
            >
              L
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Loro</h1>
              <p className="text-sm" style={{ color: DASH.muted }}>Overview · App Store</p>
            </div>
          </div>
          {signedInAsAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => void refresh()}
                disabled={loading}
                className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: DASH.card, border: `1px solid ${DASH.line}`, color: DASH.ink }}
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                onClick={() => void signOut()}
                className="rounded-lg px-4 py-2 text-sm font-semibold"
                style={{ color: DASH.muted }}
              >
                Lock
              </button>
            </div>
          )}
        </header>

        {!ready || (user && admin === null) ? (
          <p className="text-sm" style={{ color: DASH.muted }}>Checking…</p>
        ) : !signedInAsAdmin ? (
          <form
            onSubmit={submit}
            className="mx-auto mt-20 max-w-sm rounded-2xl p-6"
            style={{ background: DASH.card, border: `1px solid ${DASH.line}`, boxShadow: '0 8px 24px rgba(16,24,40,0.08)' }}
          >
            <h2 className="text-lg font-bold">Loro numbers</h2>
            <p className="mt-1 text-sm" style={{ color: DASH.muted }}>Enter the password to open the dashboard.</p>
            <input
              id="pw"
              type="password"
              aria-label="Password"
              placeholder="Password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-4 w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{ border: `1px solid ${DASH.line}`, color: DASH.ink, background: '#fff' }}
            />
            {error && <p className="mt-2 text-sm" style={{ color: DASH.red }}>{error}</p>}
            {user && admin === false && (
              <p className="mt-2 text-sm" style={{ color: DASH.muted }}>Signed in with another account. Enter the password to switch.</p>
            )}
            <button
              type="submit"
              disabled={busy || !password}
              className="mt-4 w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: DASH.green }}
            >
              {busy ? 'Opening…' : 'Open'}
            </button>
          </form>
        ) : loadError ? (
          <p className="rounded-xl p-4 text-sm" style={{ background: DASH.redSoft, color: DASH.red }}>{loadError}</p>
        ) : data ? (
          <RadekDashboardView data={data} />
        ) : (
          <p className="text-sm" style={{ color: DASH.muted }}>Loading…</p>
        )}
      </div>
    </main>
  );
}
