-- Discovery pipeline: record HOW each candidate was found.
--
-- Motivation. The table records what a candidate IS (title, licence, stats)
-- but nothing about where it came from. `region_hint` is the closest thing,
-- and it is first-writer-wins — so after a full sweep of 245 combinations we
-- still could not answer the question that decides the whole harvest strategy:
--
--   "which of my 35 queries actually produces eligible content?"
--
-- That answer is unrecoverable without re-harvesting everything, which is why
-- these columns land BEFORE the sweep rather than after it.
--
-- Both are arrays, unioned on upsert exactly like topic_tags. A video found by
-- three queries and one channel seed genuinely has four provenances; recording
-- only the first would repeat the region_hint mistake at a larger scale.

alter table public.loro_video_candidates
  -- Which search queries surfaced this video. Empty for rows discovered by
  -- other means (channel seeding), and for pre-provenance rows that could not
  -- be backfilled.
  add column if not exists source_queries text[] not null default '{}',
  -- How it was found: 'query' (search.list) | 'channel' (channel seeding).
  -- An array because both can be true of the same video.
  add column if not exists discovery_sources text[] not null default '{query}';

comment on column public.loro_video_candidates.source_queries is
  'Every search query that returned this video, unioned across harvests. The basis for per-query eligible yield — the highest-ranked tuning lever.';

comment on column public.loro_video_candidates.discovery_sources is
  'How this video was discovered: query | channel. Array because a video can be found by both, and the comparison between the two sources is the point.';

-- GIN indexes: both columns are queried by containment
--   ... where source_queries @> array['receta facil']
create index if not exists loro_video_candidates_source_queries_idx
  on public.loro_video_candidates using gin (source_queries);

create index if not exists loro_video_candidates_discovery_sources_idx
  on public.loro_video_candidates using gin (discovery_sources);
