-- Product analytics: the mobile funnel, as events.
--
-- WHY A TABLE AND NOT ANOTHER jsonb COLUMN. The two existing telemetry logs
-- (loro_profiles.starter_deck_events, .paywall_events) are jsonb arrays on the
-- profile row, and that was right for them: bounded payloads, one onboarding
-- run each, written at sign-in. Neither property holds here.
--
--   * THE SUBJECT IS AN INSTALL, NOT A PROFILE. The iOS app is a hard paywall
--     that anyone can buy through anonymously (RevenueCat anonymous id), and
--     sign-in is optional forever. Most paying installs therefore have NO
--     auth.users row and NO loro_profiles row to hang a column on. A funnel
--     keyed on profiles would measure only the minority who signed in — the
--     exact opposite of the population the paywall question is about.
--   * THE PAYLOAD IS UNBOUNDED. video_watched fires once per video that takes
--     the screen, forever. That is a growing log, not a bounded array, and it
--     belongs in rows.
--
-- IDENTITY: install_id, A PSEUDONYM WE MINT. A random uuid written once to
-- MMKV under the `loro.` prefix (see apps/mobile/src/platform/analytics.ts),
-- so it is swept by account deletion and by the switch-user wipe exactly like
-- every other local key. It is NOT the IDFA, NOT the vendor id, and survives
-- nothing: delete the app and the next install is a new person as far as this
-- table is concerned. That is an accepted undercount of retention, and it is
-- the reason no device identifier is read.
--
-- user_id is ON DELETE SET NULL, deliberately mirroring the shared project's
-- own analytics_events (see app/api/_lib/accountDeletion.ts, which documents
-- that table as non-blocking BECAUSE its FK self-anonymizes). Loro's deletion
-- path treats this table the same way: the rows lose the person and stay as
-- counts. Deleting them instead would silently rewrite history every time
-- someone leaves, which is how a funnel starts lying.
--
-- TWO CLOCKS, AND ONLY ONE IS TRUSTED. `at` is the device's clock, kept
-- because it is the only thing that orders events within an offline batch;
-- `received_at` is the server's and is what every report below groups by. A
-- phone with a wrong date must not be able to move a purchase into last week.
--
-- RLS: INSERT ONLY, FOR EVERYONE, READ FOR NO ONE. The client holds the anon
-- key, so it can only ever append. Nothing — not even a signed-in admin —
-- gets a select policy; reads go exclusively through the SECURITY DEFINER
-- report functions at the bottom, each of which refuses a non-admin. That
-- keeps the raw log (which is a behavioural profile of an install) out of
-- reach of the browser bundle entirely, and means this needs no service-role
-- key: the dashboard runs on the same anon key the app already ships, gated
-- by the loro_admins allowlist that /admin/creators already uses.
--
-- Idempotent: replaying yields the same end state.

create table if not exists public.loro_analytics_events (
  -- Client-generated, so a retried batch collides instead of duplicating.
  -- The client inserts with ignoreDuplicates (ON CONFLICT DO NOTHING), which
  -- is why an at-least-once delivery does not inflate every count.
  id            uuid primary key,
  install_id    uuid not null,
  -- One app launch. Lets "left the paywall" be answered without a heartbeat:
  -- a session containing paywall_shown and no purchase_* is a bounce.
  session_id    uuid not null,
  -- Present only while signed in; nulled, not deleted, when the account goes.
  user_id       uuid references auth.users (id) on delete set null,
  name          text not null check (name <> '' and length(name) <= 64),
  -- Event-specific detail. Capped so a buggy client cannot write a blob.
  props         jsonb not null default '{}'::jsonb
                check (jsonb_typeof(props) = 'object'
                       and length(props::text) <= 2000),
  at            timestamptz not null,
  received_at   timestamptz not null default now(),
  platform      text not null default 'ios'
                check (platform in ('ios', 'android', 'web')),
  app_version   text,
  -- 'development' | 'preview' | 'production' | null. Every report below
  -- filters to production so a simulator run cannot move the numbers.
  build_profile text
);

-- The three access patterns: one install's story, a date-ranged scan, and
-- "who did X in the window".
create index if not exists loro_analytics_events_install_idx
  on public.loro_analytics_events (install_id, received_at);
create index if not exists loro_analytics_events_received_idx
  on public.loro_analytics_events (received_at desc);
