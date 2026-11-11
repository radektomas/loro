-- Reel cutter (getloro.app/cut): the reels Claude cuts from Radek's raw clips,
-- the notes Radek leaves on them at exact seconds, and which hook each reel
-- used so hooks can be compared once the reels are posted.
--
-- SERVER-ONLY TABLES. RLS on, NO policies: only the service role (the cutting
-- scripts on Radek's Mac and the admin-checked /api/cut routes) can touch them.
-- The videos live in the private `loro-cuts` storage bucket and reach the page
-- through short-lived signed URLs.

create table if not exists public.loro_cut_reels (
  id            uuid primary key default gen_random_uuid(),
  account       text not null check (account in ('radek.spanish', 'radek.explains.spanish', 'loro.app')),
  batch         text not null,             -- the day the batch was cut, e.g. 2026-11-10
  slot          int  not null,             -- position within the batch (1, 2, …)
  version       int  not null default 1,   -- bumped on every recut
  hook          text not null,
  lines         jsonb not null default '[]'::jsonb,   -- [{text, from, to}] seconds
  duration_s    numeric not null,
  video_path    text not null,             -- loro-cuts/<path> of the CURRENT version
  poster_path   text,
  me_file       text,                      -- source file names, for the record
  demo_file     text,
  job           jsonb,                     -- the render job (scripts/cut/render.py), so a recut starts from it
  status        text not null default 'review'
                check (status in ('review', 'approved', 'posted', 'dropped')),
  -- once posted: the reel's link, plus views typed in by hand until the
  -- account is connected on /marketing (then ig_media_id gives the numbers)
  permalink     text,
  ig_media_id   text,
  manual_views  bigint,
  posted_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (account, batch, slot)
);
create index if not exists loro_cut_reels_account_created on public.loro_cut_reels (account, created_at desc);
alter table public.loro_cut_reels enable row level security;

create table if not exists public.loro_cut_notes (
  id            uuid primary key default gen_random_uuid(),
  reel_id       uuid not null references public.loro_cut_reels (id) on delete cascade,
  version       int  not null,             -- the version Radek was watching
  at_s          numeric not null,          -- the second the note is pinned to
  body          text not null,
  created_at    timestamptz not null default now(),
  -- filled by Claude when a recut answers the note
  done_version  int,
  reply         text
);
create index if not exists loro_cut_notes_reel on public.loro_cut_notes (reel_id, at_s);
alter table public.loro_cut_notes enable row level security;
