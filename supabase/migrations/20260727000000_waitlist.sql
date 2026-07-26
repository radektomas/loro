-- Waitlist for the /join pre-launch page ("founding member" offer).
--
-- Collects emails only — deliberately NOT tied to auth.users: most signups
-- will have no account, and an account deletion must not touch a marketing
-- list the user consented to separately (unsubscribe is its own flow).
--
-- Writes come exclusively through POST /api/waitlist using the ANON client
-- (the service key is not in Vercel, by design). So:
--   - anon gets INSERT and nothing else; no select/update/delete policies
--     exist for anon or authenticated, so RLS denies them.
--   - the API inserts with `return=minimal` (supabase-js .insert() without
--     .select()), which is why insert-only works without a select grant.
--   - a duplicate email surfaces as unique_violation (23505); the API maps
--     it to 200 { alreadyJoined: true } so existence never leaks as an error.
--
-- consent is CHECK-constrained true, not just defaulted: a row in this table
-- IS the consent record (GDPR), so an unconsented row must be unrepresentable.
-- Normalisation (lower/trim) happens in the API; the CHECK below makes the
-- database reject anything that slipped past it, keeping `unique` honest
-- ("Foo@x.com " and "foo@x.com" must be the same row).

create table if not exists public.loro_waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique
             check (email = lower(btrim(email))),
  source     text default 'landing',
  consent    boolean not null default false
             check (consent = true),
  created_at timestamptz default now()
);

alter table public.loro_waitlist enable row level security;

drop policy if exists "waitlist - anon insert" on public.loro_waitlist;
create policy "waitlist - anon insert" on public.loro_waitlist
  for insert to anon
  with check (true);