create index if not exists loro_analytics_events_name_idx
  on public.loro_analytics_events (name, received_at desc);

alter table public.loro_analytics_events enable row level security;

-- Append-only, for anon and authenticated alike: the app writes these before
-- anyone has signed in (onboarding and the paywall both precede sign-in, and
-- for most installs sign-in never happens at all).
--
-- The check is the whole guard: a client may stamp its own user_id or none,
-- and nothing else. Without it any holder of the anon key could attribute
-- events to a stranger's account. install_id is unverifiable by construction
-- — it is a client-minted pseudonym — so this table's threat model is
-- "append junk", not "read or rewrite"; there is no read policy to abuse and
-- no update or delete policy at all.
drop policy if exists "analytics - append only" on public.loro_analytics_events;
create policy "analytics - append only" on public.loro_analytics_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

comment on table public.loro_analytics_events is
  'Mobile product-funnel events, keyed on a client-minted install pseudonym. Append-only via RLS; readable only through the loro_analytics_* SECURITY DEFINER reports, which require loro_is_admin(). Group by received_at, never at.';

-- ------------------------------------------------------------------ reports
--
-- Seven functions, all SECURITY DEFINER and all refusing a non-admin on their
-- first statement. SECURITY DEFINER is what lets them read a table with no
-- select policy; loro_is_admin() (migration 20260718000000, the same gate
-- /admin/creators uses) is what stops that being a hole. Execute is granted to
-- `authenticated` only — an admin has to be signed in, and `anon` cannot even
-- attempt the call.
--
-- TWO DIFFERENT WINDOW SEMANTICS, and mixing them up is the classic way to
-- read a funnel wrong, so each function says which it uses:
--
--   COHORT   (funnel, onboarding, paywall, watch): the population is installs
--            whose FIRST EVENT falls in the window, and their whole history
--            counts however late it happened. This is the one that answers
--            "of the people who arrived, how many paid" — an install that
--            arrived yesterday and subscribes tomorrow is a conversion for
--            yesterday's cohort, which is why the last few days of any funnel
--            are still filling in.
--   ACTIVITY (overview, daily): events are counted where they LANDED,
--            regardless of when their install first appeared.
--
-- p_all_builds exists for the first week: leave it false and only production
-- binaries count, flip it true to prove your own simulator run is landing.

-- Headline numbers for the window. ACTIVITY semantics — see above.
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
  -- Computed over ALL history, then filtered: an install's birthday is its
  -- first event ever, not its first event inside the window.
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
    (select percentile_cont(0.5) within group (order by p.videos)
       from per_install_videos p);
end;
$$;

-- The funnel, install by install. COHORT semantics.
--
-- Every stage is a distinct-install count, and the stages are cumulative by
-- construction (bool_or over the install's whole history), so the sequence can
-- only ever descend — a stage that reads higher than the one above it means an
-- instrumentation bug, not a surprising user.
create or replace function public.loro_analytics_funnel(
  p_days int default 30,
  p_all_builds boolean default false
)
returns table (stage text, stage_order int, installs bigint)
language plpgsql stable security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_funnel: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.*
      from loro_analytics_events e
     where (p_all_builds or e.build_profile = 'production')
  ),
  cohort as (
    select s.install_id
      from scoped s
     group by s.install_id
    having min(s.received_at) >= since
  ),
  reached as (
    select
      c.install_id,
      bool_or(s.name = 'onboarding_step')                        as started,
      bool_or(s.name = 'onboarding_completed')                   as onboarded,
      bool_or(s.name = 'paywall_shown')                          as saw_wall,
      bool_or(s.name = 'purchase_started')                       as tried,
      bool_or(s.name in ('purchase_completed', 'restore_succeeded')) as subscribed,
      bool_or(s.name = 'video_watched')                          as watched
      from cohort c
      join scoped s using (install_id)
     group by c.install_id
  )
  select v.stage, v.stage_order, v.installs
    from (
      values
        ('Installed',           1, (select count(*) from reached)),
        ('Started onboarding',  2, (select count(*) from reached where started)),
        ('Finished onboarding', 3, (select count(*) from reached where onboarded)),
        ('Saw the paywall',     4, (select count(*) from reached where saw_wall)),
        ('Tapped subscribe',    5, (select count(*) from reached where tried)),
        ('Subscribed',          6, (select count(*) from reached where subscribed)),
        ('Watched a video',     7, (select count(*) from reached where watched))
    ) as v(stage, stage_order, installs)
   order by v.stage_order;
