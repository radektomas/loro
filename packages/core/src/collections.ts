import type { Video } from './types.ts';

/**
 * THE COLLECTIONS — what the feed's chip row offers (2026-09-11).
 *
 * Radek: "give an option to switch between reels, Peppa Pig, some
 * telenovelas and Masha and the Bear". Everything under the chips is the
 * same feed — the same swipe, band, saved words, blanks, level words,
 * review and goal — only the list of videos and the shape of the box
 * change. Reels are vertical and shuffled; every other collection is
 * landscape and in episode order.
 *
 * The id is what a catalog entry carries in `collection`; absent means
 * reels, so every video published before this existed is a reel without a
 * migration. The order here is the order of the chips.
 */
export type Collection = {
  id: string;
  /** The chip's label. */
  label: string;
  /** Landscape 16:9, in episode order — everything but reels. */
  episodes: boolean;
};

export const REELS = 'reels';

export const COLLECTIONS: readonly Collection[] = [
  { id: REELS, label: 'Reels', episodes: false },
  { id: 'peppa', label: 'Peppa Pig', episodes: true },
  { id: 'masha', label: 'Masha y el Oso', episodes: true },
  { id: 'bluey', label: 'Bluey', episodes: true },
  { id: 'novelas', label: 'Novelas', episodes: true },
];

export function collectionOf(video: Pick<Video, 'collection'>): string {
  return video.collection ?? REELS;
}

export function findCollection(id: string): Collection {
  return COLLECTIONS.find((c) => c.id === id) ?? COLLECTIONS[0];
}

/** Landscape box and episode order, or the vertical reel? */
export function isEpisodes(id: string): boolean {
  return findCollection(id).episodes;
}
