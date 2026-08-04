// Relative and extension-ed, not '@/lib/…': core's modules load under plain
// node for their tests, where neither the bundler alias nor extensionless
// specifiers resolve (same rule as starter/deck.ts).
import { createEmitter } from './emitter.ts';
import { staticVideos } from './catalog/staticVideos.ts';
import type { Video } from './types.ts';

/**
 * The catalog seam: where core gets the video catalog. The fourth sibling of
 * the storage / lifecycle / crypto seams in platform.ts, and it follows their
 * conventions exactly — each platform calls initCatalog() ONCE at boot, before
 * anything renders or reads:
 *
 *   - web: lib/catalogInit.ts hands over the bundled localVideos (seed clips +
 *     embed transcripts), installed as an import side effect at module-
 *     evaluation scope — the same shape as lib/platformInit.ts.
 *   - RN: the Supabase-served catalog, read from its on-device cache (or
 *     fetched, or falling back to the bundled seed), parsed once at boot and
 *     handed in before the first screen renders.
 *
 * EVERY READ IS SYNCHRONOUS AND PROMISE-FREE. That property is load-bearing
 * for the same reason platform.ts states in capitals for storage: getCatalog()
 * is called from render paths (the feed's initial state, /vocab's video
 * filter, /progress's per-video rows), from storage.getSavedWords() on EVERY
 * read, and from the starter planner. A promise here would force an app-wide
 * async rewrite of a deliberately promise-free API. Do not add one.
 *
 * THE RESTING STATE IS THE SEED SET, NOT AN EMPTY ARRAY. Before initCatalog —
 * a server render, a node test, or an RN boot whose cache is still loading —
 * getCatalog() returns the ~8 bundled seed clips rather than nothing. That is
 * what makes "the catalog is not ready yet" a degraded state instead of a
 * crash: with an empty list, calibration.ts pickGuidedVideo returns undefined
 * through a signature that promises a Video, and the guided intro immediately
 * dereferences it (video.cues) — a white screen for a brand-new user. The seed
 * is ~80KB and is bundled on every platform anyway, so this costs nothing that
 * was not already being paid.
 *
 * The returned array is the live one, not a copy — exactly as importing
 * localVideos directly was. Callers read it (find / filter / map / spread
 * before sort) and must not mutate it.
 */

const changed = createEmitter<void>('catalogChanged');

let catalog: Video[] = staticVideos;
let ready = false;

/**
 * Install the platform's catalog. Calling again replaces it (a background
 * refresh landing mid-session, or a dev reload) and notifies subscribers.
 *
 * An EMPTY list is refused and reported rather than installed. It can only
 * come from a loader bug — a fetch that resolved with nothing, a truncated
 * cache file — and the resting seed exists precisely to survive that. The
 * legitimate "we only have the seed" case is expressed by passing the seed.
 */
export function initCatalog(videos: Video[]): void {
  if (videos.length === 0) {
    console.error('[loro] initCatalog called with an empty catalog — keeping the seed');
    return;
  }
  catalog = videos;
  ready = true;
  changed.emit();
}

/** The catalog, synchronously. Never empty: the seed is the resting state. */
export function getCatalog(): Video[] {
  return catalog;
}

/**
 * Has a platform catalog been installed? False means getCatalog() is still
 * answering from the bundled seed. Nothing may BLOCK on this — it is for
 * surfaces that want to say "still loading the rest" while remaining usable.
 */
export function isCatalogReady(): boolean {
  return ready;
}

/** Subscribe to catalog replacement. Returns an unsubscribe function. */
export function onCatalogChanged(callback: () => void): () => void {
  return changed.subscribe(callback);
}
