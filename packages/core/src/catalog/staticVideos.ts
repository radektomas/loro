import videosData from '../../../../data/videos.json';
import type { Video } from '../types.ts';

/**
 * The static seed clips, alone — split out of localVideos.ts so /welcome can
 * import them without dragging data/embedVideos.json (megabytes of embed
 * transcripts) into the onboarding bundle. The guided intro deliberately
 * uses ONLY this set: it drives precise seeks and pauses, and seed playback
 * is frame-exact where embeds are not.
 */
type StaticEntry = Omit<Video, 'author'>;

/**
 * The seed clips have no creator behind them (they predate UGC), so their
 * author is explicitly 'none': the feed renders their name as plain text and
 * never links it anywhere. Mapped rather than cast so the field actually
 * exists at runtime — a cast would satisfy the compiler and hand the feed an
 * undefined author. (Not hypothetical: /welcome once cast the raw JSON to
 * Video[] and crashed AuthorLine on author.kind for every onboarding user.)
 */
export const staticVideos: Video[] = (
  videosData as unknown as StaticEntry[]
).map((entry) => ({ ...entry, author: { kind: 'none' } }));