end;
$$;

-- Onboarding drop-off, screen by screen. COHORT semantics.
--
-- step_order is min(props->>'index'), and that is only stable because the
-- client sends the index into the CANONICAL step list rather than into the
-- visible one — answering "starting from zero" removes three screens, so a
-- visible-list index would place the same screen differently for different
-- users and scramble the ordering here.
--
-- `stopped_here` counts installs whose furthest screen was this one AND which
-- never finished, i.e. the people this screen lost. It excludes anyone still
-- mid-onboarding? No — it cannot: a first launch abandoned two minutes ago is
-- indistinguishable from one abandoned for good. Read the last day with that
-- in mind.
create or replace function public.loro_analytics_onboarding(
  p_days int default 30,
  p_all_builds boolean default false
)
returns table (step text, step_order int, reached bigint, stopped_here bigint)
language plpgsql stable security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_onboarding: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.*
      from loro_analytics_events e
     where (p_all_builds or e.build_profile = 'production')
  ),
  cohort as (
    select s.install_id
      from scoped s
     group by s.install_id
    having min(s.received_at) >= since
  ),
  steps as (
    select
      s.install_id,
      s.props ->> 'step'              as step,
      (s.props ->> 'index')::int      as idx
      from cohort c
      join scoped s using (install_id)
     where s.name = 'onboarding_step'
       and s.props ? 'step'
       and jsonb_typeof(s.props -> 'index') = 'number'
  ),
  finished as (
    select distinct s.install_id
      from cohort c
      join scoped s using (install_id)
     where s.name = 'onboarding_completed'
  ),
  furthest as (
    select st.install_id, max(st.idx) as idx
      from steps st
     where st.install_id not in (select install_id from finished)
     group by st.install_id
  ),
  ordering as (
    select st.step, min(st.idx) as step_order, count(distinct st.install_id) as reached
      from steps st
     group by st.step
  )
  select
    o.step,
    o.step_order,
    o.reached,
    coalesce((
      select count(*)
        from furthest f
       where f.idx = o.step_order
    ), 0)
    from ordering o
   order by o.step_order;
end;
$$;

-- What happened to the people who reached the wall. COHORT semantics.
--
-- Mutually exclusive by construction, most-committed wins, so the four rows
-- sum to the "Saw the paywall" stage of the funnel:
--   subscribed        bought outright
--   restored          arrived already entitled (reinstall, second device)
--   tried_and_failed  tapped subscribe and did not finish — cancelled the
--                     Apple sheet, or the purchase errored. This is the row
--                     to watch: it is intent that the checkout lost.
--   left              saw the wall, never tapped subscribe. The "went away".
create or replace function public.loro_analytics_paywall(
  p_days int default 30,
  p_all_builds boolean default false
)
returns table (outcome text, outcome_order int, installs bigint)
language plpgsql stable security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_paywall: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.*
      from loro_analytics_events e
     where (p_all_builds or e.build_profile = 'production')
  ),
  cohort as (
    select s.install_id
      from scoped s
     group by s.install_id
    having min(s.received_at) >= since
  ),
  wall as (
    select
      c.install_id,
      bool_or(s.name = 'paywall_shown')        as saw_wall,
      bool_or(s.name = 'purchase_completed')   as bought,
      bool_or(s.name = 'restore_succeeded')    as restored,
      bool_or(s.name = 'purchase_started')     as tried
      from cohort c
      join scoped s using (install_id)
     group by c.install_id
  ),
  classified as (
    select case
             when bought   then 'subscribed'
             when restored then 'restored'
             when tried    then 'tried_and_failed'
             else               'left'
           end as outcome
      from wall
     where saw_wall
  )
  select v.outcome, v.outcome_order, coalesce(n.installs, 0)
    from (values ('subscribed', 1), ('restored', 2),
                 ('tried_and_failed', 3), ('left', 4))
         as v(outcome, outcome_order)
    left join (
      select c.outcome, count(*) as installs from classified c group by c.outcome
    ) n on n.outcome = v.outcome
   order by v.outcome_order;
end;
$$;

