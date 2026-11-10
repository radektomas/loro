-- ============================================================================
-- The first run, screen by screen: onboarding → paywall → Apple's sheet
-- (2026-11-10), for the "First run" card on /analyticsforradek.
-- Apply in the Supabase SQL editor like every migration here.
--
-- COHORT: installs whose FIRST onboarding screen ('hook') was received in
-- [p_from, p_to). Each install is counted under the app version it started
-- onboarding on, so a change shipped in a new build can be read against the
-- build before it.
--
-- ROWS: one per (app_version, step), plus the same steps over ALL versions
-- (app_version null, from GROUPING SETS). Steps are every onboarding_step
-- the cohort reached, by its canonical index (Onboarding.tsx canonicalIndex),
-- then the wall's events in funnel order:
--   paywall_shown → purchase_started (tapped the button) → purchase_cancelled
--   (closed Apple's sheet) → exit_offer_shown → purchase_completed (a trial
--   start counts) → paywall_feedback
--
-- median_secs: on an onboarding screen, the median time from arriving on it
-- to arriving on the next screen (or the wall), from the device clock `at`,
-- which is fine for gaps inside one session. Gaps over 30 minutes are left
-- out: that is someone who left the app and came back, not reading time.
--
-- BUILDS: production OR a null build_profile (the 1.1.0-era App Store
-- binary sent null, see 20260826020000), unless p_all_builds. TestFlight
-- shares the production binary, so its installs are in here too.
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
  with scoped as (
    select e.install_id, e.name, e.props, e.at, e.received_at, e.app_version
      from loro_analytics_events e
     where p_all_builds or coalesce(e.build_profile, 'production') = 'production'
  ),
  cohort as (
    select s.install_id,
           (array_agg(s.app_version order by s.at))[1] as version
      from scoped s
     where s.name = 'onboarding_step' and s.props->>'step' = 'hook'
     group by s.install_id
    having min(s.received_at) >= p_from and min(s.received_at) < p_to
  ),
  arrivals as (
    select s.install_id,
           s.props->>'step' as step,
           min((s.props->>'index')::int) as idx,
           min(s.at) as at
      from scoped s
      join cohort c using (install_id)
     where s.name = 'onboarding_step'
       and s.props ? 'step'
       and jsonb_typeof(s.props->'index') = 'number'
     group by s.install_id, s.props->>'step'
  ),
  wall as (
    select s.install_id,
           s.name as step,
           case s.name
             when 'paywall_shown'      then 100
             when 'purchase_started'   then 101
             when 'purchase_cancelled' then 102
             when 'exit_offer_shown'   then 103
             when 'purchase_completed' then 104
             when 'paywall_feedback'   then 105
           end as idx,
           min(s.at) as at
      from scoped s
      join cohort c using (install_id)
     where s.name in ('paywall_shown', 'purchase_started', 'purchase_cancelled',
                      'exit_offer_shown', 'purchase_completed', 'paywall_feedback')
     group by s.install_id, s.name
  ),
  dwell as (
    select a.install_id, a.step, a.idx,
           extract(epoch from (
             least(
               (select min(b.at) from arrivals b where b.install_id = a.install_id and b.idx > a.idx),
               (select min(w.at) from wall w where w.install_id = a.install_id and w.step = 'paywall_shown')
             ) - a.at
           )) as secs
      from arrivals a
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

-- Self-test, as in 20260826020000: borrow an admin id for this transaction
-- and run the report once, so a type mismatch fails HERE with the function
-- named instead of on the dashboard.
do $$
declare
  admin_id uuid;
begin
  select user_id into admin_id from public.loro_admins limit 1;
  if admin_id is null then
    raise notice 'first_run self-test SKIPPED: loro_admins is empty';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform * from public.loro_analytics_first_run(now() - interval '30 days', now(), true);
  raise notice 'first_run self-test PASSED';
exception
  when insufficient_privilege then
    raise notice 'first_run self-test SKIPPED: could not assume an admin identity here';
end $$;
