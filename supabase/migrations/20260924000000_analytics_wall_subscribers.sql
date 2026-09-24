-- ============================================================================
-- Two more admin-only analytics functions, for the /analyticsforradek page
-- (2026-09-24). Apply in the Supabase SQL editor like every migration here.
--
--   loro_analytics_wall         the paywall funnel for an ARBITRARY window,
--                               as distinct installs — so the page can put
--                               "the 14 days before the monthly trial" beside
--                               "the 14 days after" and read the sheet-cancel
--                               rate off both.
--   loro_analytics_subscribers  one row per purchase_completed, with what the
--                               install did AFTER it: days active, videos,
--                               words, reviews, last seen. The trial cohort.
--
-- Both follow loro_analytics_paywall: security definer, admin gate first,
-- production builds unless p_all_builds. Installs are keyed on install_id;
-- an install that fired the event twice counts once.
-- ============================================================================

create or replace function public.loro_analytics_wall(
  p_from timestamptz,
  p_to timestamptz,
  p_all_builds boolean default false
)
returns table (
  saw_wall  bigint,  -- distinct installs with paywall_shown in the window
  tapped    bigint,  -- ...that also fired purchase_started in the window
  cancelled bigint,  -- ...purchase_cancelled (backed out on Apple's sheet)
  failed    bigint,  -- ...purchase_failed
  completed bigint,  -- ...purchase_completed (a trial start or a purchase)
  installs  bigint   -- app_install in the window, for the top of the funnel
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_wall: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.install_id, e.name
      from loro_analytics_events e
     where (p_all_builds or e.build_profile = 'production')
       and e.at >= p_from and e.at < p_to
  )
  select
    (select count(distinct install_id) from scoped where name = 'paywall_shown'),
    (select count(distinct install_id) from scoped where name = 'purchase_started'),
    (select count(distinct install_id) from scoped where name = 'purchase_cancelled'),
    (select count(distinct install_id) from scoped where name = 'purchase_failed'),
    (select count(distinct install_id) from scoped where name = 'purchase_completed'),
    (select count(distinct install_id) from scoped where name = 'app_install');
end;
$$;

grant execute on function public.loro_analytics_wall(timestamptz, timestamptz, boolean) to authenticated;

create or replace function public.loro_analytics_subscribers(
  p_all_builds boolean default false
)
returns table (
  install_id        uuid,
  bought_at         timestamptz,
  package_type      text,     -- props.packageType: ANNUAL, MONTHLY, …
  trial             text,     -- props.trial: '1-week' or null for a straight purchase
  app_version       text,
  mins_before       numeric,  -- minutes from the install's first event to the purchase
  days_active_after bigint,   -- distinct calendar days with any event after buying
  last_seen_days    numeric,  -- days from purchase to the install's last event
  videos_after      bigint,   -- video_watched after buying
  saved_after       bigint,   -- word_saved after buying
  reviews_after     bigint,   -- review_started after buying
  answers_after     bigint    -- blank_answered after buying
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_subscribers: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.*
      from loro_analytics_events e
     where (p_all_builds or e.build_profile = 'production')
  ),
  buys as (
    select s.install_id, min(s.at) as bought_at
      from scoped s
     where s.name = 'purchase_completed'
     group by s.install_id
  ),
  buy_event as (
    select b.install_id, b.bought_at, s.props, s.app_version
      from buys b
      join scoped s
        on s.install_id = b.install_id and s.name = 'purchase_completed' and s.at = b.bought_at
  ),
  after_buy as (
    select b.install_id,
           count(distinct date_trunc('day', s.at))                        as days_active_after,
           max(s.at)                                                       as last_at,
           count(*) filter (where s.name = 'video_watched')                as videos_after,
           count(*) filter (where s.name = 'word_saved')                   as saved_after,
           count(*) filter (where s.name = 'review_started')               as reviews_after,
           count(*) filter (where s.name = 'blank_answered')               as answers_after
      from buys b
      left join scoped s on s.install_id = b.install_id and s.at > b.bought_at
     group by b.install_id
  ),
  before_buy as (
    select b.install_id, min(s.at) as first_at
      from buys b
      join scoped s on s.install_id = b.install_id
     group by b.install_id
  )
  select
    be.install_id,
    be.bought_at,
    be.props ->> 'packageType',
    be.props ->> 'trial',
    be.app_version,
    round(extract(epoch from (be.bought_at - bf.first_at)) / 60, 1),
    coalesce(a.days_active_after, 0),
    case when a.last_at is null then 0::numeric
         else round(extract(epoch from (a.last_at - be.bought_at)) / 86400, 1) end,
    coalesce(a.videos_after, 0),
    coalesce(a.saved_after, 0),
    coalesce(a.reviews_after, 0),
    coalesce(a.answers_after, 0)
  from buy_event be
  left join after_buy a using (install_id)
  left join before_buy bf using (install_id)
  order by be.bought_at desc;
end;
$$;

grant execute on function public.loro_analytics_subscribers(boolean) to authenticated;
