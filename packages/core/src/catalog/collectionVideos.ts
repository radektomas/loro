// See the note in staticVideos.ts on the import attribute.
import collectionData from '../../../../data/collections.json' with { type: 'json' };
import type { Video } from '../types.ts';
import { mapEmbedEntries } from './embedVideos.ts';

/**
 * THE COLLECTIONS FILE — Peppa, Masha, Bluey, the novelas — kept APART from
 * data/embedVideos.json on purpose (2026-09-11). The App Store build shows
 * whatever the published snapshot holds, inside a vertical reels feed, and
 * knows nothing of collections; so these stay out of that snapshot until a
 * build that filters by collection is live (publish-catalog leaves this
 * file out unless told otherwise). Until then the dev client merges it in
 * (FeedScreen, __DEV__ only) so the shelves can be seen and built.
 */
export const collectionVideos: Video[] = mapEmbedEntries(
  collectionData as unknown as Parameters<typeof mapEmbedEntries>[0]
);
