-- Introspection for the schema drift check (`npm run check-schema`).
--
-- Three migrations were once found unapplied against production, one of which
-- had silently degraded a live feature for weeks (the public creator read
-- policy: every published video's creator join came back null, so the feed
-- showed "Loro creator" instead of a name). The check exists so that can
-- never go unnoticed again — this function is the part of it that has to live
-- in the database.
--
-- WHY A FUNCTION: PostgREST only exposes tables and views in the exposed
-- schema, so a client can never read pg_policies, pg_trigger or
-- information_schema.column_privileges directly. SECURITY DEFINER is what
-- lets it read the catalogs; the check script calls it over RPC.
--
-- It returns SCHEMA SHAPE ONLY — object names, never row data. Execute is
-- granted to service_role alone (the CLI scripts' key): the shape of the
-- schema, including which columns are write-granted, is a map of the attack
-- surface and there is no reason for a browser client to be able to read it.

create or replace function public.loro_schema_report()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    -- Bumped whenever the RETURN SHAPE changes. The checker refuses to run
    -- against an older version rather than misreading it: when this function
    -- gained the policy 'schema' key, a stale copy silently reported every
    -- policy in the database as missing. A drift checker that cries wolf is
    -- worse than none, so its own dependency is version-checked.
    'version', 2,
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
      -- Storage policies are included: buckets and their RLS are applied by
      -- hand exactly like the public schema, and a missing storage policy
      -- fails at upload time rather than at deploy time.
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
      -- tgisinternal excludes the triggers Postgres creates for foreign keys
      -- and constraints, which are not ours and would only add noise.
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
      -- column_privileges reports BOTH column-level grants and table-level
      -- grants expanded per column. That is precisely what catches an older
      -- migration being re-run and restoring a blanket grant: the counter
      -- columns would reappear here as writable.
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
    )
  );
$$;

revoke all on function public.loro_schema_report() from public, anon, authenticated;
grant execute on function public.loro_schema_report() to service_role;
