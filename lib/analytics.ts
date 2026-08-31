import { getSupabase } from '@loro/core/supabase';

/**
 * Read side of the mobile product-funnel log.
 *
 * EVERY READ IS AN RPC, AND THAT IS THE SECURITY MODEL, not a style choice.
 * loro_analytics_events has an INSERT policy and no SELECT policy at all, so
 * a `.from('loro_analytics_events').select()` here would return an empty array
 * — not an error — for admin and stranger alike. The aggregates come from the
 * SECURITY DEFINER functions in migrations 20260826000000 and 20260830000000,
 * each of which re-checks loro_is_admin() server-side. So the browser bundle
 * can hold every one of these calls safely: the anon key grants nothing
 * without a signed-in admin session behind it, and the raw event log is never
 * exposed to the client in any case.
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

/**
 * One row of the roster. "User" on screen, install underneath: the paywall is
 * bought through anonymously and sign-in is optional forever, so the install
 * pseudonym is the only identity most of the population has. firstSeen is the
 * install's first event ever — for anonymous-first users that predates any
 * sign-up, which is what retention must be measured from.
 */
export type UserRow = {
  installId: string;
  signedIn: boolean;
  firstSeen: string;
  lastActive: string;
  videosTotal: number;
  videos7d: number;
  /** null while the verdict is still open — the day-N calendar day has not
      fully elapsed yet. Distinct from false, which is a measured churn. */
  d1: boolean | null;
  d3: boolean | null;
  d7: boolean | null;
  subStatus: 'subscribed' | 'restored' | 'none';
};

export type Retention = {
  d1Returned: number;
  d1Cohort: number;
  d3Returned: number;
  d3Cohort: number;
  d7Returned: number;
  d7Cohort: number;
  /** Median video_watched over installs active in the last 7 days, zeros
      included; null when nobody was active at all. */
  medianVideos7d: number | null;
  dauToday: number;
};

export type DauPoint = { day: string; dau: number };

export type Dashboard = {
  retention: Retention;
  dau: DauPoint[];
  users: UserRow[];
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
/** Postgres boolean-or-null survives the trip as-is; anything else is null. */
const triState = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

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
        `${fn} is missing — apply supabase/migrations/20260830000000_analytics_retention.sql.`
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
 * RPCs. One failure fails the whole load ON PURPOSE — a half-populated
 * dashboard where the roster loaded and the retention cards silently didn't
 * is worse than an error, because every number on it still looks
 * authoritative.
 */
export async function loadDashboard(
  allBuilds: boolean
): Promise<Loaded<Dashboard>> {
  const args = { p_all_builds: allBuilds };
  try {
    const [retention, dau, users] = await Promise.all([
      call('loro_analytics_retention', args),
      call('loro_analytics_dau', { p_days: 7, ...args }),
      call('loro_analytics_users', { p_limit: 500, ...args }),
    ]);

    const r = retention[0] ?? {};
    return {
      ok: true,
      data: {
        retention: {
          d1Returned: num(r.d1_returned),
          d1Cohort: num(r.d1_cohort),
          d3Returned: num(r.d3_returned),
          d3Cohort: num(r.d3_cohort),
          d7Returned: num(r.d7_returned),
          d7Cohort: num(r.d7_cohort),
          // Genuinely null when nobody was active — distinct from a measured
          // median of zero videos.
          medianVideos7d:
            r.median_videos_7d == null ? null : num(r.median_videos_7d),
          dauToday: num(r.dau_today),
        },
        dau: dau.map((row) => ({ day: str(row.day), dau: num(row.dau) })),
        users: users.map((row) => ({
          installId: str(row.install_id),
          signedIn: row.signed_in === true,
          firstSeen: str(row.first_seen),
          lastActive: str(row.last_active),
          videosTotal: num(row.videos_total),
          videos7d: num(row.videos_7d),
          d1: triState(row.d1),
          d3: triState(row.d3),
          d7: triState(row.d7),
          subStatus:
            row.sub_status === 'subscribed' || row.sub_status === 'restored'
              ? row.sub_status
              : 'none',
        })),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
