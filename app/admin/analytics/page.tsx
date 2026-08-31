'use client';

import { useCallback, useEffect, useState } from 'react';
import { checkAdmin, loadDashboard, type Dashboard } from '@/lib/analytics';
import { GateMessage, PageHeader, useSupabaseUser } from '@/components/creator/ugc';
import { SignInCard } from '@/components/SignInCard';
import {
  AdminPasswordSignIn,
  SetAdminPassword,
} from '@/components/admin/AdminPasswordSignIn';
import {
  DauTile,
  Panel,
  StatTile,
  UsersTable,
} from '@/components/admin/AnalyticsCharts';

/**
 * The mobile product dashboard: who comes back, and how much they scroll.
 *
 * WHY THIS IS A CLIENT COMPONENT WITH NO SERVER FETCH. Every number comes from
 * a SECURITY DEFINER RPC that re-checks loro_is_admin() against auth.uid() —
 * and auth.uid() is derived from the caller's session, which on this app lives
 * in browser localStorage and never reaches the server (see
 * lib/supabaseServer.ts: "auth.uid() is null in every query made here"). A
 * server render would therefore be permanently un-admin and return nothing.
 * The gate is enforced in Postgres regardless of what this component believes,
 * so the client-side check below is UX, not security: it renders the right
 * message instead of an error.
 *
 * WHAT THIS DASHBOARD IS NOT. It is not RevenueCat and it is not App Store
 * Connect. The Sub column knows a purchase or restore EVENT happened on an
 * install; whether that trial converted, renewed, refunded or lapsed lives
 * with Apple and RevenueCat, which are the systems of record for money.
 *
 * WHEN THE CLOCK STARTED. Events exist from 26 Aug 2026, when the analytics
 * table shipped — installs older than that surface here with a first-seen of
 * their first event after updating, and their retention flags measure from
 * that day, not from their true install day. The numbers are only fully
 * accurate for installs born after the instrumentation.
 */

