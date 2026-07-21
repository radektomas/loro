import videosData from '@/data/videos.json';
import { embedVideos } from '@/lib/embedVideos';
import type { Video } from '@/types';

/**
 * Every video that ships WITH the app: the static seed set plus the
 * discovery-sourced YouTube embeds. This is the catalog for anything that
 * resolves a SavedWord.videoId outside the feed (vocab list, SRS translation
 * upgrades, progress stats) — a word saved from an embed slide must resolve
 * exactly like one saved from a seed clip.
 *
 * NOT used by /welcome: the guided intro drives precise seeks and pauses and
 * deliberately picks from the seed set only, where playback is frame-exact.
 * UGC rows from Supabase remain feed-only, as before.
 */
export const staticVideos = videosData as unknown as Video[];

export const localVideos: Video[] = [...staticVideos, ...embedVideos];
