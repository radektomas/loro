-- Marketing dashboard (getloro.app/marketing): Radek's own Instagram accounts,
-- read through Meta's Instagram API with Instagram Login and stored here once
-- a day so the dashboard can compare reels and show trends over time.
--
-- SERVER-ONLY TABLES. RLS on, NO policies: only the service role (the daily
-- sync and the admin-checked /api/marketing routes) can read or write. The
-- access tokens live in loro_marketing_ig_accounts and must never be readable
-- by anon or authenticated clients.

create table if not exists public.loro_marketing_ig_accounts (
  ig_user_id        text primary key,
  username          text not null,
  -- Long-lived Instagram User token (60 days). The sync refreshes it well
  -- before expiry; a missed window means generating a new one in Meta's app
  -- dashboard and pasting it into the dashboard again.
  access_token      text not null,
  token_expires_at  timestamptz,
  connected_at      timestamptz not null default now(),
  last_synced_at    timestamptz,
  last_error        text
);
alter table public.loro_marketing_ig_accounts enable row level security;

create table if not exists public.loro_marketing_ig_media (
  media_id            text primary key,
  ig_user_id          text not null references public.loro_marketing_ig_accounts (ig_user_id) on delete cascade,
  caption             text,
  media_type          text,          -- IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type  text,          -- FEED | REELS | STORY
  permalink           text,
  thumbnail_url       text,
  posted_at           timestamptz not null,
  updated_at          timestamptz not null default now()
);
create index if not exists loro_marketing_ig_media_account_posted
  on public.loro_marketing_ig_media (ig_user_id, posted_at desc);
alter table public.loro_marketing_ig_media enable row level security;

-- One row per media per day: the cumulative totals Instagram reported that
-- day. The latest row is "the numbers"; earlier rows show how fast a reel grew.
-- Null = Instagram returned no value for that metric (not supported for that
-- media type, or not computed yet), which is different from 0.
create table if not exists public.loro_marketing_ig_media_daily (
  media_id        text not null references public.loro_marketing_ig_media (media_id) on delete cascade,
  day             date not null,
  views           bigint,
  reach           bigint,
  likes           bigint,
  comments        bigint,
  shares          bigint,
  saved           bigint,
  reposts         bigint,
  avg_watch_ms    bigint,
  primary key (media_id, day)
);
alter table public.loro_marketing_ig_media_daily enable row level security;

-- One row per account per day. Instagram does not report follows per reel,
-- so the day-to-day change in followers is how a follower-winning reel shows.
create table if not exists public.loro_marketing_ig_account_daily (
  ig_user_id       text not null references public.loro_marketing_ig_accounts (ig_user_id) on delete cascade,
  day              date not null,
  followers_count  bigint,
  media_count      bigint,
  primary key (ig_user_id, day)
);
alter table public.loro_marketing_ig_account_daily enable row level security;
