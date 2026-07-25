-- Cross-product introspection for account deletion.
--
-- This Supabase project is SHARED across products: auth.users is referenced
-- by non-Loro tables, so auth.admin.deleteUser() would erase the person's
-- identity everywhere, not just in Loro. The delete route therefore needs an
-- AUTHORITATIVE answer to "who references auth.users?" — the earlier
-- incidental sighting (orders, coldcall_leads via triggers) is not a list to
-- build a guard on. Both functions enumerate live from pg_constraint on
-- every call, so a new product adding a table tomorrow is picked up without
-- any code change.
--
-- Both are SECURITY DEFINER, service-role only. loro_auth_fk_report returns
-- shape + total row counts (no row data). loro_foreign_user_rows(uid)
-- returns per-table row counts for ONE user id — counts only, no content.
--
-- Delete these once Loro moves to its own Supabase project.

-- Every FK in the database whose referenced table is auth.users, unscoped
-- across all schemas, with the table's total row count. Run via RPC to
-- answer "what would a user deletion touch?" authoritatively.
create or replace function public.loro_auth_fk_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  fk record;
  cnt bigint;
  result jsonb := '[]'::jsonb;
begin
  for fk in
    select ns.nspname as schema_name,
           rel.relname as table_name,
           con.conname as constraint_name,
           pg_get_constraintdef(con.oid) as def,
           (select array_agg(att.attname order by ord.n)
              from unnest(con.conkey) with ordinality as ord(attnum, n)
              join pg_attribute att
                on att.attrelid = con.conrelid and att.attnum = ord.attnum
           ) as cols
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
    order by ns.nspname, rel.relname, con.conname
  loop
    execute format('select count(*) from %I.%I', fk.schema_name, fk.table_name)
      into cnt;
    result := result || jsonb_build_object(
      'schema', fk.schema_name,
      'table', fk.table_name,
      'constraint', fk.constraint_name,
      'columns', to_jsonb(fk.cols),
      'def', fk.def,
      'row_count', cnt
    );
  end loop;
  return result;
end;
$$;

revoke all on function public.loro_auth_fk_report() from public, anon, authenticated;
grant execute on function public.loro_auth_fk_report() to service_role;

-- Row counts for ONE user across every NON-LORO table with an FK to
-- auth.users, excluding Supabase's own machinery:
--
--   * schema 'auth'    — identities, sessions, refresh tokens, MFA factors:
--                        the user's login plumbing. Always non-zero for a
--                        live user and deleted BY auth.admin.deleteUser()
--                        itself; counting it would make the guard refuse
--                        every deletion.
--   * schema 'storage' — storage.objects.owner. Handled explicitly by the
--                        route (Loro buckets are emptied before this runs),
--                        and other products' buckets surface through their
--                        product tables, not through raw object ownership.
--
-- Multi-column FKs: only the column(s) actually pointing at auth.users(id)
-- are matched; in practice every such FK here is single-column.
create or replace function public.loro_foreign_user_rows(uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  fk record;
  cnt bigint;
  result jsonb := '{}'::jsonb;
begin
  for fk in
    select distinct ns.nspname as schema_name,
           rel.relname as table_name,
           att.attname as column_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join unnest(con.conkey) with ordinality as ord(attnum, n)
      on true
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = ord.attnum
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and ns.nspname not in ('auth', 'storage')
      and rel.relname not like 'loro\_%'
  loop
    execute format(
      'select count(*) from %I.%I where %I = $1',
      fk.schema_name, fk.table_name, fk.column_name
    ) using uid into cnt;
    result := result || jsonb_build_object(
      format('%s.%s', fk.schema_name, fk.table_name), cnt
    );
  end loop;
  return result;
end;
$$;

revoke all on function public.loro_foreign_user_rows(uuid) from public, anon, authenticated;
grant execute on function public.loro_foreign_user_rows(uuid) to service_role;
