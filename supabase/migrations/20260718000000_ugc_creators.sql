-- Loro UGC step 2: creator applications, uploaded videos, admin review.
--
-- Run this in the Supabase SQL editor (or `supabase db push`). After running,
-- seed yourself as admin:
--
--   insert into public.loro_admins (user_id) values ('<your auth.users uuid>');
--
-- The n8n import workflow uses the SERVICE ROLE key, which bypasses RLS, so it
-- can freely move videos through uploaded -> processing -> published /
-- pending_review and write cues/dictionary.

-- ---------------------------------------------------------------- admins
-- No role concept existed in the app, so admin is a plain allowlist table.
-- It backs both the RLS policies below and the client-side gate (via the
-- loro_is_admin() RPC).

create table if not exists public.loro_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.loro_admins enable row level security;

drop policy if exists "admins read themselves" on public.loro_admins;
create policy "admins read themselves"
  on public.loro_admins for select
  using (user_id = auth.uid());

-- SECURITY DEFINER so RLS policies on other tables (and the client gate) can
-- consult the allowlist even though loro_admins itself is locked down.
create or replace function public.loro_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from loro_admins where user_id = auth.uid());
$$;

grant execute on function public.loro_is_admin() to authenticated, anon;

-- ---------------------------------------------------------------- creators

create table if not exists public.loro_creators (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  display_name    text not null,
  handle          text not null,
  bio             text not null default '',
  native_language text not null,
  sample_link     text,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  applied_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

create unique index if not exists loro_creators_handle_key
  on public.loro_creators (lower(handle));

alter table public.loro_creators enable row level security;

drop policy if exists "creators read own row, admins read all" on public.loro_creators;
create policy "creators read own row, admins read all"
  on public.loro_creators for select
  using (user_id = auth.uid() or public.loro_is_admin());

-- Applications always enter as 'pending'; nobody self-approves on insert.
drop policy if exists "users apply for themselves" on public.loro_creators;
create policy "users apply for themselves"
  on public.loro_creators for insert
  with check (user_id = auth.uid() and status = 'pending');

drop policy if exists "own row or admin updates" on public.loro_creators;
create policy "own row or admin updates"
  on public.loro_creators for update
  using (user_id = auth.uid() or public.loro_is_admin())
  with check (user_id = auth.uid() or public.loro_is_admin());

-- The update policy lets a creator edit their profile fields, but status and
-- reviewed_at are the review verdict — only admins may change those. (Service
-- role connections have auth.uid() = null and are exempt.)
create or replace function public.loro_creators_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and not public.loro_is_admin() then
    if new.status is distinct from old.status
       or new.reviewed_at is distinct from old.reviewed_at then
      raise exception 'only admins can review applications';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loro_creators_guard on public.loro_creators;
create trigger loro_creators_guard
  before update on public.loro_creators
  for each row execute function public.loro_creators_guard();

-- ---------------------------------------------------------------- videos
-- Matches the app's Video shape (types/index.ts): the n8n pipeline fills
-- cues + dictionary after whisper/gloss, then sets status to 'published' or
-- 'pending_review' (quality gate: bad timestamps / low confidence).
--
-- saved_count / mastered_count are the learning-impact counters a future
-- revenue share will be based on — maintained by trigger from day one.

create table if not exists public.loro_videos (
  id               uuid primary key default gen_random_uuid(),
  creator_id       uuid not null references public.loro_creators (user_id) on delete cascade,
  status           text not null default 'uploaded'
                   check (status in ('uploaded', 'processing', 'published', 'pending_review', 'rejected')),
  storage_path     text not null,
  duration_seconds numeric,
  title            text,
  level            text,
  poster_path      text,
  cues             jsonb,
  dictionary       jsonb,
  -- why the n8n quality gate flagged it, shown to the reviewer
  review_note      text,
  saved_count      integer not null default 0,
  mastered_count   integer not null default 0,
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  published_at     timestamptz
);

create index if not exists loro_videos_creator_idx on public.loro_videos (creator_id);
create index if not exists loro_videos_status_idx on public.loro_videos (status);

alter table public.loro_videos enable row level security;

-- Published videos are public (the feed will read them); creators see their
-- own regardless of status; admins see everything.
drop policy if exists "read videos" on public.loro_videos;
create policy "read videos"
  on public.loro_videos for select
  using (
    status = 'published'
    or creator_id = auth.uid()
    or public.loro_is_admin()
  );

-- Only APPROVED creators insert, only for themselves, only as 'uploaded'.
drop policy if exists "approved creators upload" on public.loro_videos;
create policy "approved creators upload"
  on public.loro_videos for insert
  with check (
    creator_id = auth.uid()
    and status = 'uploaded'
    and exists (
      select 1 from public.loro_creators c
      where c.user_id = auth.uid() and c.status = 'approved'
    )
  );

-- Status transitions are the reviewer's (or the pipeline's, via service role).
drop policy if exists "admins update videos" on public.loro_videos;
create policy "admins update videos"
  on public.loro_videos for update
  using (public.loro_is_admin())
  with check (public.loro_is_admin());

drop policy if exists "admins delete videos" on public.loro_videos;
create policy "admins delete videos"
  on public.loro_videos for delete
  using (public.loro_is_admin());

-- Live processing state on /creator/upload subscribes to this table.
do $$
begin
  alter publication supabase_realtime add table public.loro_videos;
exception
  when duplicate_object then null;
end;
$$;

-- ------------------------------------------------- learning-impact counters
-- loro_saved_words.video_id is text (seed videos have non-uuid ids), so UGC
-- rows are matched on id::text. "Mastered" = the word REACHED the top Leitner
-- box at least once (box 6 — keep in sync with MAX_BOX in lib/srs.ts); it is
-- deliberately monotonic, a later lapse never subtracts.
-- SECURITY DEFINER: regular users can't update loro_videos, but their word
-- activity must still move the counters.

create or replace function public.loro_track_video_impact()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  top_box constant integer := 6;
begin
  if tg_op = 'INSERT' then
    update loro_videos
      set saved_count = saved_count + 1,
          mastered_count = mastered_count + (case when new.box >= top_box then 1 else 0 end)
      where id::text = new.video_id;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.box >= top_box and old.box < top_box then
      update loro_videos
        set mastered_count = mastered_count + 1
        where id::text = new.video_id;
    end if;
    return new;
  else -- DELETE: the save is withdrawn, mastery stays earned
    update loro_videos
      set saved_count = greatest(saved_count - 1, 0)
      where id::text = old.video_id;
    return old;
  end if;
end;
$$;

drop trigger if exists loro_saved_words_impact on public.loro_saved_words;
create trigger loro_saved_words_impact
  after insert or update of box or delete on public.loro_saved_words
  for each row execute function public.loro_track_video_impact();

-- ---------------------------------------------------------------- storage
-- Public bucket so published videos play with plain public URLs (same model
-- as the static /videos/*.mp4 files today).

insert into storage.buckets (id, name, public)
values ('loro-videos', 'loro-videos', true)
on conflict (id) do nothing;

drop policy if exists "approved creators upload videos" on storage.objects;
create policy "approved creators upload videos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'loro-videos'
    -- objects live under <user_id>/<video_id>.<ext>
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.loro_creators c
      where c.user_id = auth.uid() and c.status = 'approved'
    )
  );

drop policy if exists "read loro videos" on storage.objects;
create policy "read loro videos"
  on storage.objects for select
  using (bucket_id = 'loro-videos');