-- How much of the app the people who got in actually used. COHORT semantics.
--
-- Bucketed rather than averaged on purpose: with a hard paywall the population
-- is small and one enthusiast moves a mean. The 0 bucket is the one that
-- matters — a subscriber who watched nothing is a refund waiting to happen.
create or replace function public.loro_analytics_watch(
  p_days int default 30,
  p_all_builds boolean default false
)
returns table (bucket text, bucket_order int, installs bigint)
language plpgsql stable security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_watch: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.*
      from loro_analytics_events e
     where (p_all_builds or e.build_profile = 'production')
  ),
  cohort as (
    select s.install_id
      from scoped s
     group by s.install_id
    having min(s.received_at) >= since
  ),
  -- Only installs that got past the wall: counting videos for people who
  -- never had access would put every non-payer in the 0 bucket and drown it.
  entitled as (
    select c.install_id
      from cohort c
      join scoped s using (install_id)
     where s.name in ('purchase_completed', 'restore_succeeded')
     group by c.install_id
  ),
  counts as (
    select
      e.install_id,
      count(s.id) filter (where s.name = 'video_watched') as videos
      from entitled e
      left join scoped s using (install_id)
     group by e.install_id
  ),
  binned as (
    select case
             when videos = 0          then 'none'
             when videos between 1 and 4   then '1-4'
             when videos between 5 and 19  then '5-19'
             when videos between 20 and 49 then '20-49'
             else                          '50+'
           end as bucket
      from counts
  )
  select v.bucket, v.bucket_order, coalesce(n.installs, 0)
    from (values ('none', 1), ('1-4', 2), ('5-19', 3), ('20-49', 4), ('50+', 5))
         as v(bucket, bucket_order)
    left join (
      select b.bucket, count(*) as installs from binned b group by b.bucket
    ) n on n.bucket = v.bucket
   order by v.bucket_order;
end;
$$;

-- Daily series for the window. ACTIVITY semantics, except new_installs, which
-- is a birthday count and therefore cohort-ish by nature.
--
-- generate_series supplies the spine so a day with no activity is a zero row
-- rather than a gap the chart would interpolate straight through.
create or replace function public.loro_analytics_daily(
  p_days int default 30,
  p_all_builds boolean default false
)
returns table (
  day            date,
  new_installs   bigint,
  paywall_views  bigint,
  purchases      bigint,
  videos_watched bigint
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_daily: admin only' using errcode = '42501';
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
  spine as (
    select generate_series(since::date, now()::date, interval '1 day')::date as day
  )
  select
    sp.day,
    coalesce((select count(*) from births b where b.first_seen::date = sp.day), 0),
    coalesce((select count(*) from scoped s
               where s.name = 'paywall_shown' and s.received_at::date = sp.day), 0),
    coalesce((select count(*) from scoped s
               where s.name = 'purchase_completed' and s.received_at::date = sp.day), 0),
    coalesce((select count(*) from scoped s
               where s.name = 'video_watched' and s.received_at::date = sp.day), 0)
    from spine sp
   order by sp.day;
end;
$$;

-- The raw tail, for proving instrumentation is live.
--
-- Deliberately unfiltered by build profile: the first thing you do after
-- shipping this is run a simulator build and check that its events arrive, and
-- a production-only view would show you nothing and look like a broken client.
create or replace function public.loro_analytics_recent(p_limit int default 50)
returns table (
  received_at   timestamptz,
  name          text,
  props         jsonb,
  install_id    uuid,
  session_id    uuid,
  signed_in     boolean,
  platform      text,
  app_version   text,
  build_profile text
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_recent: admin only' using errcode = '42501';
  end if;

  return query
  select e.received_at, e.name, e.props, e.install_id, e.session_id,
         e.user_id is not null, e.platform, e.app_version, e.build_profile
    from loro_analytics_events e
   order by e.received_at desc
   limit least(greatest(p_limit, 1), 500);
end;
$$;

grant execute on function public.loro_analytics_overview(int, boolean)   to authenticated;
grant execute on function public.loro_analytics_funnel(int, boolean)     to authenticated;
grant execute on function public.loro_analytics_onboarding(int, boolean) to authenticated;
grant execute on function public.loro_analytics_paywall(int, boolean)    to authenticated;
grant execute on function public.loro_analytics_watch(int, boolean)      to authenticated;
grant execute on function public.loro_analytics_daily(int, boolean)      to authenticated;
grant execute on function public.loro_analytics_recent(int)              to authenticated;
