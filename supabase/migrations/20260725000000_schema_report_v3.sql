-- Schema report v3 — adds the DDL-level detail needed to capture tables that
-- exist in production but in no migration file (loro_saved_words and
-- loro_profiles predate the migrations directory).
--
-- New keys, all scoped to loro_* objects and all still SHAPE ONLY (object
-- definitions, never row data):
--
--   'constraints'   pg_get_constraintdef() for every constraint on loro_*
--                   tables — this is where FK targets and ON DELETE behaviour
--                   become readable, which no earlier version reported.
--   'column_types'  name/type/nullable/default per loro_* table. v2's
--                   'columns' key lists names only, which can confirm a
--                   column exists but cannot reproduce it.
--   'indexes'       pg_indexes.indexdef for loro_* tables.
--   'policy_defs'   full pg_policies rows (roles, cmd, qual, with_check) for
--                   loro_* tables — v2 reports policy NAMES only, which can
--                   detect a missing policy but not author one.
--   'trigger_defs'  pg_get_triggerdef() for non-internal triggers on loro_*
--                   tables.
--   'function_defs' pg_get_functiondef() for public loro_* functions, so a
--                   captured trigger's function body can be reproduced.
--
-- The version bumps 2 -> 3 per the stated convention (bump on shape change).
-- check-schema.mts still requires only version 2 and reads only the v2 keys,
-- so it needs no change and keeps working against a database still running
-- v2. Only the capture tooling requires v3.
--
-- Everything below the version key up to 'constraints' is byte-identical to
-- 20260722010000_schema_report.sql.

create or replace function public.loro_schema_report()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'version', 3,
    'tables', (
      select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    ),
    'columns', (
      select coalesce(jsonb_object_agg(t.table_name, t.cols), '{}'::jsonb)
      from (
        select table_name, jsonb_agg(column_name order by column_name) as cols
        from information_schema.columns
        where table_schema = 'public'
        group by table_name
      ) t
    ),
    'policies', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'schema', schemaname,
          'table', tablename,
          'name', policyname
        )),
        '[]'::jsonb
      )
      from pg_policies
      where schemaname in ('public', 'storage')
    ),
    'buckets', (
      select coalesce(jsonb_agg(b.id order by b.id), '[]'::jsonb)
      from storage.buckets b
    ),
    'triggers', (
      select coalesce(
        jsonb_agg(jsonb_build_object('table', c.relname, 'name', tg.tgname)),
        '[]'::jsonb
      )
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not tg.tgisinternal
    ),
    'functions', (
      select coalesce(jsonb_agg(distinct p.proname), '[]'::jsonb)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    ),
    'grants', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'table', table_name,
          'column', column_name,
          'privilege', privilege_type,
          'grantee', grantee
        )),
        '[]'::jsonb
      )
      from information_schema.column_privileges
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE')
    ),
    -- ------------------------------------------------------------- v3 keys
    'constraints', (
      -- Complete constraint DDL: PK, unique, check, and — the reason this
      -- version exists — foreign keys with their ON DELETE clause, which is
      -- unreadable through PostgREST any other way.
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'table', rel.relname,
          'name', con.conname,
          'def', pg_get_constraintdef(con.oid)
        ) order by rel.relname, con.conname),
        '[]'::jsonb
      )
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public' and rel.relname like 'loro\_%'
    ),
    'column_types', (
      select coalesce(jsonb_object_agg(t.table_name, t.cols), '{}'::jsonb)
      from (
        select c.table_name,
               jsonb_agg(jsonb_build_object(
                 'name', c.column_name,
                 'type', c.data_type,
                 'udt', c.udt_name,
                 'nullable', c.is_nullable = 'YES',
                 'default', c.column_default,
                 'position', c.ordinal_position
               ) order by c.ordinal_position) as cols
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name like 'loro\_%'
        group by c.table_name
      ) t
    ),
    'indexes', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'table', tablename,
          'name', indexname,
          'def', indexdef
        ) order by tablename, indexname),
        '[]'::jsonb
      )
      from pg_indexes
      where schemaname = 'public' and tablename like 'loro\_%'
    ),
    'policy_defs', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'table', tablename,
          'name', policyname,
          'permissive', permissive,
          'roles', roles,
          'cmd', cmd,
          'qual', qual,
          'with_check', with_check
        ) order by tablename, policyname),
        '[]'::jsonb
      )
      from pg_policies
      where schemaname = 'public' and tablename like 'loro\_%'
    ),
    'trigger_defs', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'table', c.relname,
          'name', tg.tgname,
          'def', pg_get_triggerdef(tg.oid)
        ) order by c.relname, tg.tgname),
        '[]'::jsonb
      )
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and not tg.tgisinternal
        and c.relname like 'loro\_%'
    ),
    'function_defs', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'name', p.proname,
          'def', pg_get_functiondef(p.oid)
        ) order by p.proname),
        '[]'::jsonb
      )
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like 'loro\_%'
        and p.prokind = 'f'
    )
  );
$$;

revoke all on function public.loro_schema_report() from public, anon, authenticated;
grant execute on function public.loro_schema_report() to service_role;
