import { getSupabase } from '@loro/core/supabase';

/**
 * Read side of the mobile product-funnel log.
 *
 * EVERY READ IS AN RPC, AND THAT IS THE SECURITY MODEL, not a style choice.
 * loro_analytics_events has an INSERT policy and no SELECT policy at all, so
 * a `.from('loro_analytics_events').select()` here would return an empty array
 * — not an error — for admin and stranger alike. The aggregates come from the
 * SECURITY DEFINER functions in migration 20260826000000, each of which
 * re-checks loro_is_admin() server-side. So the browser bundle can hold every
 * one of these calls safely: the anon key grants nothing without a signed-in
 * admin session behind it, and the raw event log is never exposed to the
 * client in any case.
 *
 * That is also why this dashboard does NOT need SUPABASE_SERVICE_ROLE_KEY,
 * which is deliberately absent from Vercel and already blocks account deletion
 * and grandfathering. Nothing here would work any better if it were present.
 *
 * Rows arrive snake_case and are mapped to camelCase at this boundary, per
 * lib/creators.ts.
 */

/** Discriminated so the page can tell "no users yet" from "the migration has
    not been applied" — the two look identical if errors are swallowed into
    empty arrays, and confusing them wastes a day. */
export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

export type FunnelStage = { stage: string; order: number; installs: number };
export type OnboardingStep = {
  step: string;
  order: number;
  reached: number;
  stoppedHere: number;
};
export type PaywallOutcome = { outcome: string; order: number; installs: number };
export type WatchBucket = { bucket: string; order: number; installs: number };
export type DailyPoint = {
  day: string;
  newInstalls: number;
  paywallViews: number;
  purchases: number;
  videosWatched: number;
};
export type Overview = {
  installs: number;
  activeInstalls: number;
  paywallViews: number;
  purchases: number;
  subscribers: number;
  videosWatched: number;
  medianVideos: number | null;
};
export type RecentEvent = {
  receivedAt: string;
  name: string;
  props: Record<string, unknown>;
  installId: string;
  sessionId: string;
  signedIn: boolean;
  platform: string;
  appVersion: string | null;
  buildProfile: string | null;
};

export type Dashboard = {
  overview: Overview;
  funnel: FunnelStage[];
  onboarding: OnboardingStep[];
  paywall: PaywallOutcome[];
  watch: WatchBucket[];
  daily: DailyPoint[];
  recent: RecentEvent[];
};

type Row = Record<string, unknown>;

const num = (value: unknown): number => {
  // Postgres bigint arrives as a string through PostgREST when it exceeds
  // JS's safe range, and as a number otherwise. Normalising here keeps every
  // chart's arithmetic honest instead of silently concatenating strings.
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
};
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

async function call(fn: string, args: Record<string, unknown>): Promise<Row[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured in this browser.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // The two failures worth naming, because they are the two that happen and
    // they have completely different fixes.
    if (error.message.includes('admin only')) {
      throw new Error('This Supabase account is not in loro_admins.');
    }
    if (/could not find the function|does not exist/i.test(error.message)) {
      throw new Error(
        `${fn} is missing — apply supabase/migrations/20260826000000_analytics_events.sql.`
      );
    }
    throw new Error(`${fn}: ${error.message}`);
  }
  return Array.isArray(data) ? (data as Row[]) : data ? [data as Row] : [];
}

/**
 * Is the caller an admin — and if we cannot tell, WHY NOT.
 *
 * lib/creators.ts's isAdmin() collapses every failure into `false`, which is
 * right for the screens it was written for (a non-admin and a network blip
 * both mean "do not show the review UI"). It is wrong here, because it makes
 * three very different situations render the same dead end: not signed in,
 * signed in as the wrong account, and the RPC itself failing. The first costs
 * a sign-in, the second costs a row in loro_admins, and the third is a broken
 * deployment — telling them apart is the difference between a five-second fix
 * and an afternoon.
 */
export async function checkAdmin(): Promise<Loaded<boolean>> {
  const supabase = getSupabase();
  if (!supabase) {
    return {
      ok: false,
      error:
        'Supabase is not configured in this browser — NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are missing from this environment.',
    };
  }
  const { data, error } = await supabase.rpc('loro_is_admin');
  if (error) return { ok: false, error: `loro_is_admin: ${error.message}` };
  return { ok: true, data: data === true };
}

/**
 * Everything the dashboard renders, in one round trip's worth of parallel
 * RPCs.
 *
 * Promise.all rather than sequential awaits: seven independent aggregates over
 * the same small table, and a dashboard that paints in one go is the
 * difference between a tool you check and one you avoid. One failure fails the
 * whole load ON PURPOSE — a half-populated dashboard where the funnel loaded
 * and the paywall panel silently didn't is worse than an error, because every
 * number on it still looks authoritative.
 */
export async function loadDashboard(
  days: number,
  allBuilds: boolean
): Promise<Loaded<Dashboard>> {
  const args = { p_days: days, p_all_builds: allBuilds };
  try {
    const [overview, funnel, onboarding, paywall, watch, daily, recent] =
      await Promise.all([
        call('loro_analytics_overview', args),
        call('loro_analytics_funnel', args),
        call('loro_analytics_onboarding', args),
        call('loro_analytics_paywall', args),
        call('loro_analytics_watch', args),
        call('loro_analytics_daily', args),
        call('loro_analytics_recent', { p_limit: 60 }),
      ]);

    const o = overview[0] ?? {};
    return {
      ok: true,
      data: {
        overview: {
          installs: num(o.installs),
          activeInstalls: num(o.active_installs),
          paywallViews: num(o.paywall_views),
          purchases: num(o.purchases),
          subscribers: num(o.subscribers),
          videosWatched: num(o.videos_watched),
          // Genuinely null when nobody has watched anything — distinct from
          // zero, which would claim a measured median of no videos.
          medianVideos: o.median_videos == null ? null : num(o.median_videos),
        },
        funnel: funnel.map((r) => ({
          stage: str(r.stage),
          order: num(r.stage_order),
          installs: num(r.installs),
        })),
        onboarding: onboarding.map((r) => ({
          step: str(r.step),
          order: num(r.step_order),
          reached: num(r.reached),
          stoppedHere: num(r.stopped_here),
        })),
        paywall: paywall.map((r) => ({
          outcome: str(r.outcome),
          order: num(r.outcome_order),
          installs: num(r.installs),
        })),
        watch: watch.map((r) => ({
          bucket: str(r.bucket),
          order: num(r.bucket_order),
          installs: num(r.installs),
        })),
        daily: daily.map((r) => ({
          day: str(r.day),
          newInstalls: num(r.new_installs),
          paywallViews: num(r.paywall_views),
          purchases: num(r.purchases),
          videosWatched: num(r.videos_watched),
        })),
        recent: recent.map((r) => ({
          receivedAt: str(r.received_at),
          name: str(r.name),
          props:
            r.props && typeof r.props === 'object'
              ? (r.props as Record<string, unknown>)
              : {},
          installId: str(r.install_id),
          sessionId: str(r.session_id),
          signedIn: r.signed_in === true,
          platform: str(r.platform),
          appVersion: r.app_version == null ? null : str(r.app_version),
          buildProfile: r.build_profile == null ? null : str(r.build_profile),
        })),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
