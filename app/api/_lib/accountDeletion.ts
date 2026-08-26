/**
 * Account deletion core — GDPR + App Store 5.1.1(v).
 *
 * Pure orchestration over an injected admin client: this module reads no env,
 * creates no client and knows no URLs, which is what lets the test suite run
 * it against an in-memory fake with zero possibility of touching production.
 * The route (app/api/account/delete/route.ts) is the only place the real
 * service-role client is attached.
 *
 * Deletion contract, in order:
 *   1. Refuse admins (loro_admins allowlist) — a tester's own account must
 *      not be nukeable from the UI.
 *   2. Delete Loro DB rows explicitly, FK-safe order, never relying on
 *      ON DELETE CASCADE (belt over braces: every table cascades today, but
 *      an explicit list is auditable and survives a constraint change).
 *      Any failure aborts BEFORE storage or auth — re-running is safe.
 *   2b. ANONYMISE, rather than delete, the tables that are measurements of
 *      what happened rather than the user's own data (loro_analytics_events).
 *      See ANONYMISED_USER_TABLES for why this is not step 2.
 *   3. Empty the user's storage folders (both buckets, paginated walk).
 *      Partial failure logs and CONTINUES: an orphaned file is recoverable
 *      by hand, an account stuck half-deleted is worse.
 *   4. Cross-product guard, then auth.admin.deleteUser() — see below.
 */

type DbResult = { error: { message: string } | null };
type StorageEntry = { name: string; id: string | null };

/** The slice of SupabaseClient this module actually uses, so tests can fake
    it structurally instead of dragging in the real client. Query results are
    PromiseLike, not Promise — Supabase's builders are thenables. */
