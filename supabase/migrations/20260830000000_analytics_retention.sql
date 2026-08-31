-- Per-user analytics: retention, scroll depth, and the roster behind them.
--
-- Three new SECURITY DEFINER reports for the rebuilt /admin/analytics, living
-- beside the seven from 20260826000000 rather than replacing them — those
-- still answer the funnel question and dropping them would strand any open
-- tab of the old dashboard mid-session.
--
-- THE UNIT IS AN INSTALL, DISPLAYED AS "USER". Same reasoning as the events
-- table itself: the paywall is bought through anonymously, sign-in is optional
-- forever, and most installs never get an auth.users row. Retention keyed on
-- profiles would measure only the signed-in minority. first_seen here is the
-- install's first event ever — for anonymous-first users that predates any
-- sign-up, which is exactly what "returned after first open" should measure.
--
-- NULL build_profile IS THE APP STORE BINARY. Measured on live data
-- 2026-08-30: 197 of 201 events carry build_profile = null at app_version
-- 1.1.0, and zero carry 'production' — the shipped binary was not built on an
-- EAS worker, so app.config.ts had no EAS_BUILD_PROFILE to thread through
-- `extra` and the client stamps null. The 20260826000000 reports filter
-- `build_profile = 'production'`, which therefore excludes essentially all
-- real traffic and renders the default dashboard as zeros. These functions
-- filter the other way round: EXCLUDE the profiles known to be non-production
-- ('development', 'preview'), include null. A binary that cannot say where it
-- came from is presumed to be the shipped one, because measurably it is.
--
-- RETENTION SEMANTICS, fixed here so every consumer agrees:
--   * Days are received_at::date (server clock, UTC). The table comment
--     already forbids grouping by `at`; a phone's wrong date must not move a
--     comeback.
--   * D-N means activity on EXACTLY first_day + N — a calendar-day bounce
--     check, not "within N days".
--   * A verdict needs the day to be over. Per install, d-N is true the moment
--     a comeback lands (even mid-day), false only once first_day + N has
--     fully elapsed without one, and NULL while the question is still open.
--     The rate cards divide only inside the fully-elapsed cohort, so a fresh
--     install can never drag D7 down before its D7 has happened.
--
-- Idempotent: replaying yields the same end state.

-- The roster: one row per install, newest activity first.
create or replace function public.loro_analytics_users(
  p_all_builds boolean default false,
  p_limit int default 500
)
returns table (
  install_id   uuid,
  signed_in    boolean,      -- ever attributed an event to an auth.users row
  first_seen   timestamptz,  -- first event ever, not first event in a window
  last_active  timestamptz,
  videos_total bigint,       -- video_watched, all recorded history
  videos_7d    bigint,       -- video_watched in the last 7 days
  d1           boolean,      -- null while the verdict is still open
  d3           boolean,
  d7           boolean,
  sub_status   text          -- 'subscribed' | 'restored' | 'none'
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_users: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.*
      from loro_analytics_events e
     where (p_all_builds
            or coalesce(e.build_profile, 'production')
               not in ('development', 'preview'))
  ),
  per_install as (
    select
      s.install_id                                            as iid,
      bool_or(s.user_id is not null)                          as signed_in,
      min(s.received_at)                                      as first_seen,
      max(s.received_at)                                      as last_active,
      count(*) filter (where s.name = 'video_watched')        as videos_total,
      count(*) filter (where s.name = 'video_watched'
                         and s.received_at >= now() - interval '7 days')
                                                              as videos_7d,
      bool_or(s.name = 'purchase_completed')                  as bought,
      bool_or(s.name = 'restore_succeeded')                   as restored,
      array_agg(distinct s.received_at::date)                 as active_days
      from scoped s
     group by s.install_id
  )
  select
    p.iid,
    p.signed_in,
    p.first_seen,
    p.last_active,
    p.videos_total,
    p.videos_7d,
    case when p.first_seen::date + 1 = any (p.active_days) then true
         when p.first_seen::date + 1 < current_date          then false
         else null end,
    case when p.first_seen::date + 3 = any (p.active_days) then true
         when p.first_seen::date + 3 < current_date          then false
         else null end,
    case when p.first_seen::date + 7 = any (p.active_days) then true
         when p.first_seen::date + 7 < current_date          then false
         else null end,
    case when p.bought   then 'subscribed'
         when p.restored then 'restored'
         else                 'none' end
    from per_install p
   order by p.last_active desc
   limit least(greatest(p_limit, 1), 2000);
end;
$$;

