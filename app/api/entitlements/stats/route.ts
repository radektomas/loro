import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TABLES } from '@/lib/supabase';
import { computeStreaks } from '@/lib/progress';
import { MAX_BOX } from '@/lib/srs';
import { PAYWALL_ENABLED } from '@/lib/entitlements/config';
import { requestUser } from '../../_lib/requestUser';
import {
  STAT_METRICS,
  type StatsResponse,
} from '@/lib/entitlements/stats';

/**
 * The Loro Plus statistics, for the /profile hub.
 *
 * THE VALUES ARE NOT SENT TO FREE-TIER CLIENTS. That is the entire reason this
 * is a route and not a hook over localStorage. A blurred number is still in the
 * DOM: anyone who opens devtools has it, which makes the lock a costume rather
 * than a feature and reads as amateur the first time someone notices. So a free
 * user's response carries the metric LABELS and nothing else — there is no value
 * in the payload to un-blur.
 *
 * NO SERVICE ROLE. Every read here is the caller's own data, so the request is
 * made with the anon key plus the caller's own access token and runs under the
 * same RLS policies the browser would get ("own words - select", "own profile -
 * select"). The service role is reserved for the one thing RLS genuinely cannot
 * express — writing an entitlement column — and is not needed to read a user
 * their own numbers. It also means this route works on a deployment that has no
 * service key configured.
 *
 * TIER COMES FROM THE DATABASE, not from the request. The client cannot ask for
 * the unlocked variant.
 */

/** Rows are fetched a page at a time; a plus user's vocabulary is unbounded and
    Supabase caps a single select at 1000 rows by default. */
const PAGE = 1000;

export async function GET(req: Request) {
  const auth = await requestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { authorization: `Bearer ${auth.token}` } },
    }
  );

  const { data: profile, error: profileError } = await supabase
    .from(TABLES.profiles)
    .select('tier, is_grandfathered')
    .eq('id', auth.userId)
    .maybeSingle();
  if (profileError) {
    console.error('[entitlements] stats profile read failed', profileError.message);
    return NextResponse.json({ error: 'Unavailable.' }, { status: 503 });
  }

  const row = (profile ?? {}) as {
    tier?: string | null;
    is_grandfathered?: boolean | null;
  };
  const tier = row.tier === 'plus' ? 'plus' : 'free';

  // Grandfathering buys unlimited SAVES and nothing else — it is compensation
  // for a ceiling that appeared under someone's feet, not a free subscription.
  // Statistics stay behind the tier.
  //
  // While the paywall is off there is no Plus to sell and therefore nothing to
  // lock: every signed-in user gets their real numbers, and the locked variant
  // is only reachable in dev. This is what keeps the paywall UI invisible in
  // production without any component knowing the flag exists.
  //
  // `?lock=1` forces the locked variant, IN DEV ONLY — NODE_ENV is inlined at
  // build time, so in production this reads false and the tier check above is
  // the only thing that can unlock a response. Without it the locked state
  // would be unreachable before launch (the flag is off, so everyone unlocks)
  // and would ship having never been looked at.
  const devLock =
    process.env.NODE_ENV !== 'production' &&
    new URL(req.url).searchParams.get('lock') === '1';

  const unlocked = !devLock && (tier === 'plus' || !PAYWALL_ENABLED);
  if (!unlocked) {
    const locked: StatsResponse = { locked: true, tier, metrics: STAT_METRICS };
    return NextResponse.json(locked);
  }

  // Only the three columns the metrics need. Provenance is deliberately absent:
  // every metric here is about how the user has PRACTISED, and a granted word
  // that has been reviewed twenty times counts exactly as much as any other.
  // (The gates are the only thing that cares where a word came from.)
  const words: { box: number; correct: number; incorrect: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(TABLES.savedWords)
      .select('box, correct, incorrect')
      .eq('user_id', auth.userId)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[entitlements] stats word read failed', error.message);
      return NextResponse.json({ error: 'Unavailable.' }, { status: 503 });
    }
    const page = data as typeof words;
    words.push(...page);
    if (page.length < PAGE) break;
  }

  const { data: progress, error: progressError } = await supabase
    .from(TABLES.progress)
    .select('recall_days')
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (progressError) {
    console.error('[entitlements] stats progress read failed', progressError.message);
    return NextResponse.json({ error: 'Unavailable.' }, { status: 503 });
  }
  const recallDays = Array.isArray(
    (progress as { recall_days?: unknown } | null)?.recall_days
  )
    ? ((progress as { recall_days: string[] }).recall_days ?? [])
    : [];

  let mastered = 0;
  let correct = 0;
  let attempts = 0;
  for (const w of words) {
    if ((w.box ?? 0) >= MAX_BOX) mastered++;
    correct += w.correct ?? 0;
    attempts += (w.correct ?? 0) + (w.incorrect ?? 0);
  }

  const unlockedResponse: StatsResponse = {
    locked: false,
    tier,
    metrics: STAT_METRICS,
    values: {
      mastered,
      // Rounded here, not in the component: a percentage is a derived number
      // and the client has no business holding the raw counts it came from.
      accuracy: attempts > 0 ? Math.round((correct / attempts) * 100) : 0,
      longestStreak: computeStreaks(recallDays).longest,
      reviews: attempts,
    },
  };
  return NextResponse.json(unlockedResponse);
}