export type AdminLike = {
  from(table: string): {
    select(
      columns: string,
      options?: { count?: 'exact'; head?: boolean }
    ): {
      eq(
        column: string,
        value: string
      ): PromiseLike<DbResult & { count?: number | null }>;
    };
    delete(): {
      eq(column: string, value: string): PromiseLike<DbResult>;
    };
    /** Only ever used to NULL a column — see ANONYMISED_USER_TABLES. */
    update(patch: Record<string, null>): {
      eq(column: string, value: string): PromiseLike<DbResult>;
    };
  };
  storage: {
    from(bucket: string): {
      list(
        prefix: string,
        options: { limit: number; offset: number }
      ): Promise<{ data: StorageEntry[] | null; error: { message: string } | null }>;
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
    };
  };
  rpc(fn: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
  auth: {
    admin: {
      deleteUser(id: string): Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Non-Loro tables with a FOREIGN KEY to auth.users, enumerated 2026-07-25 via
 * loro_auth_fk_report() (migration 20260725030000) — UNSCOPED across all
 * schemas, excluding Supabase's own auth.* / storage.* machinery. NOT from
 * memory: an earlier incidental sighting (orders, coldcall_leads via
 * triggers) turned out to have no auth.users FK at all, while all four of
 * these were missed. Re-run the report to refresh this list.
 *
 * WHY THIS EXISTS. This Supabase project is shared across products, so
 * auth.admin.deleteUser() would erase the person's sign-in everywhere, not
 * just in Loro. If the user has rows in any of these tables, Loro deletes its
 * own data but leaves the auth user standing (authDeleted: false) and the UI
 * says so. Delete this whole mechanism when Loro gets its own project.
 *
 * The runtime check (loro_foreign_user_rows) re-enumerates FKs live on every
 * call; this constant is the reviewed expectation. A table reported at
 * runtime that is NOT in this list means a product added a table after this
 * enumeration — treated as blocking, because an unreviewed table is exactly
 * what the guard exists for.
 */
export const CROSS_PRODUCT_TABLES: readonly string[] = [
  'public.profiles',
  'public.analytics_events',
  'public.generation_history',
  'public.saved_destinations',
];

/**
 * The subset whose rows BLOCK auth deletion — tables where a row means the
 * person deliberately used the other product (ran a generation, saved a
 * destination). Verified 2026-07-25 against live data and the confirmed
 * auth.users trigger (on_auth_user_created -> handle_new_user):
 *
 *   * public.profiles is NON-blocking: auto-provisioned for EVERY signup by
 *     that trigger (23/25 auth users had one, including all recent signups
 *     and users who never used Triply). Blocking on it would mean
 *     deleteUser() never runs for anyone. Its ON DELETE CASCADE is
 *     desirable — it erases the OAuth-copied PII (email, name, avatar).
 *     RESIDUAL EDGE, accepted: a Triply user who customized their profile
 *     but has zero generations and zero saves loses the profile row; it is
 *     auto-provisioned and regenerates on their next sign-in.
 *   * public.analytics_events is NON-blocking: usage telemetry whose FK is
 *     ON DELETE SET NULL — that product designed its events to
 *     self-anonymize when the user goes; blocking would override it.
 *
 * Unknown-table detection deliberately stays on the FULL list above: a
 * fifth table appearing later is unreviewed and must block regardless.
 */
export const BLOCKING_CROSS_PRODUCT_TABLES: readonly string[] = [
  'public.generation_history',
  'public.saved_destinations',
];

/**
 * Loro's user-owned rows, in FK-safe order. Every entry is deleted with a
 * single .eq() on the named column. loro_follows appears twice — the user as
 * follower and the user as followed creator. loro_videos goes before
 * loro_creators (creator_id references it), loro_profiles last.
 */
export const LORO_USER_TABLES: readonly { table: string; column: string }[] = [
  { table: 'loro_saved_words', column: 'user_id' },
  { table: 'loro_progress', column: 'user_id' },
  { table: 'loro_follows', column: 'follower_id' },
  { table: 'loro_follows', column: 'creator_id' },
  { table: 'loro_videos', column: 'creator_id' },
  { table: 'loro_creators', column: 'user_id' },
  { table: 'loro_admins', column: 'user_id' },
  { table: 'loro_profiles', column: 'id' },
];

/**
 * Loro tables whose rows are ANONYMISED, not deleted: the user_id is nulled
 * and the row stays.
 *
 * WHY NOT JUST DELETE THEM. loro_analytics_events is a product measurement,
 * not the user's data — the rows say "an install reached the paywall and did
 * not buy", and the person is incidental to that. Deleting them would let any
 * user silently rewrite last month's funnel by closing their account, which is
 * both a data-integrity problem and, in the aggregate, an invitation to
 * misread the product. Nulling the FK keeps the count and destroys the link,
 * which is exactly what the shared project's own analytics_events was designed
 * for (ON DELETE SET NULL) and why accountDeletion treats THAT table as
 * non-blocking. We hold ourselves to the same standard.
 *
 * WHY NOT RELY ON THE FK'S OWN ON DELETE SET NULL. Because it only fires if
 * auth.admin.deleteUser() actually runs, and the cross-product guard means it
 * frequently does not (authDeleted: false — the shared sign-in survives). In
 * that branch the FK never triggers and the events would keep pointing at a
 * live user whose Loro data we just told them we deleted. Doing it explicitly
 * here makes the anonymisation unconditional, which is what was promised.
 *
 * Also note what is NOT here: install_id stays. It is a client-minted
 * pseudonym with no path back to a person, and the device's own copy of it is
 * destroyed by the local `loro.` sweep at the same moment.
 */
export const ANONYMISED_USER_TABLES: readonly { table: string; column: string }[] =
  [{ table: 'loro_analytics_events', column: 'user_id' }];

/** Storage buckets holding user files, keyed <user_id>/... */
export const USER_BUCKETS: readonly string[] = ['loro-videos', 'avatars'];

const LIST_PAGE = 100;
const REMOVE_BATCH = 100;

/** Extract the token from an Authorization header, or null. Exported for the
    route and its tests — the 401 path is this returning null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return token.length > 0 ? token : null;
}

export type DeletionResult =
  | {
      ok: true;
      /** false = cross-product rows exist; Loro data is gone but the
          sign-in survives and must be removed separately. */
      authDeleted: boolean;
    }
  | { ok: false; status: 401 | 403 | 500; reason: string };

/**
 * Recursively collect every object path under `prefix` in `bucket`.
 * storage.list() pages at 100 by default and is per-folder, so this loops
 * offset until a short page AND walks folder entries (id === null) — a
 * creator with hundreds of clips must not leave orphans past page one.
 * Throws on list errors: an unlistable folder means unknown leftovers, and
 * the caller treats storage as best-effort, not this walker.
 */
async function collectPaths(
  admin: AdminLike,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit: LIST_PAGE, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) {
        // Folder placeholder — recurse.
        paths.push(...(await collectPaths(admin, bucket, path)));
      } else {
        paths.push(path);
      }
    }
    if (entries.length < LIST_PAGE) break;
  }
  return paths;
}

