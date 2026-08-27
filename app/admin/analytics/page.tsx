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
  DailyChart,
  DropOffChart,
  Empty,
  FunnelChart,
  Panel,
  PaywallChart,
  StatTile,
  WatchChart,
} from '@/components/admin/AnalyticsCharts';

/**
 * The mobile product dashboard: how far people get, and what the paywall does
 * to them.
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
 * Connect. It does not know revenue, refunds, renewals or churn — those live
 * with Apple and RevenueCat, which are the systems of record for money. What
 * it knows is the half neither of them can see: what happened INSIDE the app
 * before and after the transaction, joined to the same install.
 */

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

export default function AdminAnalyticsPage() {
  const { user, ready } = useSupabaseUser();
  const [admin, setAdmin] = useState(false);
  const [checked, setChecked] = useState(false);
  /** Non-null when the admin CHECK itself failed — a different problem from
      the check answering "no", and one the old gate could not express. */
  const [gateError, setGateError] = useState<string | null>(null);

  const [days, setDays] = useState<number>(30);
  const [allBuilds, setAllBuilds] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadDashboard(days, allBuilds);
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
  }, [days, allBuilds]);

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
            {/* Filters in one row above the charts, and they apply to every
                panel at once — a per-panel range control invites comparing two
                different windows without noticing. */}
            <div className="flex flex-wrap items-center gap-2 pb-6">
              <div className="flex gap-1 rounded-2xl bg-surface p-1">
                {RANGES.map((range) => (
                  <button
                    key={range.days}
                    type="button"
                    onClick={() => setDays(range.days)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                      days === range.days
                        ? 'bg-accent text-background'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setAllBuilds((on) => !on)}
                aria-pressed={allBuilds}
                className={`rounded-2xl px-3 py-2 text-xs font-semibold transition-colors ${
                  allBuilds
                    ? 'bg-level-soft text-level'
                    : 'bg-surface text-muted hover:text-text'
                }`}
                // The switch you need on day one and never again: production
                // binaries only, unless you are checking your own simulator.
                title="Include development and preview builds, not just the App Store binary"
              >
                {allBuilds ? 'All builds' : 'Production only'}
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

            {data && (
              <div className="space-y-6">
                {/* KPI row. Headline numbers as stat tiles, not a grouped bar
                    chart — five unrelated measures have nothing to compare. */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <StatTile
                    label="New installs"
                    value={data.overview.installs.toLocaleString('en-GB')}
                    sub={`${data.overview.activeInstalls.toLocaleString('en-GB')} active`}
                  />
                  <StatTile
                    label="Paywall views"
                    value={data.overview.paywallViews.toLocaleString('en-GB')}
                  />
                  <StatTile
                    label="Subscribers"
                    value={data.overview.subscribers.toLocaleString('en-GB')}
                    sub={`${data.overview.purchases.toLocaleString('en-GB')} purchase events`}
                  />
                  <StatTile
                    label="Videos watched"
                    value={data.overview.videosWatched.toLocaleString('en-GB')}
                  />
                  <StatTile
                    label="Median per watcher"
                    // null, not 0: nobody has watched anything yet, which is
                    // a different fact from a measured median of zero.
                    value={
                      data.overview.medianVideos == null
                        ? '—'
                        : String(Math.round(data.overview.medianVideos))
                    }
                    sub="videos"
                  />
                </div>

                <Panel
                  title="The funnel"
                  hint="Installs whose FIRST event falls in this window, followed all the way through however long they took. The last few days are still filling in — someone who installed yesterday can still subscribe tomorrow."
                >
                  {data.funnel.length > 0 ? (
                    <FunnelChart stages={data.funnel} />
                  ) : (
                    <Empty>No installs in this window.</Empty>
                  )}
                </Panel>

                <Panel
                  title="At the paywall"
                  hint="What happened to everyone who reached the wall. The four outcomes are mutually exclusive and sum to the “Saw the paywall” row above."
                >
                  <PaywallChart outcomes={data.paywall} />
                </Panel>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Panel
                    title="Where onboarding loses people"
                    hint="Bars are how many installs reached each screen; −n is how many got no further. A first launch abandoned an hour ago looks the same as one abandoned for good, so read the newest day gently."
                  >
                    <DropOffChart steps={data.onboarding} />
                  </Panel>

                  <Panel
                    title="Videos watched, per subscriber"
                    hint="Counted only for installs that got past the wall. “Watched” means the video took the screen — the same rule the app uses on Progress, not a playback-completion measure."
                  >
                    <WatchChart buckets={data.watch} />
                  </Panel>
                </div>

                <Panel
                  title="Day by day"
                  hint="Counted where the events landed, not by install cohort — so a purchase appears on the day it happened even if that install arrived weeks ago."
                >
                  <DailyChart points={data.daily} />
                </Panel>

                <Panel
                  title="Latest events"
                  hint="The raw tail, unfiltered by build profile — this is where you confirm a new build's events are actually arriving. Install ids are truncated; they are client-minted pseudonyms, not device identifiers."
                >
                  {data.recent.length === 0 ? (
                    <Empty>
                      No events at all yet. If the app has been used since this
                      shipped, check that the migration is applied and that the
                      binary carries EXPO_PUBLIC_SUPABASE_* credentials.
                    </Empty>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-left text-xs">
                        <thead>
                          <tr className="text-muted">
                            <th className="pb-2 font-medium">When</th>
                            <th className="pb-2 font-medium">Event</th>
                            <th className="pb-2 font-medium">Detail</th>
                            <th className="pb-2 font-medium">Install</th>
                            <th className="pb-2 font-medium">Build</th>
                          </tr>
                        </thead>
                        <tbody className="align-top">
                          {data.recent.map((event, i) => (
                            <tr
                              key={`${event.receivedAt}-${i}`}
                              className="border-t border-white/5"
                            >
                              <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">
                                {new Date(event.receivedAt).toLocaleString('en-GB')}
                              </td>
                              <td className="py-2 pr-3 whitespace-nowrap font-medium text-text">
                                {event.name}
                              </td>
                              <td className="max-w-xs truncate py-2 pr-3 text-muted">
                                {Object.entries(event.props)
                                  .map(([key, value]) => `${key}=${String(value)}`)
                                  .join(' ') || '—'}
                              </td>
                              <td className="py-2 pr-3 whitespace-nowrap text-muted">
                                {event.installId.slice(0, 8)}
                                {event.signedIn && (
                                  <span className="ml-1.5 text-accent">·  signed in</span>
                                )}
                              </td>
                              <td className="py-2 whitespace-nowrap text-muted">
                                {event.appVersion ?? '—'}
                                {event.buildProfile &&
                                  event.buildProfile !== 'production' && (
                                    <span className="ml-1.5 text-level">
                                      {event.buildProfile}
                                    </span>
                                  )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
