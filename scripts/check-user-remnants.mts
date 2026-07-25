#!/usr/bin/env node
/**
 * Loro — READ-ONLY post-deletion verification for one user id.
 *
 *   node scripts/check-user-remnants.mts <auth-user-uuid>
 *
 * The manual half of trusting /api/account/delete: after deleting a
 * throwaway account through the UI, run this with the account's uid (record
 * it BEFORE deleting — Supabase dashboard -> Authentication -> Users). It
 * reports, for that id:
 *
 *   - row counts in every Loro user table (expect 0 everywhere)
 *   - remaining objects under <uid>/ in both storage buckets (expect none)
 *   - whether the auth user still exists — the definitive answer to "did the
 *     happy path reach auth.admin.deleteUser(), or did the cross-product
 *     guard branch keep the sign-in?"
 *   - the cross-product guard's own view (loro_foreign_user_rows), so a kept
 *     sign-in comes with the reason attached
 *
 * Writes nothing. Safe to run against production, repeatedly.
 */

import { loadEnv } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';

const uid = process.argv[2];
if (!uid || !/^[0-9a-f-]{36}$/i.test(uid)) {
  console.error('usage: node scripts/check-user-remnants.mts <auth-user-uuid>');
  process.exit(1);
}

loadEnv();
const supabase = getAdminClient();

// Mirrors LORO_USER_TABLES in app/api/_lib/accountDeletion.ts.
const TABLES: readonly { table: string; column: string }[] = [
  { table: 'loro_saved_words', column: 'user_id' },
  { table: 'loro_progress', column: 'user_id' },
  { table: 'loro_follows', column: 'follower_id' },
  { table: 'loro_follows', column: 'creator_id' },
  { table: 'loro_videos', column: 'creator_id' },
  { table: 'loro_creators', column: 'user_id' },
  { table: 'loro_admins', column: 'user_id' },
  { table: 'loro_profiles', column: 'id' },
];
const BUCKETS = ['loro-videos', 'avatars'] as const;

let leftovers = 0;

console.log(`\nRemnant check for ${uid}\n`);
console.log('  DB rows:');
for (const { table, column } of TABLES) {
  const { count, error } = await supabase
    .from(table)
    .select(column, { count: 'exact', head: true })
    .eq(column, uid);
  if (error) {
    console.log(`    ${table}.${column}: READ ERROR ${error.message}`);
    leftovers += 1;
    continue;
  }
  const n = count ?? 0;
  if (n > 0) leftovers += n;
  console.log(`    ${table}.${column}: ${n}${n > 0 ? '   <-- LEFTOVER' : ''}`);
}

console.log('\n  Storage:');
for (const bucket of BUCKETS) {
  // One page is enough for a verification read: any entry at all is a fail,
  // and an emptied folder no longer lists.
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(uid, { limit: 100, offset: 0 });
  if (error) {
    console.log(`    ${bucket}/${uid}: LIST ERROR ${error.message}`);
    leftovers += 1;
    continue;
  }
  const entries = data ?? [];
  if (entries.length > 0) leftovers += entries.length;
  console.log(
    `    ${bucket}/${uid}: ${entries.length} object(s)${
      entries.length > 0
        ? '   <-- LEFTOVER: ' + entries.map((e) => e.name).join(', ')
        : ''
    }`
  );
}

console.log('\n  Auth:');
const { data: userData, error: authErr } = await supabase.auth.admin.getUserById(uid);
if (authErr || !userData?.user) {
  console.log('    auth user: GONE — auth.admin.deleteUser() ran (happy path).');
} else {
  console.log('    auth user: STILL EXISTS — the guard branch kept the sign-in.');
  const { data: guard, error: guardErr } = await supabase.rpc(
    'loro_foreign_user_rows',
    { uid }
  );
  console.log(
    guardErr
      ? `    guard view unavailable: ${guardErr.message}`
      : `    guard view: ${JSON.stringify(guard)}`
  );
}

console.log(
  leftovers === 0
    ? '\n  ✓ no Loro remnants.\n'
    : `\n  ✗ ${leftovers} leftover(s) found — see markers above.\n`
);
