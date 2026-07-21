-- Loro discovery pipeline, step 1: the YouTube candidate pool.
--
-- Run this in the Supabase SQL editor (same as the other migrations), then
-- harvest with:  npm run harvest -- --dry-run
--
-- This table is the INBOX of the discovery pipeline, not part of the feed.
-- Rows arrive from the YouTube Data API as 'discovered', get filtered to
-- 'eligible' | 'rejected', and only ever reach the feed after a transcription
-- exists. It deliberately does NOT live in loro_videos: that table's
-- creator_id is `not null references loro_creators(user_id)`, and a harvested
-- YouTube clip has no Loro creator. Promotion from 'ready' into the feed is a
-- separate, later step (see README) — nothing here is publicly readable.
--
-- ============================ LICENSE: READ THIS ============================
-- `license` is the entire legal posture of the discovery pipeline and the two
-- values are NOT interchangeable:
--
--   'creativeCommon' — CC-BY on YouTube. We MAY later download, re-host and
--                      self-serve the file (with attribution).
--   'youtube'        — standard YouTube license. Embed via the official
--                      iframe player ONLY. Never download, never re-host,
--                      never put in the loro-videos bucket.
--
-- The column is `not null` on purpose once known: no row may exist whose
-- reuse rights are ambiguous. Any consumer of this table MUST branch on
-- `license` before deciding how the video is played, and the two paths must
-- stay separate all the way down. Do not add a view or index that flattens
-- the distinction away.
-- ===========================================================================

create table if not exists public.loro_video_candidates (
  id                     uuid primary key default gen_random_uuid(),
  youtube_id             text not null,
  title                  text,
  -- Not in the original column list, added deliberately: the dubbing
  -- heuristic reads title + description, and those patterns are meant to be
  -- tuned. Without the description stored, every tuning pass would have to
  -- re-spend search quota to re-fetch it. Truncated on write (see the harvest
  -- script) — we need the signal, not the creator's full link dump.
  description            text,
  channel_id             text,
  channel_title          text,
  duration_seconds       integer,
  published_at           timestamptz,
  view_count             bigint,
  like_count             bigint,

  -- See the LICENSE block above. Mirrors videos.list -> status.license.
  license                text
                         check (license in ('creativeCommon', 'youtube')),

  -- videos.list -> status.embeddable. False means we cannot legally play it
  -- in an iframe, which for the 'youtube' branch means we cannot play it at all.
  is_embeddable          boolean,

  -- What the uploader declared (snippet.defaultAudioLanguage). Often null,
  -- and unreliable when present — hence detected_language below.
  default_audio_language text,
  -- Filled in later, from the transcription. The trustworthy one.
  detected_language      text,

  category_id            text,
  -- Which regional search surfaced this row first (MX, AR, ES, ...). A hint
  -- about the accent, not a claim about it.
  region_hint            text,
  -- Our own taxonomy, not YouTube's: animals, travel, food, ...
  topic_tags             text[] not null default '{}',
  thumbnail_url          text,

  status                 text not null default 'discovered'
                         check (status in (
                           'discovered',  -- from the API, not yet filtered
                           'eligible',    -- passed filters, awaiting transcription
                           'rejected',    -- failed filters (see reject_reason)
                           'processing',  -- transcription running
                           'ready',       -- transcribed, may enter the feed
                           'published'    -- live in the feed
                         )),
  -- Always the SPECIFIC cause ('duration_too_short', 'not_embeddable', ...),
  -- never a generic 'filtered' — thresholds get tuned, and that is only
  -- possible if you can count rows per exact reason.
  reject_reason          text,

  -- A1..C1, written by the scoring module later. Null for now.
  difficulty_level       text,

  discovered_at          timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- The upsert key: one row per YouTube video, forever. Re-harvesting the same
-- clip from a different topic/region refreshes stats, never duplicates.
create unique index if not exists loro_video_candidates_youtube_id_key
  on public.loro_video_candidates (youtube_id);

create index if not exists loro_video_candidates_status_idx
  on public.loro_video_candidates (status);

-- The workhorse: "how much CC content do we actually have?" is
-- (license, status), and it's the query the whole self-host-vs-embed
-- decision rests on.
create index if not exists loro_video_candidates_license_status_idx
  on public.loro_video_candidates (license, status);

-- Not used yet — the scoring module fills difficulty_level, and the feed will
-- then page through candidates by learner level.
create index if not exists loro_video_candidates_difficulty_idx
  on public.loro_video_candidates (difficulty_level);

-- Source-diversity filter counts eligible rows per channel on every harvest.
create index if not exists loro_video_candidates_channel_idx
  on public.loro_video_candidates (channel_id);

comment on column public.loro_video_candidates.license is
  'creativeCommon = may be downloaded and self-hosted with attribution; youtube = official iframe embed ONLY. Never merge the two paths.';

-- ------------------------------------------------------------ harvest runs
-- Resumability and quota accounting. The YouTube Data API gives ~10,000 units
-- a day and a single search.list costs 100, so a full topic x region x license
-- sweep spans several days. Each run records where it stopped so the next one
-- resumes there, and how much quota it burned so the same day's runs can add
-- up their spend before deciding whether to start.

create table if not exists public.loro_harvest_runs (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running'
               check (status in ('running', 'completed', 'quota_exhausted', 'failed')),
  -- Units consumed by THIS run (search.list = 100, videos.list = 1).
  quota_spent  integer not null default 0,
  -- Where to resume: {"comboIndex": 37, "pageToken": "CDIQAA"}. Null once the
  -- matrix has been walked end to end — the next run starts over from the top,
  -- which re-harvests known ids as cheap stat refreshes.
  cursor       jsonb,
  -- Counters for the end-of-run report, kept so history is queryable.
  stats        jsonb,
  error        text
);

create index if not exists loro_harvest_runs_started_idx
  on public.loro_harvest_runs (started_at desc);

-- ---------------------------------------------------------------- updated_at

create or replace function public.loro_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists loro_video_candidates_touch on public.loro_video_candidates;
create trigger loro_video_candidates_touch
  before update on public.loro_video_candidates
  for each row execute function public.loro_touch_updated_at();

-- ---------------------------------------------------------------------- RLS
-- Enabled with NO policies at all, deliberately. Under RLS a table with no
-- policy denies every request, so anon and authenticated clients cannot read
-- or write a single row. Only the service role (which bypasses RLS) touches
-- this table — the harvest script and, later, the transcription pipeline.
-- This is unreviewed third-party metadata; none of it belongs in the browser.

alter table public.loro_video_candidates enable row level security;
alter table public.loro_harvest_runs enable row level security;
