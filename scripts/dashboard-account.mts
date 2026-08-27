#!/usr/bin/env node
/**
 * Loro — provision the dedicated ADMIN DASHBOARD account.
 *
 *   node scripts/dashboard-account.mts            # dry run, reports only
 *   node scripts/dashboard-account.mts --apply    # create / repair it
 *
 * WHAT PROBLEM THIS SOLVES. /admin/* is gated in Postgres: every report is a
 * SECURITY DEFINER function that re-checks loro_is_admin(), which is
 * `exists(select 1 from loro_admins where user_id = auth.uid())`. So the only
 * thing that opens those screens is a real Supabase session belonging to a row
 * in loro_admins — a password checked in the browser grants nothing, and the
 * service role key does NOT help either: it makes auth.uid() null, so
 * loro_is_admin() returns false for it.
 *
 * The human accounts that satisfy that are Radek's Google logins, which live
 * in a Supabase project SHARED with another product — and OAuth sign-in only
 * lands the session on the origin Supabase redirects to, which is the failure
 * that started this. This script makes a THIRD kind of admin: an account that
 * exists solely to open the dashboard, signs in with a password (no redirect
 * to misroute), and touches nothing else.
 *
 * WHY THE SERVICE ROLE KEY IS NEEDED HERE AND NOWHERE ELSE. The project has
 * mailer_autoconfirm off, so a normal signUp() would sit unconfirmed and never
 * be able to sign in. The admin API can create the user already confirmed,
 * which is the only way to do this without an email round trip. The key is
 * required by this CLI only — it is NOT needed by the deployment, and this
 * changes nothing about SUPABASE_SERVICE_ROLE_KEY still being absent from
 * Vercel.
 *
 * SIDE EFFECTS, stated plainly because this writes to a shared production
 * database:
 *   - one row in auth.users, which fires the shared on_auth_user_created
 *     trigger and therefore also creates one row in public.profiles
 *   - one row in public.loro_admins
 * Both are reversible: deleting the auth user cascades the loro_admins row.
 *
 * Re-running is safe. An existing account has its password reset to the
 * current env value, which is also how you rotate it.
 */

import { loadEnv, requireEnv } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { createClient } from '@supabase/supabase-js';

loadEnv();

const apply = process.argv.includes('--apply');
const email = requireEnv('ADMIN_DASHBOARD_EMAIL');
const password = requireEnv('ADMIN_DASHBOARD_PASSWORD');
const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

const admin = getAdminClient();

/** listUsers is paginated and there is no get-by-email; walk until found. */
async function findByEmail(target: string): Promise<{ id: string } | null> {
  const wanted = target.trim().toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (hit) return { id: hit.id };
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function main() {
  console.log(`\nAdmin dashboard account: ${email}`);
  console.log(apply ? 'Mode: APPLY\n' : 'Mode: dry run (pass --apply to write)\n');

  const existing = await findByEmail(email);
  let userId = existing?.id ?? null;

  if (existing) {
    console.log(`  auth.users        exists  ${existing.id}`);
    if (apply) {
      // Also the rotation path: whatever is in the env becomes the password.
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`updateUserById: ${error.message}`);
      console.log('  password          set from ADMIN_DASHBOARD_PASSWORD');
    } else {
      console.log('  password          would be set from ADMIN_DASHBOARD_PASSWORD');
    }
  } else if (apply) {
    // email_confirm skips the confirmation mail entirely — nothing is sent to
    // this address, which is the point: it is a credential, not an inbox.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    userId = data.user.id;
    console.log(`  auth.users        created  ${userId}`);
  } else {
    console.log('  auth.users        would be created (confirmed, no email sent)');
  }

  if (userId) {
    const { data: row, error } = await admin
      .from('loro_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`loro_admins select: ${error.message}`);
    if (row) {
      console.log('  loro_admins       already listed');
    } else if (apply) {
      const { error: insErr } = await admin
        .from('loro_admins')
        .insert({ user_id: userId });
      if (insErr) throw new Error(`loro_admins insert: ${insErr.message}`);
      console.log('  loro_admins       granted');
    } else {
      console.log('  loro_admins       would be granted');
    }
  }

  if (!apply) {
    console.log('\nNothing was written. Re-run with --apply.\n');
    return;
  }

  // Verify the way the browser will: anon key, password sign-in, and the same
  // loro_is_admin() the dashboard gate calls. A green report here means the
  // screen works; anything else is better found now than in a browser.
  console.log('\nVerifying as the app would…');
  const app = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await app.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw new Error(`sign-in failed: ${signInErr.message}`);
  console.log('  sign-in           ok');

  const { data: isAdmin, error: rpcErr } = await app.rpc('loro_is_admin');
  if (rpcErr) throw new Error(`loro_is_admin: ${rpcErr.message}`);
  console.log(`  loro_is_admin     ${isAdmin === true ? 'true' : 'FALSE'}`);

  const { error: reportErr } = await app.rpc('loro_analytics_overview', {
    p_days: 30,
    p_all_builds: true,
  });
  console.log(
    `  analytics report  ${reportErr ? `FAILED — ${reportErr.message}` : 'ok'}`
  );

  await app.auth.signOut();
  console.log(
    `\nDone. Sign in at /admin/analytics with ${email} and the password in .env.\n`
  );
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
