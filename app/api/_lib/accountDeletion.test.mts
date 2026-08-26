import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  bearerToken,
  deleteAccount,
  BLOCKING_CROSS_PRODUCT_TABLES,
  CROSS_PRODUCT_TABLES,
  ANONYMISED_USER_TABLES,
  LORO_USER_TABLES,
  USER_BUCKETS,
  type AdminLike,
} from './accountDeletion.ts';

/**
 * PRODUCTION SAFETY — by construction, not by configuration.
 *
 * These tests import ONLY the pure deletion core, which reads no env,
 * imports no Supabase client and opens no connection: every behaviour runs
 * against the in-memory fake below. Running this file with production
 * credentials in the environment does nothing different, because nothing
 * here ever looks at the environment. The one real-credentials execution
 * path is the route handler, which is not imported by any test.
 */

type Row = Record<string, string | null>;

/** In-memory stand-in for the AdminLike surface. */
function makeFakeAdmin(opts?: {
  /** table -> rows (each row is column->value) */
  rows?: Record<string, Row[]>;
  /** bucket -> full object paths */
  files?: Record<string, string[]>;
  /** result of the loro_foreign_user_rows rpc */
  foreignRows?: Record<string, number> | { error: string };
  /** table that should error on delete */
  failDeleteOn?: string;
  /** table that should error on update (the anonymisation step) */
  failUpdateOn?: string;
  /** make storage.remove fail */
  failRemove?: boolean;
}) {
  const rows = new Map<string, Row[]>(Object.entries(opts?.rows ?? {}));
  const files = new Map<string, string[]>(Object.entries(opts?.files ?? {}));
  const authUsers = new Set<string>(['user-a', 'user-b', 'admin-1']);
  const removedPaths: Record<string, string[]> = {};
  const deletedTables: string[] = [];
  const anonymisedTables: string[] = [];

  const admin: AdminLike = {
    from(table) {
      return {
        select() {
          return {
            async eq(column, value) {
              const matching = (rows.get(table) ?? []).filter(
                (r) => r[column] === value
              );
              return { error: null, count: matching.length };
            },
          };
        },
        delete() {
          return {
            async eq(column, value) {
              if (opts?.failDeleteOn === table) {
                return { error: { message: `boom in ${table}` } };
              }
              deletedTables.push(`${table}.${column}`);
              rows.set(
                table,
                (rows.get(table) ?? []).filter((r) => r[column] !== value)
              );
              return { error: null };
            },
          };
        },
        /** Nulls the patched columns IN PLACE, leaving the row — the whole
            point of the anonymisation step is that the row survives. */
        update(patch) {
          return {
            async eq(column, value) {
              if (opts?.failUpdateOn === table) {
                return { error: { message: `boom updating ${table}` } };
              }
              anonymisedTables.push(`${table}.${column}`);
              rows.set(
                table,
                (rows.get(table) ?? []).map((r) =>
                  r[column] === value ? { ...r, ...patch } : r
                )
              );
              return { error: null };
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          async list(prefix, { limit, offset }) {
            // Direct children of prefix, like the real API: files whose
            // remainder has no '/', folders (id: null) otherwise.
            const all = files.get(bucket) ?? [];
            const children = new Map<string, boolean>(); // name -> isFile
            for (const path of all) {
              if (!path.startsWith(`${prefix}/`)) continue;
              const rest = path.slice(prefix.length + 1);
              const slash = rest.indexOf('/');
              if (slash === -1) children.set(rest, true);
              else children.set(rest.slice(0, slash), false);
            }
            const entries = [...children.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .slice(offset, offset + limit)
              .map(([name, isFile]) => ({
                name,
                id: isFile ? `id-${name}` : null,
              }));
            return { data: entries, error: null };
          },
          async remove(paths) {
            if (opts?.failRemove) return { error: { message: 'remove boom' } };
            (removedPaths[bucket] ??= []).push(...paths);
            files.set(
              bucket,
              (files.get(bucket) ?? []).filter((p) => !paths.includes(p))
            );
            return { error: null };
          },
        };
      },
    },
    async rpc(fn) {
      assert.equal(fn, 'loro_foreign_user_rows');
      const fr = opts?.foreignRows ?? {};
      if ('error' in fr && typeof fr.error === 'string') {
        return { data: null, error: { message: fr.error } };
      }
      return { data: fr, error: null };
    },
    auth: {
      admin: {
        async deleteUser(id) {
          authUsers.delete(id);
          return { error: null };
        },
      },
    },
  };

  return {
    admin,
    rows,
    files,
    authUsers,
    removedPaths,
    deletedTables,
    anonymisedTables,
  };
}

/** Rows for user-a in every Loro table, plus user-b noise that must survive. */
function seedAllTables(): Record<string, Row[]> {
  return {
    loro_saved_words: [
      { user_id: 'user-a' },
      { user_id: 'user-a' },
      { user_id: 'user-b' },
    ],
    loro_progress: [{ user_id: 'user-a' }, { user_id: 'user-b' }],
    loro_follows: [
      { follower_id: 'user-a', creator_id: 'user-b' },
      { follower_id: 'user-b', creator_id: 'user-a' },
      { follower_id: 'user-b', creator_id: 'user-b' },
    ],
    loro_videos: [{ creator_id: 'user-a' }, { creator_id: 'user-b' }],
    loro_creators: [{ user_id: 'user-a' }, { user_id: 'user-b' }],
    loro_admins: [{ user_id: 'admin-1' }],
    loro_profiles: [{ id: 'user-a' }, { id: 'user-b' }],
    // Anonymised, not deleted — see ANONYMISED_USER_TABLES. The third row is
    // already anonymous (an install that never signed in), which is the
    // majority case on a hard-paywall app and must survive untouched.
    loro_analytics_events: [
      { user_id: 'user-a' },
      { user_id: 'user-b' },
      { user_id: null },
    ],
  };
}

const noLog = () => {};

describe('bearerToken (the 401 path)', () => {
  test('no header -> null', () => {
    assert.equal(bearerToken(null), null);
  });
  test('empty bearer -> null', () => {
    assert.equal(bearerToken('Bearer '), null);
    assert.equal(bearerToken(''), null);
  });
  test('token extracted case-insensitively', () => {
    assert.equal(bearerToken('Bearer abc123'), 'abc123');
    assert.equal(bearerToken('bearer abc123'), 'abc123');
  });
});

describe('deleteAccount', () => {
  test('deletes every Loro row for the verified user and no one else', async () => {
    const fake = makeFakeAdmin({ rows: seedAllTables() });
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.deepEqual(result, { ok: true, authDeleted: true });

    // Zero rows with user-a's id anywhere, across all six tables.
    for (const { table, column } of LORO_USER_TABLES) {
      const remaining = (fake.rows.get(table) ?? []).filter(
        (r) => r[column] === 'user-a'
      );
      assert.equal(remaining.length, 0, `${table}.${column} should be empty`);
    }
    // user-b's world is intact: words, progress, own follow, video, creator,
    // profile.
    assert.equal(fake.rows.get('loro_saved_words')!.length, 1);
    assert.equal(fake.rows.get('loro_progress')!.length, 1);
    assert.equal(fake.rows.get('loro_follows')!.length, 1); // b->b only
    assert.equal(fake.rows.get('loro_videos')!.length, 1);
    assert.equal(fake.rows.get('loro_creators')!.length, 1);
    assert.equal(fake.rows.get('loro_profiles')!.length, 1);
    assert.ok(fake.authUsers.has('user-b'));
    assert.ok(!fake.authUsers.has('user-a'));
  });

  test('a user_id smuggled into a request body cannot matter: only the passed (verified) id is used', async () => {
    // deleteAccount's signature admits exactly one id — the route passes the
    // token-verified one and never reads the body. This test pins the
    // contract: everything user-b keeps existing when user-a is deleted.
    const fake = makeFakeAdmin({ rows: seedAllTables() });
    await deleteAccount(fake.admin, 'user-a', noLog);
    assert.ok(fake.authUsers.has('user-b'));
    assert.equal(
      (fake.rows.get('loro_saved_words') ?? []).filter((r) => r.user_id === 'user-b').length,
      1
    );
  });

  test('admin accounts are refused before anything is touched', async () => {
    const fake = makeFakeAdmin({ rows: seedAllTables() });
    const result = await deleteAccount(fake.admin, 'admin-1', noLog);
    assert.deepEqual(result, { ok: false, status: 403, reason: 'admin account' });
    assert.equal(fake.deletedTables.length, 0);
    assert.ok(fake.authUsers.has('admin-1'));
  });

  test('cross-product rows: Loro data deleted, auth user KEPT, flagged', async () => {
    // The seeded row in a non-Loro table (saved_destinations) is the shared
    // database scenario: another product still references this sign-in.
    const fake = makeFakeAdmin({
      rows: seedAllTables(),
      foreignRows: {
        'public.profiles': 0,
        'public.analytics_events': 0,
        'public.generation_history': 0,
        'public.saved_destinations': 3,
      },
    });
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.deepEqual(result, { ok: true, authDeleted: false });
    assert.ok(fake.authUsers.has('user-a'), 'auth user must still exist');
    for (const { table, column } of LORO_USER_TABLES) {
      assert.equal(
        (fake.rows.get(table) ?? []).filter((r) => r[column] === 'user-a').length,
        0,
        `${table} should still be cleared`
      );
    }
  });

  test('auto-provisioned shells alone take the HAPPY path: profiles + telemetry rows do not block deleteUser', async () => {
    // The confirmed on_auth_user_created trigger gives EVERY signup a
    // public.profiles row — if that blocked, no account could ever be
    // deleted. Same for self-anonymizing analytics rows.
    const fake = makeFakeAdmin({
      rows: seedAllTables(),
      foreignRows: {
        'public.profiles': 1,
        'public.analytics_events': 12,
        'public.generation_history': 0,
        'public.saved_destinations': 0,
      },
    });
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.deepEqual(result, { ok: true, authDeleted: true });
    assert.ok(!fake.authUsers.has('user-a'), 'deleteUser must have run');
  });

  test('blocking subset is exactly the deliberate-action tables, inside the full list', () => {
    assert.deepEqual(
      [...BLOCKING_CROSS_PRODUCT_TABLES],
      ['public.generation_history', 'public.saved_destinations']
    );
    for (const t of BLOCKING_CROSS_PRODUCT_TABLES) {
      assert.ok(CROSS_PRODUCT_TABLES.includes(t), `${t} must stay in the full list`);
    }
  });

  test('a table missing from the reviewed list blocks auth deletion even at zero rows', async () => {
    const fake = makeFakeAdmin({
      rows: seedAllTables(),
      foreignRows: { 'public.brand_new_product': 0 },
    });
    assert.ok(!CROSS_PRODUCT_TABLES.includes('public.brand_new_product'));
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.deepEqual(result, { ok: true, authDeleted: false });
    assert.ok(fake.authUsers.has('user-a'));
  });

  test('guard RPC failure is conservative: auth user kept', async () => {
    const fake = makeFakeAdmin({
      rows: seedAllTables(),
      foreignRows: { error: 'function unreachable' },
    });
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.deepEqual(result, { ok: true, authDeleted: false });
    assert.ok(fake.authUsers.has('user-a'));
  });

  test('storage: paginated past 100 and recursive into folders, both buckets', async () => {
    // 130 flat files (breaks the one-page assumption) plus nested poster
    // files under a subfolder, plus an avatar; user-b's files untouched.
    const clips = Array.from({ length: 130 }, (_, i) => `user-a/clip-${String(i).padStart(3, '0')}.mp4`);
    const fake = makeFakeAdmin({
      rows: seedAllTables(),
      files: {
        'loro-videos': [
          ...clips,
          'user-a/posters/p1.jpg',
          'user-b/keep.mp4',
        ],
        avatars: ['user-a/123.webp', 'user-b/456.webp'],
      },
    });
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.deepEqual(result, { ok: true, authDeleted: true });
    assert.deepEqual(fake.files.get('loro-videos'), ['user-b/keep.mp4']);
    assert.deepEqual(fake.files.get('avatars'), ['user-b/456.webp']);
    assert.equal(fake.removedPaths['loro-videos'].length, 131);
  });

  test('analytics events are ANONYMISED, not deleted — the row survives without the user', async () => {
    const fake = makeFakeAdmin({ rows: seedAllTables() });
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.deepEqual(result, { ok: true, authDeleted: true });

    const events = fake.rows.get('loro_analytics_events') ?? [];
    // The count is the point: a funnel must not change shape because someone
    // closed their account.
    assert.equal(events.length, 3, 'no analytics row may be deleted');
    assert.equal(
      events.filter((r) => r.user_id === 'user-a').length,
      0,
      'user-a must no longer be linked to any event'
    );
    // And nobody else was touched.
    assert.equal(events.filter((r) => r.user_id === 'user-b').length, 1);
    assert.equal(events.filter((r) => r.user_id === null).length, 2);
  });

  test('anonymisation runs even on the cross-product path, where the FK never fires', async () => {
    // authDeleted: false means auth.admin.deleteUser() is skipped, so the
    // column's own ON DELETE SET NULL never triggers. This is the branch the
    // explicit step exists for.
    const fake = makeFakeAdmin({
      rows: seedAllTables(),
      foreignRows: { 'public.generation_history': 3 },
    });
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.deepEqual(result, { ok: true, authDeleted: false });
    assert.ok(fake.authUsers.has('user-a'), 'the shared sign-in must survive');

    const events = fake.rows.get('loro_analytics_events') ?? [];
    assert.equal(
      events.filter((r) => r.user_id === 'user-a').length,
      0,
      'the link must be destroyed whether or not the auth user was'
    );
  });

  test('an anonymisation failure aborts BEFORE storage and auth', async () => {
    const fake = makeFakeAdmin({
      rows: seedAllTables(),
      files: { 'loro-videos': ['user-a/clip.mp4'] },
      failUpdateOn: 'loro_analytics_events',
    });
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.equal(result.ok, false);
    assert.ok(fake.authUsers.has('user-a'), 'auth user must survive the abort');
    assert.deepEqual(fake.removedPaths, {}, 'storage must not have been touched');
  });

  test('ANONYMISED_USER_TABLES and LORO_USER_TABLES are disjoint', () => {
    // A table in both lists would be deleted and then "anonymised" — the
    // update would silently match nothing and the intent would be lost.
    const deleted = new Set(LORO_USER_TABLES.map((t) => t.table));
    for (const { table } of ANONYMISED_USER_TABLES) {
      assert.ok(!deleted.has(table), `${table} is in both lists`);
    }
  });

  test('a DB delete failure aborts BEFORE storage and auth', async () => {
    const fake = makeFakeAdmin({
      rows: seedAllTables(),
      files: { 'loro-videos': ['user-a/clip.mp4'], avatars: [] },
      failDeleteOn: 'loro_videos',
    });
    const result = await deleteAccount(fake.admin, 'user-a', noLog);
    assert.deepEqual(result, {
      ok: false,
      status: 500,
      reason: 'db delete failed at loro_videos',
    });
    assert.deepEqual(fake.files.get('loro-videos'), ['user-a/clip.mp4']);
    assert.ok(fake.authUsers.has('user-a'));
  });

  test('storage failure logs and CONTINUES to auth deletion', async () => {
    const logged: string[] = [];
    const fake = makeFakeAdmin({
      rows: seedAllTables(),
      files: { 'loro-videos': ['user-a/clip.mp4'], avatars: [] },
      failRemove: true,
    });
    const result = await deleteAccount(fake.admin, 'user-a', (m) => logged.push(m));
    assert.deepEqual(result, { ok: true, authDeleted: true });
    assert.ok(!fake.authUsers.has('user-a'));
    assert.ok(
      logged.some((m) => m.includes('orphaned') && m.includes('user-a/clip.mp4')),
      'failed paths must be logged for manual recovery'
    );
  });

  test('buckets under deletion are exactly the two user-keyed ones', () => {
    assert.deepEqual([...USER_BUCKETS], ['loro-videos', 'avatars']);
  });
});
