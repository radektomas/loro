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
  storage_path: string;
  poster_path: string | null;
  level: string | null;
  cues: Cue[] | null;
  dictionary: Record<string, Gloss> | null;
  loro_creators: { display_name: string; handle: string } | null;
};

export async function fetchPublishedVideos(): Promise<Video[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(UGC_TABLES.videos)
    .select(
      'id, storage_path, poster_path, level, cues, dictionary, loro_creators(display_name, handle)'
    )
    .eq('status', 'published')
    .not('cues', 'is', null)
    .order('published_at', { ascending: false });
  if (error || !data) return [];

  const videos: Video[] = [];
  for (const row of data as unknown as PublishedRow[]) {
    const src = videoPublicUrl(row.storage_path);
    const cues = row.cues ?? [];
    // A published row without playable media or cues can't be a feed slide.
    if (!src || cues.length === 0) continue;
    const posterUrl = row.poster_path ? videoPublicUrl(row.poster_path) : null;
    videos.push({
      id: row.id,
      src,
      // No poster frame from the pipeline yet — empty string means the
      // <video> just paints its first decoded frame instead.
      poster: posterUrl ?? '',
      creator:
        row.loro_creators?.display_name ??
        (row.loro_creators?.handle
          ? `@${row.loro_creators.handle}`
          : 'Loro creator'),
      level: LEVELS.includes(row.level as Level)
        ? (row.level as Level)
        : DEFAULT_LEVEL,
      cues,
      dictionary: row.dictionary ?? {},
    });
  }
  return videos;
}
