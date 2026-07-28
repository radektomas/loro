-- Self-assessed starting level from onboarding's new first step.
--
-- A NEW column, deliberately not the existing loro_profiles.level: that one
-- is the CEFR feed-seeding level (default 'A1', check A1/A2/B1/B2) and keeps
-- its meaning untouched. self_level records what the user SAID about
-- themselves ('zero' routes to the starter deck; 'some'/'confident' go to
-- calibration), which is a different fact with different values.
--
-- Nullable with no default: everyone onboarded before this feature simply has
-- no self-assessment, and the client only pushes the value when one exists
-- (lib/storage.ts syncSelfLevel — merge-on-signin, same pattern as
-- save_prompt_stats: an update against a not-yet-migrated DB fails on the
-- unknown column, is logged, and retries at the next auth event).
--
-- Idempotent by drop-and-recreate: replaying yields the same end state.

alter table public.loro_profiles
  add column if not exists self_level text;

alter table public.loro_profiles
  drop constraint if exists loro_profiles_self_level_check;

alter table public.loro_profiles
  add constraint loro_profiles_self_level_check
  check (
    self_level is null
    or self_level in ('zero', 'some', 'confident')
  );
