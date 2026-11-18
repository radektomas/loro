-- ============================================================================
-- "How's Loro so far?" answers, for /analyticsforradek (2026-11-18).
-- Apply in the Supabase SQL editor like every migration here.
--
-- The app asks once per install on the first day, after the 4th video
-- (apps/mobile/src/feedback/feedbackBus.ts), and the Progress tab's
-- "Send feedback" row opens the same card any time. Each answer is a
-- feedback_given event: props.from (day0 | progress), props.mood
-- (meh | ok | love | skipped), props.text (optional, <= 500 chars),
-- props.videos (videos reached that day).
--
-- Same shape as loro_analytics_paywall_feedback: security definer, admin
-- gate first, newest first. Store traffic is build_profile 'production' OR
-- null (null = binaries not built on EAS, see the analytics memory), so the
-- filter EXCLUDES the dev profiles instead of requiring 'production'.
-- ============================================================================

create or replace function public.loro_analytics_app_feedback(
  p_all_builds boolean default false
)
returns table (
  answered_at timestamptz,
  install_id  uuid,
  source      text,
  mood        text,
  note        text,
  videos      integer,
  app_version text
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_app_feedback: admin only' using errcode = '42501';
  end if;

  return query
  select e.received_at,
         e.install_id,
         coalesce(e.props->>'from', '?'),
         coalesce(e.props->>'mood', '?'),
         e.props->>'text',
         case when (e.props->>'videos') ~ '^\d+$' then (e.props->>'videos')::integer else null end,
         e.app_version
    from loro_analytics_events e
   where e.name = 'feedback_given'
     and (p_all_builds or coalesce(e.build_profile, 'production') not in ('development', 'preview'))
   order by e.received_at desc
   limit 500;
end;
$$;

grant execute on function public.loro_analytics_app_feedback(boolean) to authenticated;