export default function AdminAnalyticsPage() {
  const { user, ready } = useSupabaseUser();
  const [admin, setAdmin] = useState(false);
  const [checked, setChecked] = useState(false);
  /** Non-null when the admin CHECK itself failed — a different problem from
      the check answering "no", and one the old gate could not express. */
  const [gateError, setGateError] = useState<string | null>(null);

  const [allBuilds, setAllBuilds] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadDashboard(allBuilds);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      // The old data is dropped along with the error. A dashboard that keeps
      // showing last-good numbers under an error banner is how people quote a
      // figure from a window they are no longer looking at.
      setData(null);
      setError(result.error);
    }
    setLoading(false);
  }, [allBuilds]);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      // Signing OUT must close the dashboard, not leave the last admin's
      // numbers on screen for whoever signs in next.
      setAdmin(false);
      setChecked(true);
      return;
    }
    // Signing IN mid-session re-runs this with `checked` already true from the
    // signed-out pass. Without this reset, the RPC round trip renders as "This
    // account is not an admin" — every single time you sign in from the gate
    // below, on the one screen where that message is most alarming.
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

  const r = data?.retention;
  const rate = (returned: number, cohort: number): string =>
    cohort > 0 ? `${Math.round((returned / cohort) * 100)}%` : '—';

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <PageHeader title="Product analytics" backHref="/admin/creators" />

      <div className="mx-auto max-w-5xl px-4 pb-16">
        {/*
          THREE GATE STATES, NOT ONE.
          The first version of this screen showed "Admins only" for all of
          them, which is the least useful thing it could have said: the
          overwhelmingly common cause is simply having no session on THIS
          origin — sessions live in browser localStorage, so being signed in
          on the deployed site grants nothing on localhost — and that reads as
          a permissions problem you cannot fix.
        */}
        {ready && checked && !user && (
          <div className="pt-10">
            <GateMessage
              title="Sign in to view"
              body="Your session is per-origin, so signing in on the deployed site does not carry over to a local dev server. Sign in with the same account here."
            />
            <div className="mx-auto mt-8 max-w-sm space-y-3">
              {/* Password first, deliberately. The two below hand the session
                  to whichever origin Supabase redirects to, and when that is
                  not this one you land back here still signed out — the exact
                  failure this screen keeps hitting. This one cannot miss. */}
              <AdminPasswordSignIn />
              <SignInCard />
            </div>
          </div>
        )}

        {ready && checked && user && !admin && gateError && (
          <GateMessage
            title="Could not check permissions"
            body={`The admin check itself failed, so this is a deployment problem rather than a permissions one: ${gateError}`}
          />
        )}

        {ready && checked && user && !admin && !gateError && (
          <>
            <GateMessage
              title="This account is not an admin"
              body={`Signed in as ${user.email ?? user.id}, which is not in loro_admins. If you have more than one Google/Apple account, you may be signed in as the other one — sign out and back in with the right one.`}
            />
            {/* The advice above used to have nowhere to act on it: this branch
                was a message and nothing else, so "sign out and back in"
                meant finding a sign-out button on another screen. */}
            <div className="mx-auto mt-8 max-w-sm">
              <SignInCard />
            </div>
          </>
        )}

        {ready && checked && admin && (
          <>
            <div className="flex flex-wrap items-center gap-2 pb-6">
              <button
                type="button"
                onClick={() => setAllBuilds((on) => !on)}
                aria-pressed={allBuilds}
                className={`rounded-2xl px-3 py-2 text-xs font-semibold transition-colors ${
                  allBuilds
                    ? 'bg-level-soft text-level'
                    : 'bg-surface text-muted hover:text-text'
                }`}
                // The default EXCLUDES the profiles known to be dev/preview
                // and keeps null — the shipped App Store binary was not built
                // on an EAS worker, so it stamps no profile at all. Filtering
                // to build_profile = 'production' would show zeros forever;
                // see migration 20260830000000.
                title="Include development and preview builds, not just the App Store binary"
              >
                {allBuilds ? 'All builds' : 'App Store only'}
              </button>

              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="ml-auto rounded-2xl bg-surface px-3 py-2 text-xs font-semibold text-muted transition-colors hover:text-text disabled:opacity-40"
              >
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {error && (
              <div className="mb-6 rounded-2xl bg-[#f87171]/10 px-4 py-3">
                <p className="text-sm font-semibold text-[#f87171]">
                  Could not load the dashboard
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[#f87171]/80">
                  {error}
                </p>
              </div>
            )}

            {data && r && (
              <div className="space-y-6">
                {/* Headline row. Retention rates carry their cohort size in
                    the sub-line because a percentage over four people is a
                    coin flip wearing a suit — the n is the honest half of the
                    number. */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <StatTile
                    label="D1 retention"
                    value={rate(r.d1Returned, r.d1Cohort)}
                    sub={`${r.d1Returned} of ${r.d1Cohort} returned`}
                  />
                  <StatTile
                    label="D3 retention"
                    value={rate(r.d3Returned, r.d3Cohort)}
                    sub={`${r.d3Returned} of ${r.d3Cohort} returned`}
                  />
                  <StatTile
                    label="D7 retention"
                    value={rate(r.d7Returned, r.d7Cohort)}
                    sub={`${r.d7Returned} of ${r.d7Cohort} returned`}
                  />
                  <StatTile
                    label="Median videos"
                    // null, not 0: nobody was active this week, which is a
                    // different fact from actives who scrolled nothing.
                    value={
                      r.medianVideos7d == null
                        ? '—'
                        : String(Math.round(r.medianVideos7d * 10) / 10)
                    }
                    sub="per active user, 7 days"
                  />
                  <DauTile points={data.dau} today={r.dauToday} />
                </div>

                <Panel
                  title="Users"
                  hint="One row per install — the app's only identity for the anonymous majority, so retention counts from the first thing they ever did, signed in or not. D1/D3/D7 mean activity on exactly that day after first open: ✓ returned, ✗ did not, — the day is not over yet. Sub is what the event log knows (a purchase or restore happened); trial-versus-paid lives in RevenueCat. Events exist from 26 Aug 2026, so older installs count from their first event after updating."
                >
                  <UsersTable users={data.users} />
                </Panel>
              </div>
            )}

            {/* Setup, not a control — collapsed to a single line, and the only
                place in the app that can give a Google/magic-link account a
                password (the admin API route needs a service role key this
                project does not carry). */}
            <SetAdminPassword />
          </>
        )}
      </div>
    </main>
  );
}
