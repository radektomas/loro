import type { Video } from '@loro/core/types';

/**
 * The takedown denylist: content that must never render, whatever the device
 * happens to be holding.
 *
 * WHY THIS EXISTS SEPARATELY FROM REMOVING THE VIDEO FROM data/. Removing an
 * entry from data/embedVideos.json and re-publishing fixes the CURRENT
 * snapshot and nothing else. It cannot reach:
 *
 *   - a device whose catalog.json on disk is an older snapshot (installed
 *     before the removal, and installCachedCatalog trusts it completely);
 *   - a device that never refreshes, or refreshes onto an older pointer;
 *   - any historical catalog/<hash>.json blob, which the content-addressed
 *     model NEVER deletes and which is publicly readable forever.
 *
 * So removal at the source is a publish-path fix for a read-path problem. This
 * list is the read-path half: applied to every Video[] on its way into
 * initCatalog, it makes a denied id unrenderable no matter which of those three
 * copies the device ended up with.
 *
 * WHY IT LIVES IN apps/mobile/src/platform/. This is the RN half of the loader
 * — the module set that already owns "WHICH copy of the catalog wins" (see
 * catalog.ts's header). A deny decision is exactly that kind of decision, so it
 * belongs beside installCachedCatalog rather than inside core's inert loader.
 *
 * ⚠️ THE DURABLE HOME IS packages/core, and this file is not it. Core is
 * imported by the web app (lib/catalogInit.ts) and mirrored by the publisher
 * (scripts/lib/catalog.mts), so a list there would cover all three surfaces
 * from one declaration; here it covers RN only. The web is not currently
 * exposed — it bundles data/*.json at build time and the id is already gone
 * from those — but that is a property of the build, not a guarantee. Moving
 * this into core (and having publish-catalog.mts refuse to publish a denied id)
 * is a deliberate follow-up, not something to do silently.
 *
 * ADDING TO THE LIST IS NOT A SUBSTITUTE FOR REMOVING THE CONTENT. It stops the
 * app from rendering it; it does not remove the bytes from Storage. Do both —
 * see scripts/catalog-blob-audit.mts.
 */

/**
 * YouTube ids that must never render. For embeds, Video.id and Video.youtubeId
 * are the same string by construction (scripts/lib/catalog.mts embedRow, and
 * every entry in data/embedVideos.json), so both fields are checked — a future
 * publisher that stops making them equal must not silently open a hole here.
 *
 *   AQRWt2bNMHo  removed 2026-08-06 (commit 59ab3c4) as objectionable.
 */
export const DENIED_IDS: ReadonlySet<string> = new Set<string>(['AQRWt2bNMHo']);

export function isDenied(video: Video): boolean {
  return (
    DENIED_IDS.has(video.id) ||
    (video.youtubeId !== undefined && DENIED_IDS.has(video.youtubeId))
  );
}

/**
 * Drop every denied entry, and say so.
 *
 * Returns the SAME array when nothing matched — the common case by far — so the
 * hot path costs one scan and no allocation, and so a caller can cheaply tell
 * "nothing was denied" by identity.
 *
 * The warn is not decoration: it is the only externally visible sign that a
 * device was holding denied content, and it is what makes the stale-cache test
 * in the takedown procedure observable.
 */
export function withoutDenied(videos: Video[]): Video[] {
  if (!videos.some(isDenied)) return videos;
  const kept = videos.filter((video) => !isDenied(video));
  console.warn(
    `[loro] denylist dropped ${videos.length - kept.length} video(s) from a catalog of ${videos.length}`
  );
  return kept;
}
