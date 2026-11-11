'use client';

import { useCallback, useEffect, useState } from 'react';
import { signInWithPassword, signOut } from '@loro/core/auth';
import { getSupabase } from '@loro/core/supabase';
import { checkAdmin } from '@/lib/analytics';
import { useSupabaseUser } from '@/components/creator/ugc';
import { DASH } from '@/components/admin/RadekDashboard';
import { CutStudio, type CutData } from '@/components/admin/CutStudio';

/**
 * CUT — getloro.app/cut. Radek reviews the reels Claude cut and leaves notes
 * pinned to exact seconds. Same front door as /marketing: one password for the
 * fixed admin account; the /api/cut routes check loro_is_admin() themselves.
 */
const ADMIN_EMAIL = 'analytics@getloro.app';

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const session = (await getSupabase()?.auth.getSession())?.data.session;
  if (!session) return { ok: false, error: 'Not signed in.' };
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
  return { ok: true, data: body as T };
}

export default function CutPage() {
  const { user, ready } = useSupabaseUser();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CutData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setAdmin(false);
      return;
    }
    void checkAdmin().then((r) => setAdmin(r.ok ? r.data : false));
  }, [ready, user]);

  const reload = useCallback(async () => {
    const r = await api<CutData>('/api/cut');
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else {
      setLoadError(r.error);
    }
  }, []);

  useEffect(() => {
    if (admin) void reload();
  }, [admin, reload]);

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
    <main className="min-h-[100dvh] px-4 pb-16 pt-6 sm:px-8" style={{ background: DASH.page, color: DASH.ink }}>
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black" style={{ background: DASH.green, color: DASH.page }}>
              ✂
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Cut</h1>
              <p className="text-sm" style={{ color: DASH.muted }}>Reels Claude cut · notes at the exact second</p>
            </div>
          </div>
          {signedInAsAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => void reload()}
                className="rounded-lg px-4 py-2 text-sm font-semibold"
                style={{ background: DASH.card, border: `1px solid ${DASH.line}`, color: DASH.ink }}
              >
                Refresh
              </button>
              <button onClick={() => void signOut()} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ color: DASH.muted }}>
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
            style={{ background: DASH.card, border: `1px solid ${DASH.line}`, boxShadow: `0 8px 24px ${DASH.shadow}` }}
          >
            <h2 className="text-lg font-bold">Loro cut</h2>
            <p className="mt-1 text-sm" style={{ color: DASH.muted }}>Same password as the dashboard.</p>
            <input
              type="password"
              aria-label="Password"
              placeholder="Password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-4 w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{ border: `1px solid ${DASH.line}`, color: DASH.ink, background: DASH.page }}
            />
            {error && <p className="mt-2 text-sm" style={{ color: DASH.red }}>{error}</p>}
            <button
              type="submit"
              disabled={busy || !password}
              className="mt-4 w-full rounded-lg py-2.5 text-sm font-bold disabled:opacity-50"
              style={{ background: DASH.green, color: DASH.page }}
            >
              {busy ? 'Opening…' : 'Open'}
            </button>
          </form>
        ) : loadError ? (
          <p className="rounded-xl p-4 text-sm" style={{ background: DASH.redSoft, color: DASH.red }}>{loadError}</p>
        ) : data ? (
          <CutStudio data={data} api={api} reload={reload} />
        ) : (
          <p className="text-sm" style={{ color: DASH.muted }}>Loading…</p>
        )}
      </div>
    </main>
  );
}