-- The headline row: retention rates with their cohort sizes, the 7-day scroll
-- median, and today's DAU.
create or replace function public.loro_analytics_retention(
  p_all_builds boolean default false
)
returns table (
  d1_returned bigint, d1_cohort bigint,
  d3_returned bigint, d3_cohort bigint,
  d7_returned bigint, d7_cohort bigint,
  -- Median video_watched count over installs ACTIVE in the last 7 days,
  -- zeros included: an active user who scrolled nothing is a fact about
  -- engagement, not a row to drop. Null only when nobody was active at all.
  median_videos_7d numeric,
  dau_today bigint
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_retention: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.*
      from loro_analytics_events e
     where (p_all_builds
            or coalesce(e.build_profile, 'production')
               not in ('development', 'preview'))
  ),
  per_install as (
    select
      s.install_id                            as iid,
      min(s.received_at)::date                as first_day,
      array_agg(distinct s.received_at::date) as active_days,
      count(*) filter (where s.name = 'video_watched'
                         and s.received_at >= now() - interval '7 days')
                                              as videos_7d,
      bool_or(s.received_at >= now() - interval '7 days') as active_7d
      from scoped s
     group by s.install_id
  )
  select
    -- Fully-elapsed cohorts only (first_day + N < today), so the youngest
    -- installs cannot be counted as churned before their day-N arrives.
    count(*) filter (where p.first_day + 1 < current_date
                       and p.first_day + 1 = any (p.active_days)),
    count(*) filter (where p.first_day + 1 < current_date),
    count(*) filter (where p.first_day + 3 < current_date
                       and p.first_day + 3 = any (p.active_days)),
    count(*) filter (where p.first_day + 3 < current_date),
    count(*) filter (where p.first_day + 7 < current_date
                       and p.first_day + 7 = any (p.active_days)),
    count(*) filter (where p.first_day + 7 < current_date),
    -- Cast because percentile_cont only speaks double precision and RETURN
    -- QUERY does not coerce on the way out — the exact runtime failure
    -- migration 20260826020000 exists to fix. Null stays null: nobody active
    -- is a different fact from actives who scrolled nothing.
    (select percentile_cont(0.5) within group (order by q.videos_7d)
       from per_install q where q.active_7d)::numeric,
    (select count(distinct s.install_id) from scoped s
      where s.received_at::date = current_date)
    from per_install p;
end;
$$;

-- Daily active installs for the sparkline. generate_series supplies the
-- spine so a silent day is a zero, not a gap the line would skate over.
create or replace function public.loro_analytics_dau(
  p_days int default 7,
  p_all_builds boolean default false
)
returns table (day date, dau bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_dau: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.install_id, e.received_at::date as d
      from loro_analytics_events e
     where (p_all_builds
            or coalesce(e.build_profile, 'production')
               not in ('development', 'preview'))
       and e.received_at >= (current_date - least(greatest(p_days, 1), 90) + 1)
  ),
  spine as (
    select generate_series(
             current_date - least(greatest(p_days, 1), 90) + 1,
             current_date,
             interval '1 day'
           )::date as day
  )
  select sp.day, coalesce(
           (select count(distinct s.install_id) from scoped s where s.d = sp.day),
           0)
    from spine sp
   order by sp.day;
end;
$$;

grant execute on function public.loro_analytics_users(boolean, int)  to authenticated;
grant execute on function public.loro_analytics_retention(boolean)   to authenticated;
grant execute on function public.loro_analytics_dau(int, boolean)    to authenticated;

-- ---------------------------------------------------------------- self-test
--
-- Same pattern as 20260826020000, for the same reason: CREATE only
-- syntax-checks a plpgsql body, and a result-type mismatch surfaces on first
-- EXECUTION. Running all three here fails the migration loudly, with the
-- function named, instead of surfacing later as a broken dashboard. The block
-- borrows a real admin id for the transaction because the reports refuse the
-- `postgres` role's null auth.uid(); nothing is granted elsewhere and nothing
-- persists. Read-only throughout: every function is `stable` and the results
-- are discarded.
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

  perform * from public.loro_analytics_users(true, 500);
  perform * from public.loro_analytics_retention(true);
  perform * from public.loro_analytics_dau(7, true);

  raise notice 'analytics self-test PASSED: all three reports executed';
exception
  when insufficient_privilege then
    -- The borrowed claim did not take (a client that runs statements outside a
    -- transaction). Not a failure of the reports, so do not fail the migration
    -- over it — but say so, because it means nothing was actually verified.
    raise notice 'analytics self-test SKIPPED: could not assume an admin identity here';
end $$;
