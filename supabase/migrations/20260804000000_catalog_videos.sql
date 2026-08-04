-- The video catalog, served rather than bundled.
--
-- The RN client cannot ship data/embedVideos.json in its binary (3.6MB
-- minified, ~0.9MB gzipped, and every content update would become an app-store
-- release — docs/rn-port-map.md R4). This table is where that catalog lives so
-- it can be fetched and cached on device instead.
--
-- DERIVED, NOT CANONICAL. The repo JSON stays the source of truth: it is
-- authored by npm run publish-embeds, reviewable in diffs, and crash-safe by
-- being a file in git. This table is regenerated from it by
-- scripts/publish-catalog.mts, which is idempotent — so the table can always be
-- rebuilt from the repo, and never the other way round. Nothing reads from it
-- yet; the client seam that will (packages/core/src/catalog.ts) is already in
-- place and still fed by the bundle on web.
--
-- WHY A SIBLING TABLE AND NOT loro_videos. The UGC table looks like the right
-- home until three of its columns are checked against this content:
--
--   id uuid default gen_random_uuid()   this catalog's ids are raw YouTube ids
--       and seed text ids, and THEY ARE ALREADY WRITTEN into
--       loro_saved_words.video_id for every word every user has ever saved. A
--       uuid here would orphan all of it — the replay deep link, the cue index,
--       the per-video progress row and the translation upgrade all resolve
--       through that id.
--   creator_id uuid not null references loro_creators   this content has no
--       creator. Satisfying the FK would mean inventing a creator row that then
--       surfaces in creator queries and /creator/[handle].
--   storage_path text not null          an embed has no media in storage at
--       all; playback is the official iframe.
--
-- Its RLS is also built on creator_id = auth.uid(), which is meaningless for
-- rows nobody owns. So: the same MECHANISM (anon-readable jsonb rows fetched
-- with the anon client, cues/dictionary in exactly the shapes the app already
-- maps in lib/publishedVideos.ts) on a table whose shape matches the content.
-- loro_videos keeps meaning "content a creator owns"; this means "content we
-- published, with no owner".
--
-- Idempotent (create table if not exists / drop-and-recreate constraints,
-- policy and trigger): replaying yields the same end state.