/**
 * Delete one user's Loro existence. `userId` MUST come from a verified
 * session token — this function trusts it, so the route must never pass
 * anything derived from a request body.
 */
export async function deleteAccount(
  admin: AdminLike,
  userId: string,
  log: (message: string) => void = console.error
): Promise<DeletionResult> {
  // 1. Admin self-delete guard.
  const { count, error: adminErr } = await admin
    .from('loro_admins')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (adminErr) {
    log(`[account-delete] admin check failed for ${userId}: ${adminErr.message}`);
    return { ok: false, status: 500, reason: 'admin check failed' };
  }
  if ((count ?? 0) > 0) {
    return { ok: false, status: 403, reason: 'admin account' };
  }

  // 2. DB rows, explicit order. Abort on first failure — nothing later
  //    (storage, auth) may run after a half-deleted database state.
  for (const { table, column } of LORO_USER_TABLES) {
    const { error } = await admin.from(table).delete().eq(column, userId);
    if (error) {
      log(
        `[account-delete] delete ${table}.${column}=${userId} failed: ${error.message} — aborting before storage/auth`
      );
      return { ok: false, status: 500, reason: `db delete failed at ${table}` };
    }
  }

  // 2b. Anonymise the measurement tables. Aborts like step 2 does: a user who
  //     was told their account was deleted must not be left linked to rows we
  //     failed to unlink, and a re-run is safe (nulling a null is a no-op).
  for (const { table, column } of ANONYMISED_USER_TABLES) {
    const { error } = await admin
      .from(table)
      .update({ [column]: null })
      .eq(column, userId);
    if (error) {
      log(
        `[account-delete] anonymise ${table}.${column}=${userId} failed: ${error.message} — aborting before storage/auth`
      );
      return { ok: false, status: 500, reason: `db anonymise failed at ${table}` };
    }
  }

  // 3. Storage, best-effort. Failures are logged with full paths for manual
  //    recovery and do NOT abort.
  for (const bucket of USER_BUCKETS) {
    let paths: string[];
    try {
      paths = await collectPaths(admin, bucket, userId);
    } catch (error) {
      log(
        `[account-delete] could not list ${bucket}/${userId} — files may remain: ${
          error instanceof Error ? error.message : error
        }`
      );
      continue;
    }
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const batch = paths.slice(i, i + REMOVE_BATCH);
      const { error } = await admin.storage.from(bucket).remove(batch);
      if (error) {
        log(
          `[account-delete] remove failed in ${bucket} (${error.message}); orphaned: ${batch.join(', ')}`
        );
      }
    }
  }

  // 4. Cross-product guard, then — and only then — the auth user.
  const { data, error: guardErr } = await admin.rpc('loro_foreign_user_rows', {
    uid: userId,
  });
  if (guardErr) {
    // Cannot PROVE the user has no cross-product rows, so the conservative
    // branch: Loro data is gone, the shared sign-in stays.
    log(
      `[account-delete] cross-product guard unavailable for ${userId} (${guardErr.message}) — auth user NOT deleted`
    );
    return { ok: true, authDeleted: false };
  }

  const counts = (data ?? {}) as Record<string, number>;
  const known = new Set(CROSS_PRODUCT_TABLES);
  const blocks = new Set(BLOCKING_CROSS_PRODUCT_TABLES);
  // A table blocks when it is unreviewed (not in the full enumerated list)
  // or when it is a reviewed BLOCKING table with rows. Reviewed non-blocking
  // tables (auto-provisioned shells, self-anonymizing telemetry) never do.
  const blocking = Object.entries(counts).filter(
    ([table, n]) => !known.has(table) || (blocks.has(table) && n > 0)
  );
  if (blocking.length > 0) {
    log(
      `[account-delete] ${userId}: Loro data deleted; auth user KEPT — rows in shared tables: ` +
        blocking
          .map(([t, n]) => `${t}=${n}${known.has(t) ? '' : ' (NOT IN REVIEWED LIST)'}`)
          .join(', ')
    );
    return { ok: true, authDeleted: false };
  }

  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr) {
    // Loro rows are already gone; a retry is safe and completes the job.
    log(
      `[account-delete] auth deleteUser(${userId}) failed: ${authErr.message} — Loro data already deleted, retry completes`
    );
    return { ok: false, status: 500, reason: 'auth delete failed' };
  }

  return { ok: true, authDeleted: true };
}
