-- Drop loro_handle_new_user() — dead code with a live footgun.
--
-- The function was written for an `after insert on auth.users` trigger that
-- was never created (verified 2026-07-25: 24 of 25 auth users had no
-- loro_profiles row, including one created the previous day — nothing calls
-- it). Profile creation is CLIENT-SIDE, in lib/auth.ts ensureProfile() on
-- sign-in, and stays that way.
--
-- Why drop rather than wire it: this database is SHARED across products
-- (multiple non-Loro tables reference auth.users). A trigger on auth.users
-- would fire for signups from every product, creating Loro profiles for
-- people who have never used Loro — the account-deletion cross-product
-- problem in reverse. A signup trigger is only safe once Loro has its own
-- Supabase project; if that day comes, recreate the function deliberately.
--
-- Fresh-replay note: 20260717000000_sync_tables.sql (the capture) records
-- this function's existence in a comment but does not create it, so on a
-- fresh project this drop is a no-op — end state identical to production.

drop function if exists public.loro_handle_new_user();
