-- ============================================================================
-- The paywall A/B test, second version: the WALL SHAPE (2026-10-13).
-- Apply in the Supabase SQL editor like every migration here.
--
-- From 1.9.3 there are two independent splits (apps/mobile/src/platform/
-- remoteFlags.ts), each logged once per install:
--   paywall_variant { variant: 'madrid' | 'hard' }   Madrid free first, or not
--   paywall_style   { style: 'multi' | 'single' }    the launch wall's shape:
--                   'multi'  = demo → value → price, three pages
--                   'single' = the one-page wall shipped through 1.9.2
-- The live test is madridPassPercent 0 / multiPagePercent 50: everyone gets
-- the hard wall, half of them in three pages.
--
-- Same one-row-per-install shape as loro_analytics_paywall_ab (20261012…),
-- plus `style` and the multi wall's own steps (demo seen, price page
-- reached). An install is in the report if it logged EITHER split. The
-- return type changes, so the function is dropped and recreated.
-- ============================================================================

drop function if exists public.loro_analytics_paywall_ab(boolean);

create or replace function public.loro_analytics_paywall_ab(
  p_all_builds boolean default false
)
returns table (
  install_id      uuid,
  variant         text,
  style           text,
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
  demo_seen       boolean,
  demo_ms         integer,
  reached_price   boolean,
  tapped_buy      integer,
  cancelled       integer,
  trial           boolean,
  restored        boolean,
  feedback        text,
  feedback_note   text,
  tour_done       boolean,
  tour_skipped_at text,
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
  with split as (
    select e.install_id,
           (array_agg(e.props->>'variant' order by e.at) filter (where e.name = 'paywall_variant'))[1] as variant,
           (array_agg(e.props->>'style' order by e.at) filter (where e.name = 'paywall_style'))[1] as style,
           min(e.at) as assigned_at
      from loro_analytics_events e
     where e.name in ('paywall_variant', 'paywall_style')
       and (p_all_builds or e.build_profile = 'production')
     group by e.install_id
  )
  select a.install_id,
         a.variant,
         a.style,
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
         bool_or(e.name = 'paywall_demo_shown'),
         (max((e.props->>'watchedMs')::numeric) filter (where e.name = 'paywall_demo_done'))::integer,
         bool_or(e.name = 'paywall_page' and e.props->>'page' = '3'),
         (count(*) filter (where e.name = 'purchase_started'))::integer,
         (count(*) filter (where e.name = 'purchase_cancelled'))::integer,
         bool_or(e.name = 'purchase_completed'),
         bool_or(e.name = 'restore_succeeded'),
         (array_agg(e.props->>'reason' order by e.at) filter (where e.name = 'paywall_feedback'))[1],
         (array_agg(e.props->>'text' order by e.at) filter (where e.name = 'paywall_feedback'))[1],
         bool_or(e.name = 'tour_step' and e.props->>'step' = 'done'),
         (array_agg(e.props->>'at' order by e.at) filter (where e.name = 'tour_skipped'))[1],
         (count(distinct (e.at at time zone 'Europe/Prague')::date))::integer,
         max(e.at)
    from split a
    join loro_analytics_events e on e.install_id = a.install_id
   group by a.install_id, a.variant, a.style, a.assigned_at
   order by a.assigned_at desc
   limit 5000;
end;
$$;

grant execute on function public.loro_analytics_paywall_ab(boolean) to authenticated;
