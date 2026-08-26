-- Fix: loro_analytics_overview returned a column type it did not declare, and
-- add a self-test so the other six cannot fail the same way unnoticed.
--
-- THE BUG. The function declares `median_videos numeric`, but the expression
-- producing it is
--
--     percentile_cont(0.5) within group (order by p.videos)
--
-- and percentile_cont has no numeric form: its ordered-set input is coerced to
-- double precision and the result comes back double precision. Postgres does
-- not coerce a RETURNS TABLE column on the way out, so the whole call failed at
-- RUNTIME with "structure of query does not match function result type" — not
-- at CREATE time, because plpgsql only syntax-checks a body at creation and
-- resolves types on first execution. That is why the migration applied
-- cleanly and the dashboard still broke.
--
-- Fixed by casting rather than by re-declaring the column double precision:
-- the value is a count of videos, and a float median of small integers invites
-- 4.999999999999999 in a UI. numeric is the honest type; only the coercion was
-- missing. The signature is unchanged, so `create or replace` is legal here
-- (it could not change the return type).

create or replace function public.loro_analytics_overview(
  p_days int default 30,
  p_all_builds boolean default false
)
returns table (
  installs         bigint,  -- first ever seen in this window
  active_installs  bigint,  -- any event in this window
  paywall_views    bigint,
  purchases        bigint,
  subscribers      bigint,  -- distinct installs that bought or restored
  videos_watched   bigint,
  median_videos    numeric  -- per install that watched at least one
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_overview: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.*
      from loro_analytics_events e
     where (p_all_builds or e.build_profile = 'production')
  ),
  births as (
    select s.install_id, min(s.received_at) as first_seen
      from scoped s
     group by s.install_id
  ),
  window_events as (
    select * from scoped where received_at >= since
  ),
  per_install_videos as (
    select w.install_id, count(*) as videos
      from window_events w
     where w.name = 'video_watched'
     group by w.install_id
  )
  select
    (select count(*) from births b where b.first_seen >= since),
    (select count(distinct w.install_id) from window_events w),
    (select count(*) from window_events w where w.name = 'paywall_shown'),
    (select count(*) from window_events w where w.name = 'purchase_completed'),
    (select count(distinct w.install_id) from window_events w
      where w.name in ('purchase_completed', 'restore_succeeded')),
    (select count(*) from window_events w where w.name = 'video_watched'),
    -- THE FIX. Null stays null (nobody has watched anything), which the client
    -- renders as "—" rather than as a measured median of zero.
    (select percentile_cont(0.5) within group (order by p.videos)
       from per_install_videos p)::numeric;
end;
$$;

grant execute on function public.loro_analytics_overview(int, boolean) to authenticated;

-- ---------------------------------------------------------------- self-test
--
-- Applying this migration EXECUTES all seven reports, so a result-type
-- mismatch in any of them fails here — loudly, with the function named —
-- instead of surfacing later as a broken dashboard. This is worth a block of
-- SQL precisely because CREATE cannot catch this class of error.
--
-- The reports refuse a non-admin, and a migration runs as `postgres` with no
-- JWT, so auth.uid() is null and every call would refuse. The block therefore
-- borrows a real admin id for the duration: request.jwt.claims is what
-- Supabase's auth.uid() reads, and set_config(..., true) scopes the borrowed
-- claim to this transaction. Nothing is granted elsewhere and nothing persists.
--
-- Read-only throughout: every function is `stable` and the results are
-- discarded.
do $$
declare
  admin_id uuid;
begin
  select user_id into admin_id from public.loro_admins limit 1;
  if admin_id is null then
    raise notice 'analytics self-test SKIPPED: loro_admins is empty';
    return;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );

  perform * from public.loro_analytics_overview(30, true);
  perform * from public.loro_analytics_funnel(30, true);
  perform * from public.loro_analytics_onboarding(30, true);
  perform * from public.loro_analytics_paywall(30, true);
  perform * from public.loro_analytics_watch(30, true);
  perform * from public.loro_analytics_daily(30, true);
  perform * from public.loro_analytics_recent(5);

  raise notice 'analytics self-test PASSED: all seven reports executed';
exception
  when insufficient_privilege then
    -- The borrowed claim did not take (a client that runs statements outside a
    -- transaction). Not a failure of the reports, so do not fail the migration
    -- over it — but say so, because it means nothing was actually verified.
    raise notice 'analytics self-test SKIPPED: could not assume an admin identity here';
end $$;
