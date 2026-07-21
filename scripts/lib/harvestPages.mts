import type { SupabaseClient } from '@supabase/supabase-js';
import type { LicenseBranch } from '../config/harvest-queries.mts';

/**
 * Per-search-call observations: what one search.list actually returned.
 *
 * Exists for one question — "is this query's pool exhausted at one page?" —
 * which `nextPageToken` answers directly and which nothing else can answer
 * without spending another 100 units. The token rides along in a response we
 * have already paid for, so recording it is free.
 *
 * Schema: supabase/migrations/20260721010000_harvest_pages.sql
 */

export const HARVEST_PAGES_TABLE = 'loro_harvest_pages';

export type PageObservation = {
  topic: string;
  query: string;
  region: string;
  /** The SEARCH branch, not a per-video license. */
  licenseBranch: LicenseBranch;
  pageIndex: number;
  /** Token sent (null on the first page). */
  requestPageToken: string | null;
  /** Token received. Non-null => more results exist beyond this page. */
  nextPageToken: string | null;
  resultCount: number;
  /** pageInfo.totalResults — approximate, per YouTube's own docs. */
  totalResults: number | null;
};

/** Convenience for logs and reports. */
export function hasMorePages(observation: PageObservation): boolean {
  return observation.nextPageToken !== null;
}

/**
 * Append one observation. Written immediately after each search rather than
 * batched at the end of a combination, so a crash still leaves a record of
 * quota that was genuinely spent.
 *
 * A failure here must never abort the harvest: the page was already fetched
 * and paid for, and losing the bookkeeping is strictly better than losing the
 * candidates that came with it.
 */
export async function recordPage(
  supabase: SupabaseClient,
  runId: string,
  observation: PageObservation
): Promise<void> {
  const { error } = await supabase.from(HARVEST_PAGES_TABLE).insert({
    run_id: runId,
    topic: observation.topic,
    query: observation.query,
    region: observation.region,
    license_branch: observation.licenseBranch,
    page_index: observation.pageIndex,
    request_page_token: observation.requestPageToken,
    next_page_token: observation.nextPageToken,
    result_count: observation.resultCount,
    total_results: observation.totalResults,
  });
  if (error) console.warn(`  ! could not record page observation: ${error.message}`);
}
