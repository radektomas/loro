'use client';

import { useCallback, useEffect, useState } from 'react';
import { checkAdmin } from '@/lib/analytics';
import { loadCatalog, type CatalogLoad } from '@/lib/adminCatalog';
import { GateMessage, PageHeader, useSupabaseUser } from '@/components/creator/ugc';
import { SignInCard } from '@/components/SignInCard';
import {
  AdminPasswordSignIn,
  SetAdminPassword,
} from '@/components/admin/AdminPasswordSignIn';
import { CatalogBrowser } from '@/components/admin/CatalogBrowser';

/**
 * Every video the app serves, in one place, with the ability to take one out.
 *
 * WHY THIS EXISTS SEPARATELY FROM /admin/videos. That page is the UGC review
 * queue: loro_videos, one creator's upload, approve or reject. It has never
 * been able to see the 374 YouTube embeds and 8 seed clips that are the
 * actual feed, because those live in loro_catalog_videos and have no creator
 * and no review state. Two tables, two meanings, two screens.
 *
 * THE GATE IS UX, NOT SECURITY — same as /admin/analytics, and for the same
 * reason: auth.uid() comes from a session that lives in browser localStorage
 * and never reaches the server, so a server render would be permanently
 * un-admin. Unlike analytics, though, the rows here are genuinely public
 * (loro_catalog_videos is `for select using (true)` — it is the catalog every
 * device fetches with the anon key). Nothing is being hidden by this gate; it
 * is here so the management view has one door, and so the removal flow is not
 * offered to someone who cannot act on it.
 */
export default function AdminCatalogPage() {
  const { user, ready } = useSupabaseUser();
  const [admin, setAdmin] = useState(false);
  const [checked, setChecked] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const [load, setLoad] = useState<CatalogLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadCatalog();
    if (result.ok) {
      setLoad(result.data);
      setError(null);
    } else {
      setLoad(null);
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setAdmin(false);
      setChecked(true);
      return;
    }
    // Signing in mid-session re-runs this with `checked` already true, which
    // would flash "not an admin" during the RPC round trip. Same fix as
    // /admin/analytics.
    setChecked(false);
    void checkAdmin().then((result) => {
      if (result.ok) {
        setAdmin(result.data);
        setGateError(null);
      } else {
        setAdmin(false);
        setGateError(result.error);
      }
      setChecked(true);
    });
  }, [ready, user]);

  useEffect(() => {
    if (admin) void refresh();
  }, [admin, refresh]);

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <PageHeader title="Catalog" backHref="/admin/analytics" />

      <div className="mx-auto max-w-6xl">
        {ready && checked && !user && (
          <div className="pt-10">
            <GateMessage
              title="Sign in to view"
              body="Your session is per-origin, so signing in on the deployed site does not carry over to a local dev server. Sign in with the same account here."
            />
            <div className="mx-auto mt-8 max-w-sm space-y-3">
              <AdminPasswordSignIn />
              <SignInCard />
            </div>
          </div>
        )}

        {ready && checked && user && !admin && gateError && (
          <div className="px-4">
            <GateMessage
              title="Could not check permissions"
              body={`The admin check itself failed, so this is a deployment problem rather than a permissions one: ${gateError}`}
            />
          </div>
        )}

        {ready && checked && user && !admin && !gateError && (
          <div className="px-4">
            <GateMessage
              title="This account is not an admin"
              body={`Signed in as ${user.email ?? user.id}, which is not in loro_admins. If you have more than one Google/Apple account, you may be signed in as the other one — sign out and back in with the right one.`}
            />
            <div className="mx-auto mt-8 max-w-sm">
              <SignInCard />
            </div>
          </div>
        )}

        {ready && checked && admin && (
          <>
            <div className="flex items-center gap-2 px-4 pb-4">
              <p className="text-xs leading-relaxed text-muted">
                Everything the app serves. Removing happens in the repo — mark
                what you want gone and this hands you the command.
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="ml-auto shrink-0 rounded-2xl bg-surface px-3 py-2 text-xs font-semibold text-muted transition-colors hover:text-text disabled:opacity-40"
              >
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {error && (
              <div className="mx-4 mb-6 rounded-2xl bg-[#f87171]/10 px-4 py-3">
                <p className="text-sm font-semibold text-[#f87171]">
                  Could not load the catalog
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[#f87171]/80">
                  {error}
                </p>
              </div>
            )}

            {!load && !error && (
              <p className="px-4 py-16 text-center text-sm text-muted">Loading…</p>
            )}

            {/* The manifest is how this page knows which rows actually ship.
                Without it every row would be reported live, overstating the
                feed by however many removals the table still remembers — so
                say so rather than show a confident wrong number. */}
            {load && !load.liveKnown && (
              <div className="mx-4 mb-4 rounded-2xl bg-amber-400/10 px-4 py-3">
                <p className="text-xs leading-relaxed text-amber-300">
                  No <code className="font-mono">catalog/manifest.json</code> in the
                  bucket, so removed-but-remembered rows cannot be told apart from
                  live ones and everything below is counted as live. Run{' '}
                  <code className="font-mono">npm run publish-catalog</code> once to
                  write it.
                </p>
              </div>
            )}

            {load && <CatalogBrowser videos={load.videos} />}

            <div className="px-4 pt-10">
              <SetAdminPassword />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
