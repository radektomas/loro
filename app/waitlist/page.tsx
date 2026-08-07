import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  getServiceRole,
  ServiceRoleNotConfiguredError,
} from '@/app/api/_lib/serviceRole';
import { CumulativeChart, type Day } from './CumulativeChart';

/**
 * /waitlist?key=... — the private signup dashboard. COUNTS ONLY.
 *
 * THE GATE. WAITLIST_DASHBOARD_KEY is server-only (never NEXT_PUBLIC_), the
 * comparison happens here in a server component, and the secret never enters a
 * prop, a flight payload or the bundle. A wrong or missing key is notFound() —
 * the same 404 an unrouted path gets — so the URL never admits the page exists.
 * generateMetadata returns {} in that case for the same reason, mirroring
 * /dev/paywall: a title in the 404's payload would be the leak the 404 prevents.
 * An UNSET env var also 404s. Failing closed matters more than being reachable:
 * the opposite default would publish this dashboard the moment the var went
 * missing from a deploy.
 *
 * NO PERSONAL DATA. The query selects created_at and source. It never selects
 * email, so no address can reach the browser even through a React error
 * overlay or a serialised prop.
 *
 * WHY THE SERVICE ROLE. loro_waitlist grants anon INSERT and nothing else (see
 * 20260727000000_waitlist.sql) — there is no select policy for anon or
 * authenticated, so RLS makes counting impossible with any client-side key.
 * Reading it is only possible with the service role, which is why this is a
 * server component and not a fetch from the client.
 */

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Constant-time compare over digests, so length never leaks either. */
function keyMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function isAuthorized(raw: string | string[] | undefined): boolean {
  const expected = process.env.WAITLIST_DASHBOARD_KEY;
  if (!expected) return false;
  const provided = Array.isArray(raw) ? raw[0] : raw;
  if (!provided) return false;
  return keyMatches(provided, expected);
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  if (!isAuthorized((await searchParams).key)) return {};
  return {
    title: 'Waitlist — Loro',
    robots: { index: false, follow: false },
  };
}

const SOURCE_LABELS: Record<string, string> = {
  'landing-hero': 'Hero form',
  'landing-final': 'Final CTA',
  landing: 'Direct / API',
};

/** UTC day key. created_at is timestamptz; the ISO string's date half is UTC. */
const dayOf = (iso: string) => iso.slice(0, 10);

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Every day from the first signup to today, gaps filled with zero. Without the
 * fill a quiet week would be drawn as a straight climb between two busy days —
 * the chart would flatter the numbers, which is the one thing it must not do.
 */
function buildDays(dates: string[], today: string): Day[] {
  if (dates.length === 0) return [];
  const perDay = new Map<string, number>();
  for (const iso of dates) {
    const key = dayOf(iso);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const first = dates.reduce((min, d) => (d < min ? d : min), dates[0]);
  const days: Day[] = [];
  let running = 0;
  for (let cursor = dayOf(first); cursor <= today; cursor = addDays(cursor, 1)) {
    const added = perDay.get(cursor) ?? 0;
    running += added;
    days.push({ date: cursor, added, total: running });
  }
  return days;
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">
        {label}
      </p>
      <p className="mt-2 text-4xl font-bold tracking-[-0.02em] text-text tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default async function WaitlistDashboard({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (!isAuthorized((await searchParams).key)) notFound();

  let rows: { created_at: string; source: string | null }[];
  try {
    const admin = getServiceRole();
    // created_at and source ONLY. Never email.
    const { data, error } = await admin
      .from('loro_waitlist')
      .select('created_at, source')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`${error.code ?? 'unknown'}: ${error.message}`);
    rows = data ?? [];
  } catch (err) {
    const missingKey = err instanceof ServiceRoleNotConfiguredError;
    return (
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-text">
          Can’t read the waitlist
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {missingKey
            ? 'This deployment has no SUPABASE_SERVICE_ROLE_KEY. The table has RLS with no select policy, so counting rows is impossible without it — add it under Project Settings → Environment Variables and redeploy.'
            : 'The query failed. The exact error is in the server logs.'}
        </p>
        <p className="mt-4 rounded-2xl bg-surface p-4 font-mono text-xs text-muted">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const days = buildDays(
    rows.map((r) => r.created_at),
    today
  );
  const total = rows.length;
  const todayCount = days.length > 0 ? days[days.length - 1].added : 0;
  const last7 = days.slice(-7).reduce((sum, d) => sum + d.added, 0);

  const bySource = [...rows.reduce((map, r) => {
    const key = r.source ?? 'landing';
    return map.set(key, (map.get(key) ?? 0) + 1);
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-14">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          Private dashboard
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-text">
          Waitlist
        </h1>
      </header>

      {total === 0 ? (
        <p className="mt-10 rounded-3xl bg-surface p-6 text-sm text-muted">
          No signups yet. The table is readable — it is simply empty.
        </p>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <StatTile
              label="Total"
              value={String(total)}
              hint={`since ${days[0].date}`}
            />
            <StatTile label="Today" value={`+${todayCount}`} hint={today} />
            <StatTile label="Last 7 days" value={`+${last7}`} />
          </div>

          <section className="mt-4 rounded-3xl bg-surface p-6">
            <h2 className="text-sm font-semibold text-text">
              Cumulative signups
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Every day since the first signup. Hover a point for that day.
            </p>
            <div className="mt-5">
              <CumulativeChart days={days} />
            </div>
          </section>

          {bySource.length > 0 && (
            <section className="mt-4 rounded-3xl bg-surface p-6">
              <h2 className="text-sm font-semibold text-text">By source</h2>
              <ul className="mt-4 space-y-3">
                {bySource.map(([source, count]) => (
                  <li key={source}>
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="text-text">
                        {SOURCE_LABELS[source] ?? source}
                      </span>
                      <span className="tabular-nums text-muted">
                        {count} · {Math.round((count / total) * 100)}%
                      </span>
                    </div>
                    {/* Magnitude, one hue — the label carries identity. */}
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-raised">
                      <div
                        className="h-full rounded-full bg-[var(--accent-deep)]"
                        style={{ width: `${(count / total) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The table view the chart owes: same numbers, no colour needed. */}
          <details className="mt-4 rounded-3xl bg-surface p-6">
            <summary className="cursor-pointer text-sm font-semibold text-text">
              Table view
            </summary>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-muted">
                  <th className="pb-2 font-semibold">Day</th>
                  <th className="pb-2 text-right font-semibold">New</th>
                  <th className="pb-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[...days].reverse().map((d) => (
                  <tr key={d.date} className="border-t border-white/5">
                    <td className="py-1.5 text-muted">{d.date}</td>
                    <td className="py-1.5 text-right text-muted">
                      {d.added > 0 ? `+${d.added}` : '—'}
                    </td>
                    <td className="py-1.5 text-right text-text">{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </main>
  );
}
