-- Sync tables — loro_profiles and loro_saved_words, captured from production.
--
-- These two tables predate the migrations directory: they were created by
-- hand in the SQL editor when "sign in to sync" was built, and existed in no
-- migration file until this one. This file is a CAPTURE, not a change — it
-- was authored 2026-07-25 from live introspection (loro_schema_report() v3,
-- 20260725000000) and reproduces the production DDL exactly, including the
-- auto-generated constraint names (declared inline so Postgres derives the
-- same names a fresh project would need).
--
-- BACKDATED to 20260717000000 deliberately: 20260718000000_ugc_creators.sql
-- creates a trigger ON loro_saved_words, so on a fresh project this file must
-- sort before it or the replay fails. Against the existing database every
-- statement is guarded (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS) and the
-- whole file is a no-op.
--
-- FK findings this capture settled (previously unverifiable from the repo):
--   loro_saved_words.user_id -> auth.users(id) ON DELETE CASCADE
--   loro_profiles.id         -> auth.users(id) ON DELETE CASCADE
-- Account deletion nevertheless deletes from every table explicitly rather
-- than leaning on these — see /api/account/delete.

-- ------------------------------------------------------------- functions

-- Touch trigger for updated_at. Captured as live: plain invoker rights, no
-- search_path pin (it references only NEW).
create or replace function public.loro_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- NOT captured although it existed live: loro_handle_new_user(), a
-- SECURITY DEFINER function written for an `after insert on auth.users`
-- trigger that was never created (verified 2026-07-25: 24 of 25 auth users
-- had no loro_profiles row — nothing called it). Profile creation is
-- client-side (lib/auth.ts ensureProfile on sign-in).
-- 20260725020000_drop_handle_new_user.sql removes it from production and
-- explains why it must not be wired while the database is shared across
-- products; deliberately not created here so the drift check never expects
-- a function whose fate is to be dropped.

-- --------------------------------------------------------- loro_profiles

create table if not exists public.loro_profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  level        text default 'A1'::text
               check (level = any (array['A1'::text, 'A2'::text, 'B1'::text, 'B2'::text])),
  onboarded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.loro_profiles enable row level security;

drop policy if exists "own profile - select" on public.loro_profiles;
create policy "own profile - select" on public.loro_profiles
  for select using (auth.uid() = id);

drop policy if exists "own profile - update" on public.loro_profiles;
create policy "own profile - update" on public.loro_profiles
  for update using (auth.uid() = id);

drop policy if exists "own profile - upsert" on public.loro_profiles;
create policy "own profile - upsert" on public.loro_profiles
  for insert with check (auth.uid() = id);

drop trigger if exists loro_profiles_touch on public.loro_profiles;
create trigger loro_profiles_touch
  before update on public.loro_profiles
  for each row execute function public.loro_touch_updated_at();

-- ------------------------------------------------------ loro_saved_words

create table if not exists public.loro_saved_words (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  text             text not null,
  translation      text not null,
  -- text, not uuid: seed videos and YouTube embeds have non-uuid ids, and
  -- there is deliberately no FK to loro_videos (ugc_creators.sql relies on
  -- this — deleting a video must not delete anyone's SRS card).
  video_id         text not null,
  cue_index        integer not null,
  state            text not null default 'new'::text
                   check (state = any (array['new'::text, 'learning'::text, 'known'::text, 'lapsed'::text])),
  box              integer not null default 0 check (box >= 0 and box <= 5),
  due_at           timestamptz not null default now(),
  correct          integer not null default 0,
  incorrect        integer not null default 0,
  last_reviewed_at timestamptz,
  saved_at         timestamptz not null default now(),
  unique (user_id, text, video_id, cue_index)
);

alter table public.loro_saved_words enable row level security;

drop policy if exists "own words - select" on public.loro_saved_words;
create policy "own words - select" on public.loro_saved_words
  for select using (auth.uid() = user_id);

drop policy if exists "own words - insert" on public.loro_saved_words;
create policy "own words - insert" on public.loro_saved_words
  for insert with check (auth.uid() = user_id);

drop policy if exists "own words - update" on public.loro_saved_words;
create policy "own words - update" on public.loro_saved_words
  for update using (auth.uid() = user_id);

drop policy if exists "own words - delete" on public.loro_saved_words;
create policy "own words - delete" on public.loro_saved_words
  for delete using (auth.uid() = user_id);

create index if not exists loro_saved_words_user_idx
  on public.loro_saved_words using btree (user_id);

create index if not exists loro_saved_words_due_idx
  on public.loro_saved_words using btree (user_id, due_at);

-- NOT here: trigger loro_saved_words_impact and its function
-- loro_track_video_impact live in 20260718000000_ugc_creators.sql, which is
-- where they were introduced and which sorts after this file.
