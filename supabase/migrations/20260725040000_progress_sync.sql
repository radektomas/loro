-- Progress sync — the streak, watch history and fill-in level follow the
-- account, not the browser.
--
-- Until this table, only saved words and follows synced. The streak day list
-- (loro.recallDays), watched-video log (loro.watchedVideos) and level meter
-- (loro.levelState) lived exclusively in localStorage — so a second device,
-- a cleared browser, or Safari's ~7-day storage eviction silently reset the
-- streak and level while the words came back, which reads as "my progress
-- vanished". One row per user; arrays are small (one day key per active day,
-- one id per watched video) and replaced whole on write.
--
-- Merge semantics live in lib/progressSync.ts: day/video sets are UNIONED,
-- level takes the higher (level, meter) — sync never moves progress
-- backwards; convergence across devices happens at each sign-in/app-open
-- hydrate, exactly like saved words.

create table if not exists public.loro_progress (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  -- "YYYY-MM-DD" local day keys with at least one correct recall.
  recall_days jsonb not null default '[]'::jsonb,
  -- Video ids that have taken the screen in this user's feed.
  watched_ids jsonb not null default '[]'::jsonb,
  -- { level, meter } — null until the level meter is first touched.
  level_state jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.loro_progress enable row level security;

drop policy if exists "own progress - select" on public.loro_progress;
create policy "own progress - select" on public.loro_progress
  for select using (auth.uid() = user_id);

drop policy if exists "own progress - insert" on public.loro_progress;
create policy "own progress - insert" on public.loro_progress
  for insert with check (auth.uid() = user_id);

drop policy if exists "own progress - update" on public.loro_progress;
create policy "own progress - update" on public.loro_progress
  for update using (auth.uid() = user_id);

drop trigger if exists loro_progress_touch on public.loro_progress;
create trigger loro_progress_touch
  before update on public.loro_progress
  for each row execute function public.loro_touch_updated_at();
