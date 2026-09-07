-- The loop, by day: words saved, blanks answered, reviews started, days done.
--
-- WHY. Until mobile 1.3.0 the event log stopped at video_watched. It could
-- say who opened the app and how far they scrolled, and nothing about
-- whether they did the thing the app is for — so the retention question
-- ("do people who save a word and answer a blank come back?") had no data
-- behind it. 1.3.0 records the loop (apps/mobile/src/platform/analytics.ts:
-- word_saved, blank_answered, review_started, goal_met, tab_opened,
-- reminder_permission); this is the report that reads it.
--
-- ONE FUNCTION, DAILY ROWS. The dashboard sums a window for its headline
-- tiles and shows the days underneath, so a single shape serves both, and
-- generate_series supplies the spine so a silent day is a zero rather than
-- a gap. Same conventions as 20260830000000: received_at::date is the day,
-- null build_profile is the App Store binary and stays IN, and the admin
-- check is server-side.
--
-- THE PROPS ARE READ AS TEXT. props is jsonb and the client writes booleans
-- as JSON booleans, so `props->>'correct' = 'true'` is the exact comparison;
-- a missing prop is null and simply does not count. Builds before 1.3.0
-- never wrote these names, so every column is zero for them — not wrong,
-- just early.
--
-- Idempotent: replaying yields the same end state.

create or replace function public.loro_analytics_loop(
  p_days int default 14,
  p_all_builds boolean default false
)
returns table (
  day            date,
  active         bigint,  -- distinct installs with any event that day
  saved          bigint,  -- word_saved
  answered       bigint,  -- blank_answered, both kinds
  correct        bigint,  -- blank_answered graded right (near-misses included)
  reviews        bigint,  -- review_started, any door
  reviews_landed bigint,  -- ...that parked a landing on a due word
  reminder_taps  bigint,  -- review_started from the notification
  goals_met      bigint,  -- goal_met events
  goal_installs  bigint   -- distinct installs that finished a day
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_loop: admin only' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select e.install_id, e.name, e.props, e.received_at::date as d
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
  ),
  per_day as (
    select
      s.d,
      count(distinct s.install_id)                                   as active,
      count(*) filter (where s.name = 'word_saved')                  as saved,
      count(*) filter (where s.name = 'blank_answered')              as answered,
      count(*) filter (where s.name = 'blank_answered'
                         and s.props->>'correct' = 'true')           as correct,
      count(*) filter (where s.name = 'review_started')              as reviews,
      count(*) filter (where s.name = 'review_started'
                         and s.props->>'landed' = 'true')            as reviews_landed,
      count(*) filter (where s.name = 'review_started'
                         and s.props->>'source' = 'notification')    as reminder_taps,
      count(*) filter (where s.name = 'goal_met')                    as goals_met,
      count(distinct s.install_id) filter (where s.name = 'goal_met') as goal_installs
      from scoped s
     group by s.d
  )
  select
    sp.day,
    coalesce(p.active, 0),
    coalesce(p.saved, 0),
    coalesce(p.answered, 0),
    coalesce(p.correct, 0),
    coalesce(p.reviews, 0),
    coalesce(p.reviews_landed, 0),
    coalesce(p.reminder_taps, 0),
    coalesce(p.goals_met, 0),
    coalesce(p.goal_installs, 0)
    from spine sp
    left join per_day p on p.d = sp.day
   order by sp.day;
end;
$$;

grant execute on function public.loro_analytics_loop(int, boolean) to authenticated;

-- ---------------------------------------------------------------- self-test
--
-- Same pattern as 20260830000000, for the same reason: CREATE only
-- syntax-checks a plpgsql body, and a result-type mismatch surfaces on first
-- EXECUTION. Read-only; the borrowed admin identity does not persist.
do $$
declare
  admin_id uuid;
begin
  select user_id into admin_id from public.loro_admins limit 1;
  if admin_id is null then
    raise notice 'analytics loop self-test SKIPPED: loro_admins is empty';
    return;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );

  perform * from public.loro_analytics_loop(14, true);

  raise notice 'analytics loop self-test PASSED';
exception
  when insufficient_privilege then
    raise notice 'analytics loop self-test SKIPPED: could not assume an admin identity here';
end $$;
