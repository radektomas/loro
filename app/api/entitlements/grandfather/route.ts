import { NextResponse } from 'next/server';
import {
  getServiceRole,
  ServiceRoleNotConfiguredError,
} from '../../_lib/serviceRole';
import { requestUser } from '../../_lib/requestUser';
import type { WordSource } from '@/types';
import { TABLES } from '@/lib/supabase';
import { countsTowardLimit, shouldGrandfather } from '@/lib/entitlements/limit';
import { PAYWALL_ENABLED } from '@/lib/entitlements/config';

/**
 * Grant loro_profiles.is_grandfathered to a user who was already over the free
 * saved-word limit when the paywall turned on.
 *
 * WHY THIS IS A ROUTE AND NOT A CLIENT WRITE. Users can read their own tier and
 * cannot write it — the migration's loro_profiles_tier_guard trigger rejects
 * any client-side write to the entitlement columns, because the existing
 * "own profile - update" policy is column-blind and would otherwise let a
 * signed-in user PATCH themselves to plus with the anon key. So the grant needs
 * the service role, which only exists server-side.
 *
 * THE SERVER RECOUNTS. The client asks; it does not report a total. The count
 * comes from loro_saved_words here, so a tampered request buys nothing: the same
 * shouldGrandfather() rule the client uses to decide whether to ask is re-run
 * against data the client cannot forge. That the two agree is the point of the
 * rule being a pure shared function.
 *
 * IDEMPOTENT. An already-grandfathered user gets `grandfathered: true` and no
 * write, so the client's retry-at-next-auth-event contract cannot double-apply
 * or re-stamp a timestamp.
 *
 * NOTE ON DEPLOYMENT. This needs SUPABASE_SERVICE_ROLE_KEY, which currently
 * exists only in the local .env — the same gap /api/account/delete has. Until
 * it is added to the deployment, this route answers 503 and the client logs and
 * retries at the next auth event. That is harmless while the paywall ships dark
 * (nothing is gated, so nothing needs grandfathering) but it MUST be in place
 * before PAYWALL_ENABLED flips, or the users who earned unlimited saves will be
 * the first ones blocked.
 */
export async function POST(req: Request) {
  const auth = await requestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Nothing to grandfather anyone against while the paywall is off. Answering
  // plainly (rather than granting speculatively) keeps the flag the single
  // switch: no rows are quietly stamped before the feature exists.
  if (!PAYWALL_ENABLED) {
    return NextResponse.json({ grandfathered: false, reason: 'paywall_off' });
  }

  let admin;
  try {
    admin = getServiceRole();
  } catch (error) {
    if (error instanceof ServiceRoleNotConfiguredError) {
      console.error(`[entitlements] ${error.message}`);
      return NextResponse.json(
        { error: 'Not configured.' },
        { status: 503 }
      );
    }
    throw error;
  }

  const { data: profile, error: profileError } = await admin
    .from(TABLES.profiles)
    .select('tier, is_grandfathered')
    .eq('id', auth.userId)
    .maybeSingle();
  if (profileError) {
    console.error('[entitlements] profile read failed', profileError.message);
    return NextResponse.json({ error: 'Unavailable.' }, { status: 503 });
  }
  if (!profile) {
    // No profile row yet (ensureProfile races a first sign-in). Nothing to
    // grant; the client retries at the next auth event.
    return NextResponse.json({ grandfathered: false, reason: 'no_profile' });
  }

  const row = profile as { tier?: string | null; is_grandfathered?: boolean | null };
  if (row.is_grandfathered === true) {
    return NextResponse.json({ grandfathered: true, reason: 'already' });
  }

  // Recount server-side. One column: the count is a count, and pulling whole
  // rows for a user with a large vocabulary would be waste. The filter stays in
  // JS rather than becoming `where source is distinct from 'deck'`, because
  // "counts toward the limit" is one rule in one place
  // (lib/entitlements/limit.ts) and a SQL predicate is a second copy that can
  // drift from it — silently, and in the direction of granting or denying
  // unlimited saves.
  //
  // A null source reads as 'user', which matches the client's wordSourceOf
  // (lib/storage.ts) because the migration that adds this column back-fills the
  // old deck's 'starter' rows to 'deck' in the same file. The two steps cannot
  // come apart, so there is no window where the server counts a grant that the
  // client exempts.
  const { data: words, error: wordsError } = await admin
    .from(TABLES.savedWords)
    .select('source')
    .eq('user_id', auth.userId);
  if (wordsError) {
    console.error('[entitlements] word count failed', wordsError.message);
    return NextResponse.json({ error: 'Unavailable.' }, { status: 503 });
  }

  const savedCount = (words as { source: WordSource | null }[]).filter((w) =>
    countsTowardLimit({ source: w.source ?? 'user' })
  ).length;

  const grant = shouldGrandfather({
    // The route's own verdict, not the caller's: the client's dev override
    // cannot reach across the network.
    paywallActive: PAYWALL_ENABLED,
    tier: row.tier === 'plus' ? 'plus' : 'free',
    isGrandfathered: false,
    savedCount,
  });
  if (!grant) {
    return NextResponse.json({ grandfathered: false, reason: 'under_limit' });
  }

  const { error: updateError } = await admin
    .from(TABLES.profiles)
    .update({ is_grandfathered: true })
    .eq('id', auth.userId);
  if (updateError) {
    console.error('[entitlements] grandfather write failed', updateError.message);
    return NextResponse.json({ error: 'Unavailable.' }, { status: 503 });
  }

  console.log(
    `[entitlements] grandfathered ${auth.userId} at ${savedCount} counted words`
  );
  return NextResponse.json({ grandfathered: true, reason: 'granted' });
}
