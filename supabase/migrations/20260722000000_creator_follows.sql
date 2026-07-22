-- Loro creator profiles step 1: the follow relationship.
--
-- Run this in the Supabase SQL editor (like the other migrations).
--
--  * loro_follows        follower (auth user) -> creator, one row per pair
--  * follower_count      on loro_creators, trigger-maintained in the same
--                        style as saved_count / mastered_count on loro_videos
--  * avatar_url          on loro_creators — bundled now to save a manual
--                        migration trip later; nothing reads or writes it yet

-- ---------------------------------------------------------------- columns

alter table public.loro_creators
  add column if not exists follower_count integer not null default 0;

alter table public.loro_creators
  add column if not exists avatar_url text;

-- ---------------------------------------------------------------- follows

create table if not exists public.loro_follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  creator_id  uuid not null references public.loro_creators (user_id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- One follow per (user, creator). The primary key doubles as the unique
  -- constraint the client's on-conflict-do-nothing upsert targets.
  primary key (follower_id, creator_id)
);

create index if not exists loro_follows_creator_idx
  on public.loro_follows (creator_id);

alter table public.loro_follows enable row level security;

-- A user manages only their own follows. There is deliberately NO public
-- read of a creator's follower list — the public number is follower_count
-- on the (publicly readable, approved) creator row.
drop policy if exists "users read own follows" on public.loro_follows;
create policy "users read own follows"
  on public.loro_follows for select
  using (follower_id = auth.uid());

-- Only approved creators can be followed: a pending or rejected application
-- must not accumulate followers through a guessed or stale profile URL.
drop policy if exists "users follow approved creators" on public.loro_follows;
create policy "users follow approved creators"
  on public.loro_follows for insert
  with check (
    follower_id = auth.uid()
    and exists (
      select 1 from public.loro_creators c
      where c.user_id = creator_id and c.status = 'approved'
    )
  );

drop policy if exists "users unfollow" on public.loro_follows;
create policy "users unfollow"
  on public.loro_follows for delete
  using (follower_id = auth.uid());

-- ------------------------------------------------------ follower counter
-- Same pattern as loro_track_video_impact: SECURITY DEFINER because the
-- follower has no update rights on the creator's row, yet their follow must
-- still move the counter. Decrements floor at 0.

create or replace function public.loro_track_follow_count()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update loro_creators
      set follower_count = follower_count + 1
      where user_id = new.creator_id;
    return new;
  else -- DELETE
    update loro_creators
      set follower_count = greatest(follower_count - 1, 0)
      where user_id = old.creator_id;
    return old;
  end if;
end;
$$;

drop trigger if exists loro_follows_count on public.loro_follows;
create trigger loro_follows_count
  after insert or delete on public.loro_follows
  for each row execute function public.loro_track_follow_count();

-- ------------------------------------------------------ counter integrity
--
-- The impact counters (follower_count here, saved_count / mastered_count on
-- loro_videos) are the numbers a future revenue share is based on. They are
-- maintained ONLY by the SECURITY DEFINER triggers; no client may ever write
-- one directly. RLS cannot express "this column is read-only", and both
-- tables are client-writable in some path:
--
--   * loro_creators — a creator updates their own row (profile edits), and
--     inserts it in the apply flow.
--   * loro_videos   — a creator inserts their own row in the upload flow.
--
-- A column default only applies when the statement supplies no value, so a
-- table-wide INSERT grant lets a client seed a counter in the insert itself;
-- a table-wide UPDATE grant lets them set it afterwards. Column privileges
-- close both, and are checked before RLS.
--
-- MECHANISM: a column-level REVOKE has no effect while a table-level grant
-- exists (the table-level privilege keeps applying), so each privilege must
-- be revoked wholesale and re-granted per column. The consequence is that
-- these lists are now MAINTENANCE POINTS: a new client-written column on
-- either table must be added here, or writes to it fail with a permission
-- error at runtime. Everything except the counters is listed.
--
-- Column grants are per-ROLE and cannot distinguish an admin from a creator
-- — both are `authenticated`. So status/reviewed_at MUST stay granted or
-- /admin/creators (a client component running under the admin's own session)
-- breaks on approve/reject. WHO may change those two is enforced by the
-- loro_creators_guard trigger, which is exactly its job. The counter triggers
-- run as the function owner and are unaffected by any of this. Service-role
-- connections (the n8n pipeline) hold their own grants and are unaffected.

revoke insert, update on public.loro_creators from anon, authenticated;

-- status is deliberately NOT insertable: the apply flow relies on the
-- 'pending' default, and the RLS insert policy requires it.
grant insert (user_id, display_name, handle, bio, native_language,
              sample_link, avatar_url)
  on public.loro_creators to authenticated;

grant update (display_name, handle, bio, native_language, sample_link,
              avatar_url, status, reviewed_at)
  on public.loro_creators to authenticated;

revoke insert, update on public.loro_videos from anon, authenticated;

-- The creator's upload insert, plus poster_path: the browser writes the
-- poster frame at UPLOAD time, in the insert. It cannot be an update —
-- loro_videos updates are admin-only under RLS, so a creator has no path to
-- patch their own row afterwards. status is not insertable (the RLS policy
-- requires the 'uploaded' default).
grant insert (id, creator_id, storage_path, audio_path, duration_seconds,
              title, poster_path)
  on public.loro_videos to authenticated;

-- Admin review + pipeline writes. id / creator_id / created_at are identity
-- and are never updated by a client either.
grant update (status, storage_path, audio_path, duration_seconds, title,
              level, poster_path, cues, dictionary, review_note,
              reviewed_at, published_at)
  on public.loro_videos to authenticated;
