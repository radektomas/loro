-- ============================================================================
-- loro_analytics_first_run, made fast (2026-11-10, same day as
-- 20261110000000). Apply in the Supabase SQL editor; it replaces the
-- function in place (same arguments, same columns), nothing else changes.
--
-- WHY: the first version hit "canceling statement due to statement
-- timeout" on the dashboard. Its time-on-screen worked out "the next screen"
-- with a correlated subquery over every screen visit for every screen visit
-- (quadratic), it read the whole events table for every CTE, and the
-- dashboard calls it three times at once (7, 14, 30 days).
--
-- NOW: the events are cut to the window and to the eight event names before
-- anything else (received_at and name are indexed); the next screen is a
-- lead() window over each install's screens in order, one pass.
--
-- Same cohort as before: installs whose FIRST onboarding screen ('hook')
-- arrived in [p_from, p_to). An install that started before p_from and
-- went back to the first screen inside the window is left out, as before.
-- ============================================================================

create or replace function public.loro_analytics_first_run(
  p_from timestamptz,
  p_to timestamptz default now(),
  p_all_builds boolean default false
)
returns table (
  app_version text,
  step        text,
  step_order  integer,
  installs    bigint,
  median_secs numeric
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_first_run: admin only' using errcode = '42501';
  end if;

  return query
  with ev as materialized (
    select e.install_id, e.name, e.props, e.at, e.received_at, e.app_version
      from loro_analytics_events e
     where e.received_at >= p_from
       and e.name in ('onboarding_step', 'paywall_shown', 'purchase_started', 'purchase_cancelled',
                      'exit_offer_shown', 'purchase_completed', 'paywall_feedback')
       and (p_all_builds or coalesce(e.build_profile, 'production') = 'production')
  ),
  cohort as materialized (
    select h.install_id,
           (array_agg(h.app_version order by h.at))[1] as version
      from ev h
     where h.name = 'onboarding_step' and h.props->>'step' = 'hook'
     group by h.install_id
    having min(h.received_at) < p_to
       and not exists (
             select 1
               from loro_analytics_events x
              where x.install_id = h.install_id
                and x.name = 'onboarding_step'
                and x.received_at < p_from
           )
  ),
  screens as (
    select s.install_id,
           s.props->>'step' as step,
           min((s.props->>'index')::int) as idx,
           min(s.at) as at
      from ev s
      join cohort c using (install_id)
     where s.name = 'onboarding_step'
       and s.props ? 'step'
       and jsonb_typeof(s.props->'index') = 'number'
     group by s.install_id, s.props->>'step'
  ),
  wall as (
    select w.install_id,
           w.name as step,
           case w.name
             when 'paywall_shown'      then 100
             when 'purchase_started'   then 101
             when 'purchase_cancelled' then 102
             when 'exit_offer_shown'   then 103
             when 'purchase_completed' then 104
             when 'paywall_feedback'   then 105
           end as idx,
           min(w.at) as at
      from ev w
      join cohort c using (install_id)
     where w.name <> 'onboarding_step'
     group by w.install_id, w.name
  ),
  dwell as (
    select s.install_id, s.step, s.idx,
           extract(epoch from (
             least(lead(s.at) over (partition by s.install_id order by s.idx), p.at) - s.at
           )) as secs
      from screens s
      left join wall p on p.install_id = s.install_id and p.step = 'paywall_shown'
     union all
    select w.install_id, w.step, w.idx, null::numeric
      from wall w
  )
  select c.version,
         d.step,
         d.idx,
         count(distinct d.install_id),
         (percentile_cont(0.5) within group (order by d.secs)
            filter (where d.secs >= 0 and d.secs <= 1800))::numeric
    from dwell d
    join cohort c using (install_id)
   group by grouping sets ((c.version, d.step, d.idx), (d.step, d.idx))
   order by c.version nulls first, d.idx;
end;
$$;

grant execute on function public.loro_analytics_first_run(timestamptz, timestamptz, boolean) to authenticated;

-- Self-test with a stopwatch: runs the 30-day report (the biggest the
-- dashboard asks for) as an admin and says how long it took. The dashboard's
-- limit is a few seconds; this should print well under one.
do $$
declare
  admin_id uuid;
  started timestamptz;
  n int;
begin
  select user_id into admin_id from public.loro_admins limit 1;
  if admin_id is null then
    raise notice 'first_run self-test SKIPPED: loro_admins is empty';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  started := clock_timestamp();
  select count(*) into n from public.loro_analytics_first_run(now() - interval '30 days', now(), false);
  raise notice 'first_run self-test PASSED: % rows in % ms', n,
    round(extract(epoch from clock_timestamp() - started) * 1000);
exception
  when insufficient_privilege then
    raise notice 'first_run self-test SKIPPED: could not assume an admin identity here';
end $$;