create table if not exists public.loro_catalog_videos (
  -- TEXT, NOT UUID, and equal to the existing video id exactly: the raw
  -- YouTube id for an embed, the seed's own text id for a seed. This is the
  -- single non-negotiable column in the table — see the note above.
  id                          text primary key,

  -- Which of the two catalogs this row came from, and therefore which FeedAuthor
  -- variant the row -> Video mapper rebuilds: 'embed' -> {kind:'youtube', ...the
  -- four attribution fields}, 'seed' -> {kind:'none'}. A discriminator rather
  -- than "attribution is null, so guess": the author union exists precisely so a
  -- slide cannot be rendered with a missing obligation.
  kind                        text not null
                              check (kind in ('embed', 'seed')),

  -- Video.creator — the display label on the slide. Both kinds have one; who to
  -- LINK to is the author union, not this.
  creator                     text not null,

  -- Video.level. Not null with a check: every row in both catalogs is already
  -- CEFR-graded, and an ungraded row would silently take the A2 default that
  -- lib/publishedVideos.ts applies to UGC — a guess this content never needs.
  level                       text not null
                              check (level in ('A1', 'A2', 'B1', 'B2')),

  -- ---- seed-only ---------------------------------------------------------
  -- Nullable because embeds have neither: their src is '' (the slide renders
  -- the iframe, and Feed branches on youtube_id long before it reads src) and
  -- their poster frame is thumbnail_url below.
  src                         text,
  poster                      text,

  -- ---- embed-only --------------------------------------------------------
  -- All nullable because a seed populates none of them.
  --
  -- youtube_id equals id for every current row, and is stored anyway rather
  -- than derived: Video.youtubeId is its own field, it is what the player is
  -- handed, and collapsing the two would make a future non-YouTube embed
  -- source a schema change instead of a row.
  youtube_id                  text,
  thumbnail_url               text,
  -- numeric, matching loro_videos.duration_seconds rather than inventing a
  -- second convention for the same quantity.
  duration_seconds            numeric,

  -- The four TASL fields, stored as columns rather than one jsonb blob: they
  -- are a legal obligation on every embed slide (attribution line, CC BY chip,
  -- watch link), and columns are what let a check constraint below refuse an
  -- embed row that is missing any of them. A jsonb blob would make "an embed
  -- published without a channel URL" a runtime discovery.
  attribution_channel_title   text,
  attribution_channel_url     text,
  attribution_video_url       text,
  attribution_license         text
                              check (attribution_license is null
                                     or attribution_license in ('creativeCommon', 'youtube')),

  -- ---- the payload -------------------------------------------------------
  -- Exactly the Cue[] and Record<string, Gloss> shapes the app already uses,
  -- byte-for-byte what loro_videos.cues / .dictionary hold, so one row -> Video
  -- mapper can serve both tables. Not null: a row with no transcript is not a
  -- feed slide (lib/publishedVideos.ts rowToVideo already drops those), and a
  -- catalog that can contain unplayable rows pushes that check onto every
  -- reader.
  cues                        jsonb not null,
  dictionary                  jsonb not null,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Completeness per kind, enforced here rather than trusted from the publisher.
-- The embed half is the one that matters: an embed slide without its full TASL
-- set is an embed-terms violation, and "the script always fills them in" is not
-- a guarantee the database can rely on.
alter table public.loro_catalog_videos
  drop constraint if exists loro_catalog_videos_kind_shape;

alter table public.loro_catalog_videos
  add constraint loro_catalog_videos_kind_shape
  check (
    case kind
      when 'embed' then
        youtube_id is not null
        and thumbnail_url is not null
        and attribution_channel_title is not null
        and attribution_channel_url is not null
        and attribution_video_url is not null
        and attribution_license is not null
      when 'seed' then
        src is not null
      else false
    end
  );

comment on table public.loro_catalog_videos is
  'The served video catalog (seed clips + YouTube embeds). Derived from data/videos.json + data/embedVideos.json by scripts/publish-catalog.mts, which stay canonical.';
comment on column public.loro_catalog_videos.id is
  'TEXT and equal to the app''s video id (raw YouTube id for embeds). Written into loro_saved_words.video_id — never change or regenerate it.';
comment on column public.loro_catalog_videos.kind is
  'embed | seed — selects the FeedAuthor variant the row -> Video mapper rebuilds.';
comment on column public.loro_catalog_videos.cues is
  'Cue[]: [{start, end, words:[{text,start,end}], translations:{lang:line}}]. Same shape as loro_videos.cues.';
comment on column public.loro_catalog_videos.dictionary is
  'Record<normalisedSurface, Gloss>: {lemma, pos, note, glosses:{lang:text}}. Same shape as loro_videos.dictionary.';

-- Rows are fetched by kind when a client wants only the seed floor; 216 rows
-- makes this cosmetic today, but it costs nothing and the catalog only grows.
create index if not exists loro_catalog_videos_kind_idx
  on public.loro_catalog_videos (kind);

-- updated_at maintenance, reusing the trigger function the candidates
-- migration already defines rather than declaring a second one.
drop trigger if exists loro_catalog_videos_touch on public.loro_catalog_videos;
create trigger loro_catalog_videos_touch
  before update on public.loro_catalog_videos
  for each row execute function public.loro_touch_updated_at();

-- ---------------------------------------------------------------------- RLS
-- READ BY ANYONE, WRITTEN BY NOBODY (except the service role, which bypasses
-- RLS entirely).
--
-- This mirrors the MECHANISM of loro_videos' "read videos" policy — an anon
-- client fetching rows over PostgREST — but not its predicate. That policy is
-- `status = 'published' or creator_id = auth.uid() or is_admin()`, three
-- clauses about ownership and review state; this table has no owner and no
-- draft state. Everything in it is published by definition: it is the catalog
-- the app ships today, already public in the web bundle.
--
-- There is deliberately NO insert/update/delete policy. Under RLS an operation
-- with no policy is denied, so anon and authenticated clients cannot write a
-- single row, and scripts/publish-catalog.mts (service role) is the only writer
-- — the same posture loro_video_candidates uses.

alter table public.loro_catalog_videos enable row level security;

drop policy if exists "read catalog videos" on public.loro_catalog_videos;
create policy "read catalog videos"
  on public.loro_catalog_videos for select
  using (true);
