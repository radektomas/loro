// See the note in staticVideos.ts on the import attribute.
import collectionData from '../../../../data/collections.json' with { type: 'json' };
import type { Video } from '../types.ts';
import { mapEmbedEntries } from './embedVideos.ts';

/**
 * THE COLLECTIONS FILE — Peppa today, more shows later — kept APART from
 * data/embedVideos.json on purpose (2026-09-11) and SHIPPED INSIDE THE
 * BINARY (2026-09-22, the Peppa update). Older builds read the published
 * snapshot inside a vertical reels feed and know nothing of collections,
 * so an episode in that snapshot would land in their reels; bundled here
 * and merged by FeedScreen, an episode is only ever seen by a build that
 * can shelve it. publish-catalog keeps leaving this file out. Adding an
 * episode therefore means a new build, which is the trade.
 */
export const collectionVideos: Video[] = mapEmbedEntries(
  collectionData as unknown as Parameters<typeof mapEmbedEntries>[0]
);
