-- ============================================================================
-- The paywall A/B test, for /analyticsforradek (2026-10-12).
-- Apply in the Supabase SQL editor like every migration here.
--
-- From 1.9.2 every install is put in one arm the first time it is decided
-- (apps/mobile/src/platform/remoteFlags.ts) and logs it once:
--   paywall_variant { variant: 'madrid' | 'hard', percent, bucket }
--   'hard'   = the wall straight after onboarding
--   'madrid' = free until Madrid (5 words), then the wall
-- The split is the remote dial (scripts/set-paywall-flag.mts).
--
-- ONE ROW PER INSTALL IN THE TEST, with what it did: onboarding, blanks,
-- Madrid, the wall, the buy taps, the trial, the feedback answer, the days it
-- was active. The page does the per-arm sums, so the same rows feed both the
-- comparison and the "what each person did" list.
--
-- install_version is the app version of the install's own app_install
-- event: the page counts only installs born on 1.9.2+ by default, because an
-- older install is also given an arm on its first 1.9.2 launch and would
-- muddy the comparison.
--
-- Same shape as the other reports: security definer, admin gate first,
-- production builds unless p_all_builds.
-- ============================================================================

create or replace function public.loro_analytics_paywall_ab(
  p_all_builds boolean default false
)
returns table (
  install_id      uuid,
  variant         text,
  assigned_at     timestamptz,
  installed_at    timestamptz,
  install_version text,
  onboarded       boolean,
  skipped_onboarding boolean,
  blanks          integer,
  blanks_right    integer,
  words_saved     integer,
  reached_madrid  boolean,
  wall_views      integer,
  first_wall_at   timestamptz,
  wall_after      text,
  tapped_buy      integer,
  cancelled       integer,
  trial           boolean,
  restored        boolean,
  feedback        text,
  feedback_note   text,
  active_days     integer,
  last_seen       timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_paywall_ab: admin only' using errcode = '42501';
  end if;

  return query
  with arm as (
    select distinct on (e.install_id)
           e.install_id, e.props->>'variant' as variant, e.at as assigned_at
      from loro_analytics_events e
     where e.name = 'paywall_variant'
       and (p_all_builds or e.build_profile = 'production')
     order by e.install_id, e.at
  )
  select a.install_id,
         a.variant,
         a.assigned_at,
         min(e.at) filter (where e.name = 'app_install'),
         (array_agg(e.app_version order by e.at) filter (where e.name = 'app_install'))[1],
         bool_or(e.name = 'onboarding_completed'),
         bool_or(e.name = 'onboarding_completed' and (e.props->>'skipped')::boolean is true),
         (count(*) filter (where e.name = 'blank_answered'))::integer,
         (count(*) filter (where e.name = 'blank_answered' and (e.props->>'correct')::boolean is true))::integer,
         (count(*) filter (where e.name = 'word_saved'))::integer,
         bool_or(e.name in ('city_arrived', 'free_pass_ended')),
         (count(*) filter (where e.name = 'paywall_shown'))::integer,
         min(e.at) filter (where e.name = 'paywall_shown'),
         (array_agg(e.props->>'after' order by e.at) filter (where e.name = 'paywall_shown'))[1],
         (count(*) filter (where e.name = 'purchase_started'))::integer,
         (count(*) filter (where e.name = 'purchase_cancelled'))::integer,
         bool_or(e.name = 'purchase_completed'),
         bool_or(e.name = 'restore_succeeded'),
         (array_agg(e.props->>'reason' order by e.at) filter (where e.name = 'paywall_feedback'))[1],
         (array_agg(e.props->>'text' order by e.at) filter (where e.name = 'paywall_feedback'))[1],
         (count(distinct (e.at at time zone 'Europe/Prague')::date))::integer,
         max(e.at)
    from arm a
    join loro_analytics_events e on e.install_id = a.install_id
   group by a.install_id, a.variant, a.assigned_at
   order by a.assigned_at desc
   limit 5000;
end;
$$;

grant execute on function public.loro_analytics_paywall_ab(boolean) to authenticated;
