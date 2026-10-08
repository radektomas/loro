-- ============================================================================
-- "What's holding you back?" answers, for /analyticsforradek (2026-10-09).
-- Apply in the Supabase SQL editor like every migration here.
--
-- The app asks once per install, right after someone closes Apple's
-- purchase sheet (apps/mobile/src/paywall/PaywallFeedback.tsx), and records
-- a paywall_feedback event: props.reason (price | no_subscription |
-- not_sure | try_more | other | skipped), props.text for "Something else…",
-- props.packageId for the plan they had tapped.
--
-- Same shape as the other reports: security definer, admin gate first,
-- production builds unless p_all_builds. Newest first.
-- ============================================================================

create or replace function public.loro_analytics_paywall_feedback(
  p_all_builds boolean default false
)
returns table (
  answered_at timestamptz,
  reason      text,
  note        text,
  package_id  text,
  app_version text
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.loro_is_admin() then
    raise exception 'loro_analytics_paywall_feedback: admin only' using errcode = '42501';
  end if;

  return query
  select e.received_at,
         coalesce(e.props->>'reason', '?'),
         e.props->>'text',
         e.props->>'packageId',
         e.app_version
    from loro_analytics_events e
   where e.name = 'paywall_feedback'
     and (p_all_builds or e.build_profile = 'production')
   order by e.received_at desc
   limit 500;
end;
$$;

grant execute on function public.loro_analytics_paywall_feedback(boolean) to authenticated;
