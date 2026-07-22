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
type StaticEntry = Omit<Video, 'author'>;

/**
 * The seed clips have no creator behind them (they predate UGC), so their
 * author is explicitly 'none': the feed renders their name as plain text and
 * never links it anywhere. Mapped rather than cast so the field actually
 * exists at runtime — a cast would satisfy the compiler and hand the feed an
 * undefined author.
 */
export const staticVideos: Video[] = (
  videosData as unknown as StaticEntry[]
).map((entry) => ({ ...entry, author: { kind: 'none' } }));

export const localVideos: Video[] = [...staticVideos, ...embedVideos];
