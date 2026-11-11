-- Scaler dashboard (getloro.app/marketing): what wins on Instagram across
-- Radek's three accounts, where the bio-link taps come from, and the scaler's
-- proposed batches that Radek approves before anything is cut.
-- Design: docs/superpowers/specs/2026-11-11-scaler-dashboard-design.md
--
-- SERVER-ONLY TABLES. RLS on, NO policies: only the service role (the daily
-- sync, the admin-checked /api/marketing routes, the public /go redirect's
-- insert, and the scripts on Radek's Mac) can read or write.

-- Two more reel metrics Meta reports ("in development": may stay null).
alter table public.loro_marketing_ig_media_daily add column if not exists skip_rate numeric;
alter table public.loro_marketing_ig_media_daily add column if not exists view_total_ms bigint;

-- One row per tap on getloro.app/go/<channel> (the bio links). Nothing about
-- the person: no IP, no cookie, no user agent, only whether it looked like a
-- link preview / crawler ('bot', excluded from counts) or a person ('human').
create table if not exists public.loro_marketing_link_taps (
  id       bigint generated always as identity primary key,
  channel  text not null check (channel in ('radek.spanish', 'radek.explains.spanish', 'loro.app')),
  at       timestamptz not null default now(),
  ua_kind  text not null check (ua_kind in ('human', 'bot'))
);
create index if not exists loro_marketing_link_taps_channel_at on public.loro_marketing_link_taps (channel, at desc);
alter table public.loro_marketing_link_taps enable row level security;

-- What each Instagram post IS, so rankings can say why it won: its hook (from
-- /cut, read off the cover, or typed by Radek), the hook's kind, the format,
-- the demo, line 1's variant and the voice. manual = Radek edited it, so the
-- enrich script never overwrites it.
create table if not exists public.loro_marketing_post_tags (
  media_id       text primary key references public.loro_marketing_ig_media (media_id) on delete cascade,
  hook           text,
  hook_source    text check (hook_source in ('cut', 'cover', 'manual')),
  hook_kind      text check (hook_kind in ('question', 'statement')),
  format         text not null default 'other' check (format in ('cut', 'phrases', 'outline-game', 'other')),
  demo_kind      text not null default 'unknown' check (demo_kind in ('reels', 'peppa', 'other', 'unknown')),
  line1_variant  text,
  voice          text check (voice in ('i', 'you')),
  cut_reel_id    uuid references public.loro_cut_reels (id) on delete set null,
  manual         boolean not null default false,
  updated_at     timestamptz not null default now()
);
alter table public.loro_marketing_post_tags enable row level security;

-- App Store installs per channel per week, typed in from App Store Connect
-- (campaign ct=ig-<channel>) until the App Store Connect API is wired.
create table if not exists public.loro_marketing_installs (
  channel   text not null check (channel in ('radek.spanish', 'radek.explains.spanish', 'loro.app')),
  week      date not null,   -- the Monday
  installs  int  not null check (installs >= 0),
  primary key (channel, week)
);
alter table public.loro_marketing_installs enable row level security;

-- The scaler's proposed batches. A plan is tied to real me + demo clip pairs
-- in the REELS inbox; Radek approves or rejects it (or single items) on
-- /marketing#plan, and cut-reels cuts only from an approved plan.
create table if not exists public.loro_scale_plans (
  id          uuid primary key default gen_random_uuid(),
  batch       text not null,
  status      text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'cut')),
  summary     text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
alter table public.loro_scale_plans enable row level security;

create table if not exists public.loro_scale_plan_items (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references public.loro_scale_plans (id) on delete cascade,
  slot               int  not null,
  account            text not null check (account in ('radek.spanish', 'radek.explains.spanish', 'loro.app')),
  me_file            text not null,
  demo_file          text not null,
  hook               text not null,
  hook_kind          text,
  line1_variant      text,
  voice              text,
  demo_kind          text,
  role               text not null check (role in ('exploit', 'test')),
  reason             text not null,
  expected_multiple  numeric,
  status             text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'cut')),
  cut_reel_id        uuid references public.loro_cut_reels (id) on delete set null,
  unique (plan_id, slot)
);
alter table public.loro_scale_plan_items enable row level security;
