#!/usr/bin/env node
/**
 * Loro — REVIEW LIST: published embeds whose title/description matches
 * CONTENT_KEYWORDS. Read-only; writes nothing anywhere.
 *
 *   npm run report-keywords
 *
 * The ingest filter rejects keyword matches automatically because a rejected
 * candidate costs nothing — it just sits in the table. A PUBLISHED video is
 * different: pulling it is visible to users, and the keyword list is written
 * broad on purpose ("matar el tiempo" matches). So the published catalog gets
 * a human eye, never an automatic sweep. To actually remove one after review,
 * add it to BLOCKED_VIDEOS (or its channel to BLOCKED_CHANNELS) in
 * config/harvest-queries.mts and run `npm run prune-embeds -- --apply`.
 *
 * Titles and descriptions live only in loro_video_candidates — the embed JSON
 * deliberately carries neither — so this joins the published ids back to
 * their candidate rows. Entries with no row (hand-added) cannot be scanned
 * and are counted so their absence is visible rather than silent.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO_ROOT } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { CANDIDATES_TABLE } from './lib/candidates.mts';
import { matchContentKeyword } from './lib/candidateFilter.mts';

const EMBEDS_PATH = path.join(REPO_ROOT, 'data', 'embedVideos.json');

type EmbedEntry = { youtubeId: string; creator?: string };
type CandidateSlice = {
  youtube_id: string;
  title: string | null;
  description: string | null;
  channel_title: string | null;
};

async function main(): Promise<void> {
  loadEnv();
  const supabase = getAdminClient();

  const embeds = JSON.parse(readFileSync(EMBEDS_PATH, 'utf8')) as EmbedEntry[];
  const ids = embeds.map((e) => e.youtubeId);

  // .in() with all ids at once: ~300 ids is well within PostgREST's URL
  // limits today, but page defensively the same way publish-catalog reads.
  const byId = new Map<string, CandidateSlice>();
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from(CANDIDATES_TABLE)
      .select('youtube_id,title,description,channel_title')
      .in('youtube_id', ids.slice(i, i + CHUNK));
    if (error) throw new Error(`candidate lookup failed: ${error.message}`);
    for (const row of (data ?? []) as CandidateSlice[]) byId.set(row.youtube_id, row);
  }

  const matches: { id: string; term: string; channel: string; title: string }[] = [];
  let unscannable = 0;
  for (const entry of embeds) {
    const row = byId.get(entry.youtubeId);
    if (!row) {
      unscannable += 1;
      continue;
    }
    const term = matchContentKeyword(row.title, row.description);
    if (term) {
      matches.push({
        id: entry.youtubeId,
        term,
        channel: row.channel_title ?? entry.creator ?? '?',
        title: row.title ?? '',
      });
    }
  }

  console.log(`\nLoro keyword review — published catalog (READ-ONLY)`);
  console.log(`  ${embeds.length} published embed(s), ${matches.length} keyword match(es)` +
    (unscannable ? `, ${unscannable} with no candidate row (not scanned)` : '') + '\n');

  const byTerm = new Map<string, typeof matches>();
  for (const m of matches) {
    const list = byTerm.get(m.term) ?? [];
    list.push(m);
    byTerm.set(m.term, list);
  }
  for (const [term, list] of [...byTerm.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  content_keyword:${term}   x${list.length}`);
    for (const m of list) {
      console.log(`    ${m.id}  ${m.channel} — ${m.title.slice(0, 60)}`);
      console.log(`      https://www.youtube.com/watch?v=${m.id}`);
    }
    console.log('');
  }
  if (matches.length === 0) {
    console.log('  Nothing matched. The published catalog is clean under the current list.\n');
    return;
  }
  console.log('To remove one: add it to BLOCKED_VIDEOS (or its channel to');
  console.log('BLOCKED_CHANNELS), then `npm run prune-embeds -- --apply` and');
  console.log('`npm run publish-catalog`.\n');
}

await main();
