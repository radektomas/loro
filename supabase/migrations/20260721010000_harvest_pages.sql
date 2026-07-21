-- Discovery pipeline: record what each search.list call actually returned.
--
-- Motivation. search.list costs 100 units and its response carries a
-- `nextPageToken` that tells us whether more results exist beyond the page we
-- paid for. We were throwing that away, which left the central planning
-- question — "is the Creative Commons pool for this query exhausted at one
-- page?" — unanswerable without spending MORE quota to re-ask. The token is
-- already in a response we have paid for, so capturing it is free.
--
-- Grain: one row per search.list call (query x region x license x page).
-- That is deliberately finer than loro_harvest_runs, which is one row per
-- run and spans many combinations. Depth is a property of a query, not of a
-- run, so it needs its own grain to be queryable:
--
--   -- which queries still have unfetched results?
--   select topic, query, region, max(result_count) as page_size,
--          bool_or(next_page_token is not null) as has_more
--   from loro_harvest_pages
--   group by topic, query, region
--   order by has_more desc;
--
-- Append-only observations. Nothing here is ever updated: each row is a
-- factual record of one API call, including the quota it cost.

create table if not exists public.loro_harvest_pages (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid references public.loro_harvest_runs (id) on delete cascade,

  -- Which combination this page belongs to. Denormalised on purpose: these
  -- are historical facts, and they must stay readable after the config that
  -- produced them has been edited.
  topic              text not null,
  query              text not null,
  region             text not null,
  -- The SEARCH branch ('creativeCommon' | 'any'), not a per-video license.
  -- Distinct vocabulary from loro_video_candidates.license — do not conflate:
  -- a search on the 'any' branch returns videos of both licenses.
  license_branch     text not null
                     check (license_branch in ('creativeCommon', 'any')),

  /** 0-based index of this page within the combination. */
  page_index         integer not null default 0,
  /** The token we SENT (null on the first page). */
  request_page_token text,
  /**
   * The token we RECEIVED. The whole point of this table:
   *   not null -> more results exist, the pool is NOT exhausted
   *   null     -> this query/region is fully enumerated
   */
  next_page_token    text,

  /** How many video ids this page actually yielded (maxResults is 50). */
  result_count       integer not null,
  /**
   * pageInfo.totalResults. YouTube's own docs call this an approximation and
   * it is often wildly wrong for search.list — useful only as an order of
   * magnitude, never as a count. Stored because it is free, not because it
   * is trustworthy.
   */
  total_results      bigint,

  fetched_at         timestamptz not null default now()
);

create index if not exists loro_harvest_pages_combo_idx
  on public.loro_harvest_pages (topic, query, region, license_branch);

create index if not exists loro_harvest_pages_run_idx
  on public.loro_harvest_pages (run_id);

-- Finding queries with remaining depth is the query this table exists for.
create index if not exists loro_harvest_pages_more_idx
  on public.loro_harvest_pages (next_page_token)
  where next_page_token is not null;

comment on column public.loro_harvest_pages.next_page_token is
  'Non-null means the query has more results than the page we fetched. This is the only direct evidence of pool depth, and it costs nothing — it rides along in a search.list response we already paid 100 units for.';

-- Same posture as the rest of the discovery pipeline: RLS on, no policies,
-- service role only.
alter table public.loro_harvest_pages enable row level security;
