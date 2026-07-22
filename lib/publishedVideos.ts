import { getSupabase } from '@/lib/supabase';
import { UGC_TABLES, videoPublicUrl } from '@/lib/creators';
import type { Cue, Gloss, Level, Video } from '@/types';

/**
 * Published UGC videos, mapped from loro_videos rows to the app's Video
 * shape so the feed can mix them with the static seed videos untouched.
 * The pipeline writes cues/dictionary in exactly the Cue/Gloss shapes the
 * player expects, so no transformation happens here beyond URL resolution
 * and defaults for fields the pipeline doesn't fill yet.
 */

const LEVELS: readonly Level[] = ['A1', 'A2', 'B1', 'B2'];
/** Pipeline doesn't grade level yet — A2 slots new clips mid-feed rather
    than pinning them to either end of the difficulty ordering. */
const DEFAULT_LEVEL: Level = 'A2';

type PublishedRow = {
  id: string;
  creator_id: string;
  storage_path: string;
  poster_path: string | null;
  level: string | null;
  cues: Cue[] | null;
  dictionary: Record<string, Gloss> | null;
  loro_creators: {
    display_name: string;
    handle: string;
    avatar_url: string | null;
  } | null;
};

/** Columns every feed query needs — kept in one place so the scoped feed and
    the main feed can never drift into building different Video shapes. */
const FEED_COLUMNS =
  'id, creator_id, storage_path, poster_path, level, cues, dictionary, loro_creators(display_name, handle, avatar_url)';

/**
 * One published row -> a feed slide, or null when the row can't be one.
 *
 * The author is 'creator' whenever the joined creator row came back, which
 * is what makes the attribution tappable through to a profile. It falls back
 * to 'none' if the join is empty — that means the creator is no longer
 * approved (RLS hides unapproved rows from public readers), so linking to a
 * profile that would 404 is exactly what must not happen.
 */
function rowToVideo(row: PublishedRow): Video | null {
  const src = videoPublicUrl(row.storage_path);
  const cues = row.cues ?? [];
  // A published row without playable media or cues can't be a feed slide.
  if (!src || cues.length === 0) return null;
  const posterUrl = row.poster_path ? videoPublicUrl(row.poster_path) : null;
  const creatorRow = row.loro_creators;
  return {
    id: row.id,
    src,
    // No poster frame yet — empty string means the <video> just paints its
    // first decoded frame instead.
    poster: posterUrl ?? '',
    creator:
      creatorRow?.display_name ??
      (creatorRow?.handle ? `@${creatorRow.handle}` : 'Loro creator'),
    author: creatorRow
      ? {
          kind: 'creator',
          creatorId: row.creator_id,
          handle: creatorRow.handle,
          displayName: creatorRow.display_name,
          avatarUrl: creatorRow.avatar_url,
        }
      : { kind: 'none' },
    level: LEVELS.includes(row.level as Level)
      ? (row.level as Level)
      : DEFAULT_LEVEL,
    cues,
    dictionary: row.dictionary ?? {},
  };
}

export async function fetchPublishedVideos(): Promise<Video[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(UGC_TABLES.videos)
    .select(FEED_COLUMNS)
    .eq('status', 'published')
    .not('cues', 'is', null)
    .order('published_at', { ascending: false });
  if (error || !data) return [];

  return (data as unknown as PublishedRow[])
    .map(rowToVideo)
    .filter((v): v is Video => v !== null);
}

/**
 * One creator's published videos, newest first — the scoped feed opened by
 * tapping a profile grid tile.
 *
 * A SEPARATE query on purpose, not a filter over the main feed's list: the
 * main feed's published rows arrive after first paint, so filtering would
 * render an empty feed and then pop content in underneath the user. This
 * fetch is the scoped feed's only source, and its order (newest first)
 * matches the profile grid, so the tapped tile continues into the same
 * sequence the user was just looking at.
 *
 * Matched on the lowercased handle for the same reason as
 * lib/creatorProfile.ts: `_` is a legal handle character and a LIKE wildcard.
 */
export async function fetchCreatorFeed(handle: string): Promise<Video[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data: creator } = await supabase
    .from(UGC_TABLES.creators)
    .select('user_id')
    .eq('handle', handle.trim().toLowerCase())
    .eq('status', 'approved')
    .maybeSingle();
  if (!creator) return [];

  const { data, error } = await supabase
    .from(UGC_TABLES.videos)
    .select(FEED_COLUMNS)
    .eq('creator_id', (creator as { user_id: string }).user_id)
    .eq('status', 'published')
    .not('cues', 'is', null)
    .order('published_at', { ascending: false });
  if (error || !data) return [];

  return (data as unknown as PublishedRow[])
    .map(rowToVideo)
    .filter((v): v is Video => v !== null);
}
