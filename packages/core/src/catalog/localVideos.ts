import { embedVideos } from './embedVideos.ts';
import { staticVideos } from './staticVideos.ts';
import type { Video } from '../types.ts';

/**
 * Every video that ships WITH the app: the static seed set plus the
 * discovery-sourced YouTube embeds. This is the catalog for anything that
 * resolves a SavedWord.videoId outside the feed (vocab list, SRS translation
 * upgrades, progress stats) — a word saved from an embed slide must resolve
 * exactly like one saved from a seed clip.
 *
 * NOT used by /welcome: the guided intro imports lib/staticVideos.ts directly
 * (seed clips only, where playback is frame-exact) — and, deliberately, NOT
 * this module, whose embedVideos import would pull the full embed-transcript
 * JSON into the onboarding bundle. UGC rows from Supabase remain feed-only,
 * as before.
 */
export { staticVideos };

export const localVideos: Video[] = [...staticVideos, ...embedVideos];
