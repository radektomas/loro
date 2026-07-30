-- Monetization entitlement seam: the tier a profile is on, and how it got there.
--
-- Written BEFORE any code that reads these columns, deliberately: while the
-- paywall ships dark (lib/entitlements/config.ts PAYWALL_ENABLED = false) the
-- client's tier read is allowed to fail on an unmigrated database — the
-- effective limit is Infinity in that state, so a missing column degrades to
-- "everything is free", never to "everything is blocked". That safety only
-- holds if the column exists by the time the flag flips, which is what this
-- file is for.
--
-- THREE COLUMNS, not one:
--
--   tier             what the user is entitled to right now. Text with a
--                    check, matching the loro_profiles house style (level,
--                    self_level) rather than a Postgres enum — enum value
--                    changes need a migration and a lock, and a third tier is
--                    a plausible near-term product decision.
--   tier_granted_at  WHEN the current tier started. Needed for two different
--                    jobs: grandfathering (see below) and, later, billing
--                    reconciliation — a webhook that says "this user is on
--                    plus_annual" is only checkable against a local start
--                    date. Nullable because 'free' was never granted; it is
--                    the absence of a grant.
--   is_grandfathered PERSISTENT, not derived. A user who was already over the
--                    free limit when the paywall turned on keeps unlimited
--                    saves — and must keep them after deleting words, which a
--                    count-based rule would silently revoke. Storing the
--                    verdict is the whole point; see lib/entitlements/limit.ts
--                    shouldGrandfather and /api/entitlements/grandfather.
--
-- RLS: READ YOUR OWN, WRITE NOTHING. The existing "own profile - update"
-- policy is `for update using (auth.uid() = id)` with no column restriction,
-- so without the guard below any signed-in user could PATCH their own row to
-- tier = 'plus' with the anon key and the browser's own session. Postgres RLS
-- cannot express a column subset, and the column-privilege route
-- (revoke update, then grant update (col, col, ...)) would have to enumerate
-- every OTHER column — a trap the next `add column` walks straight into. So
-- the guard is a trigger that rejects the write unless the caller is the
-- service role. Reads are untouched: the client needs its own tier to render.
--
-- Also here: paywall_events, the instrumentation column. It is in this file
-- rather than its own because the events exist to answer whether 50 is the
-- right number for the limit these columns implement — one change, one file.
--
-- Idempotent (add column if not exists / drop-and-recreate constraints and
-- trigger): replaying yields the same end state.

-- --------------------------------------------------------------- columns

alter table public.loro_profiles
  add column if not exists tier text not null default 'free';

alter table public.loro_profiles
  add column if not exists tier_granted_at timestamptz;

alter table public.loro_profiles
  add column if not exists is_grandfathered boolean not null default false;

alter table public.loro_profiles
  drop constraint if exists loro_profiles_tier_check;

alter table public.loro_profiles
  add constraint loro_profiles_tier_check
  check (tier in ('free', 'plus'));

comment on column public.loro_profiles.tier is
  'Entitlement tier: free | plus. Service-role write only (trigger loro_profiles_tier_guard).';
comment on column public.loro_profiles.tier_granted_at is
  'When the current tier began. Null for free. Grandfathering + billing reconciliation.';
comment on column public.loro_profiles.is_grandfathered is
  'Was over the free saved-word limit when the paywall turned on; keeps unlimited saves permanently.';

-- ------------------------------------------------- instrumentation column

-- Paywall funnel. Same shape and contract as starter_deck_events
-- (20260730000000): one bounded jsonb array per user (hard-capped at 200
-- client-side), union-merged rather than blind-pushed, inheriting the profile
-- row's RLS instead of needing an events table and its own policies.
--
-- SHAPE (lib/entitlements/paywallEvents.ts is the authority):
--   [{ id, name, at, planId?, savedCount?, milestone? }]
--     id          client-generated, stable, unique per event. THE MERGE KEY.
--     name        paywall_shown | paywall_cta_clicked | paywall_dismissed
--                 | save_blocked_by_limit | saved_words_count
--     at          epoch ms
--     planId      paywall_cta_clicked: which plan was selected
--     savedCount  the counted saved-word total at the time
--     milestone   saved_words_count: which milestone (10 / 25 / 40 / 50)
--
-- The id is what makes the merge idempotent and is why content cannot be the
-- key: a user who hits the wall twice at 50 words produces two
-- save_blocked_by_limit entries identical in every other field, and that user
-- is the one this measurement most needs to see.
--
-- Anonymous users log locally and upload on sign-in, so the funnel covers the
-- people who never convert — which is the entire point of measuring a limit.
--
-- Example: is 50 the right ceiling, or do people stall well before it?
--   select e->>'name' as event, count(*)
--   from loro_profiles p, jsonb_array_elements(p.paywall_events) e
--   group by 1 order by 2 desc;
alter table public.loro_profiles
  add column if not exists paywall_events jsonb;

comment on column public.loro_profiles.paywall_events is
  'Paywall funnel: [{id, name, at, planId?, savedCount?, milestone?}]. Union-merged on id by the client; see lib/entitlements/paywallEvents.ts.';

-- ------------------------------------------------------- write guard

-- Rejects any client-side write to the three entitlement columns.
--
-- current_user is the role PostgREST switched to for the request: 'anon' or
-- 'authenticated' for the browser's keys, 'service_role' for the server key.
-- postgres / supabase_admin are the SQL editor and migration paths, which
-- must stay able to fix data by hand.
--
-- security invoker (the default, stated for the reader) is required: the
-- guard's whole mechanism is observing WHO the caller is, which a
-- security definer function would destroy.
create or replace function public.loro_guard_profile_tier()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- ensureProfile (lib/auth.ts) inserts { id, onboarded_at } and lets the
    -- defaults land. Anything else is an attempt to be born entitled.
    if new.tier is distinct from 'free'
       or new.tier_granted_at is not null
       or new.is_grandfathered is distinct from false then
      raise exception
        'loro_profiles.tier/tier_granted_at/is_grandfathered are service-role only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.tier is distinct from old.tier
     or new.tier_granted_at is distinct from old.tier_granted_at
     or new.is_grandfathered is distinct from old.is_grandfathered then
    raise exception
      'loro_profiles.tier/tier_granted_at/is_grandfathered are service-role only'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists loro_profiles_tier_guard on public.loro_profiles;
create trigger loro_profiles_tier_guard
  before insert or update on public.loro_profiles
  for each row execute function public.loro_guard_profile_tier();
