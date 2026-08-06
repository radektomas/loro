import { File, Paths } from 'expo-file-system';
import { initCatalog } from '@loro/core/catalog';
import { CatalogLoadError, fetchCatalogBlob, fetchPointer } from '@loro/core/catalogLoader';
import type { Video } from '@loro/core/types';
import { CATALOG_BASE_URL } from './config';
import { withoutDenied } from './denylist';
import { mmkv } from './storage';

/**
 * Catalog step 5: the RN half of the loader.
 *
 * core's catalogLoader.ts is pure and inert — it fetches, validates and throws,
 * and deliberately knows nothing about caches or seeds. Everything about WHERE
 * the catalog is kept and WHICH copy wins lives here.
 *
 * The three states, in the order they are preferred:
 *
 *   1. the persisted snapshot on disk   (216 videos, offline, instant)
 *   2. the bundled seed                 (8 videos — the seam's resting state)
 *   3. a fresh download                 (background, replaces 1 in place)
 *
 * There is no fourth "empty" state, and that is the point of the design: state
 * 2 is already installed by catalog.ts before this module runs, so a missing
 * cache, a corrupt cache and an offline first launch all degrade to a working
 * 8-video app rather than a crash.
 *
 * EVERY Video[] LEAVING THIS MODULE PASSES THROUGH withoutDenied() FIRST. Both
 * paths into initCatalog are filtered (the cache read below, and the fresh
 * download in refreshCatalog), and the download is filtered BEFORE it is
 * persisted, so denied content is neither rendered nor written to disk. Doing it
 * at both points rather than one is deliberate: filtering only the download
 * would leave an already-installed snapshot rendering it forever, and filtering
 * only the install would keep the bytes on the device. See denylist.ts.
 */

/** The snapshot itself. ~0.9MB of JSON — far too big for MMKV, which memory-
    maps its whole store; the filesystem is the right home for a blob. */
const CATALOG_FILENAME = 'catalog.json';
/** Written first, then moved over the real file — see persistAtomically. */
const TEMP_FILENAME = 'catalog.json.tmp';

/**
 * MMKV keys for the catalog's scalars, deliberately OUTSIDE the 'loro.'
 * namespace.
 *
 * Everything prefixed 'loro.' is swept by the account-deletion path. The
 * catalog is public content, not user data, so sweeping it would cost a
 * pointless 0.9MB re-download — and worse, it would clear the hash while
 * leaving the FILE untouched (the sweep only walks MMKV), producing exactly the
 * hash/file disagreement that installCachedCatalog has to repair. Keeping these
 * out of the sweep keeps them consistent with the file they describe.
 */
const HASH_KEY = 'catalog.hash';
const CHECKED_AT_KEY = 'catalog.checkedAt';
/** The hash of a published snapshot that came back UNUSABLE — see the backoff
    note in refreshCatalog. Stored, not just timestamped, because "this exact
    blob is broken" and "don't look for a while" are different facts. */
const BAD_HASH_KEY = 'catalog.badHash';

/** How long a hash that failed with a content error is left alone. The blob is
    immutable, so retrying it sooner fetches the identical broken bytes. */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

function catalogFile(): File {
  return new File(Paths.document, CATALOG_FILENAME);
}

export type CatalogSource = 'cache' | 'seed';

/**
 * BOOT, SYNCHRONOUS. Install the persisted snapshot if there is one.
 *
 * Synchronous on purpose: SDK 57's File API exposes textSync(), so the cached
 * catalog can be installed during module evaluation exactly as the web installs
 * localVideos — before the first render, with no async boot phase and no
 * 8→216 pop mid-session. The cost is a ~0.9MB parse on the JS thread, which the
 * splash screen covers (see boot.ts).
 *
 * Returns which source won, for the harness to display.
 */
export function installCachedCatalog(): CatalogSource {
  const file = catalogFile();
  if (!file.exists) return 'seed';

  try {
    const parsed: unknown = JSON.parse(file.textSync());
    // Shape is only smoke-tested here. The blob was fully validated by
    // fetchCatalogBlob before it was ever written, and persistAtomically means
    // a half-written file cannot be observed — so anything wrong at this point
    // is disk corruption, which a deep re-validation would not fix either.
    if (Array.isArray(parsed) && parsed.length > 0) {
      /**
       * THE DENY FILTER RUNS ON EVERY BOOT, NOT ONLY ON A FRESH DOWNLOAD.
       *
       * This file may have been written by an older build, from an older
       * snapshot, at any point in the past — a device that has not refreshed in
       * weeks installs it verbatim and never asks anyone whether the content is
       * still allowed. Filtering here is what makes the denylist independent of
       * WHICH snapshot the device holds.
       *
       * The filtered result is not written back: this is a read, the next
       * refresh rewrites the file anyway, and a write during the synchronous
       * boot parse is exactly the kind of work the splash screen should not be
       * covering. The cost is one extra scan per launch.
       */
      const videos = withoutDenied(parsed as Video[]);
      if (videos.length > 0) {
        initCatalog(videos);
        return 'cache';
      }
      console.warn('[loro] cached catalog held nothing but denied content — dropping it');
    } else {
      console.warn('[loro] cached catalog was empty or not an array — dropping it');
    }
  } catch (error) {
    console.warn(`[loro] cached catalog could not be read: ${String(error)}`);
  }

  // Unusable cache: delete it so the next refresh writes a clean one, and stay
  // on the seed initCatalog already holds.
  try {
    file.delete();
    mmkv.remove(HASH_KEY);
  } catch {
    // Nothing to do — the refresh below will overwrite it regardless.
  }
  return 'seed';
}

/**
 * Replace the snapshot without ever exposing a partial one.
 *
 * Write to a temp file, then move it over the destination. The move is the only
 * step that touches the real filename and it is atomic at the filesystem level,
 * so a crash, a kill or a full disk mid-write leaves the PREVIOUS catalog
 * intact. Writing 0.9MB directly to catalog.json would leave a truncated file
 * that still parses as an array — a feed with holes in it, and nothing
 * downstream able to tell that from a genuinely short catalog.
 */
function persistAtomically(videos: Video[]): void {
  const temp = new File(Paths.document, TEMP_FILENAME);
  if (temp.exists) temp.delete();
  temp.create();
  temp.write(JSON.stringify(videos));
  temp.moveSync(catalogFile(), { overwrite: true });
}

/**
 * BACKGROUND. Check the published pointer and install a newer catalog.
 *
 * Never throws: a catalog refresh failing must not be able to take down a boot.
 * Every exit path leaves a usable catalog installed, because the caller already
 * installed one before this ran.
 *
 * THE POINTER IS FETCHED ON EVERY CALL. IT IS NOT RATE-LIMITED, AND THAT IS THE
 * WHOLE POINT.
 *
 * This used to open with a 24h gate that returned before any network call, so a
 * device inside the window could not learn that a new hash existed — including a
 * hash published specifically to take content down. A takedown that a client is
 * structurally unable to notice for a day is not a takedown. The pointer is ~100
 * bytes with a 60s max-age and refreshCatalog is called once per launch (from
 * finishBoot), so fetching it unconditionally is cheap enough to be the default.
 *
 * What the timer still gates is narrower and is what it was always really for:
 * NOT re-downloading a 0.9MB blob that already proved unusable. That backoff is
 * now keyed on the failing HASH rather than on the clock alone, so a re-publish
 * that FIXES a broken catalog is picked up immediately instead of waiting out a
 * window it had nothing to do with.
 *
 * A pointer whose hash differs from the cache is downloaded regardless of when
 * we last checked.
 */
export async function refreshCatalog(): Promise<void> {
  /**
   * The hash is only trustworthy while the file it describes still exists.
   *
   * A stored hash whose file is gone would compare equal to the pointer and be
   * read as "nothing to do" — correctly, by the comparison's own logic — and we
   * would keep running on the 8-video seed forever, silently. Forcing null
   * re-downloads instead.
   */
  const cachedHash = catalogFile().exists ? (mmkv.getString(HASH_KEY) ?? null) : null;

  // Declared out here so the catch can attribute a content failure to the exact
  // hash that caused it. Still null if the POINTER itself was the bad object —
  // in which case there is no blob to blame and nothing gets blacklisted.
  let publishedHash: string | null = null;

  try {
    const pointer = await fetchPointer(fetch, CATALOG_BASE_URL);
    publishedHash = pointer.hash;

    if (cachedHash === publishedHash) {
      // Nothing new upstream. This is the only path the daily rhythm still
      // describes, and it costs one small GET.
      mmkv.set(CHECKED_AT_KEY, String(Date.now()));
      return;
    }

    /**
     * The one reason NOT to download a hash we do not have: this exact blob
     * already came back unusable recently. Blobs are immutable, so retrying
     * inside the window fetches the identical broken bytes — pure cost, and it
     * would repeat on every single launch now that the pointer is not gated.
     */
    if (publishedHash === mmkv.getString(BAD_HASH_KEY)) {
      const lastChecked = Number(mmkv.getString(CHECKED_AT_KEY) ?? '0');
      if (Number.isFinite(lastChecked) && Date.now() - lastChecked < REFRESH_INTERVAL_MS) {
        return;
      }
    }

    const downloaded = await fetchCatalogBlob(
      fetch,
      CATALOG_BASE_URL,
      pointer.hash,
      pointer.count
    );
    mmkv.set(CHECKED_AT_KEY, String(Date.now()));
    mmkv.remove(BAD_HASH_KEY);

    /**
     * Filtered BEFORE it is persisted, so denied content never reaches the
     * disk — a takedown that left the bytes cached on the device and merely
     * declined to render them would be a UI change, not a removal.
     *
     * expectedCount was already checked against the pointer inside
     * fetchCatalogBlob, above this line, so the truncation guard still sees the
     * full snapshot. Shortening it here afterwards is safe for the same reason
     * it would not be safe before.
     */
    const videos = withoutDenied(downloaded);
    if (videos.length === 0) {
      // Only reachable if the denylist covers the entire published catalog.
      // Installing that would empty the seam; keep whatever is already up.
      console.error('[loro] every video in the published catalog is denied — keeping the current one');
      return;
    }

    // File first, then the hash: if the process dies between them the hash is
    // stale-but-absent rather than present-but-wrong, and the next run
    // re-downloads. The reverse order would record a hash for a file that was
    // never written.
    persistAtomically(videos);
    // The UPSTREAM hash, recorded even though the file may hold fewer videos
    // than that snapshot does. It is the identity of what was published, which
    // is what the pointer comparison above asks about; the local filtering is
    // re-applied on every install and so does not need to be re-derivable.
    mmkv.set(HASH_KEY, publishedHash);
    initCatalog(videos);
  } catch (error) {
    /**
     * The loader's kind split is acted on here, which is what it exists for:
     *
     *   'fetch'    the bytes never arrived — offline, DNS, a 5xx. Transient, so
     *              record nothing: retry on the next launch rather than waiting
     *              out the full day.
     *   'content'  the bytes arrived and are wrong. Retrying fetches the same
     *              broken object, so record WHICH hash was bad and when, to stop
     *              hammering it, and log loudly — only a re-publish fixes this.
     *              Recording the hash rather than only the time is what lets the
     *              re-publish be picked up the moment it lands.
     */
    if (error instanceof CatalogLoadError) {
      if (error.kind === 'content') {
        mmkv.set(CHECKED_AT_KEY, String(Date.now()));
        if (publishedHash !== null) mmkv.set(BAD_HASH_KEY, publishedHash);
        console.error(`[loro] published catalog is unusable (${error.url}): ${error.message}`);
      } else {
        console.warn(`[loro] catalog refresh deferred: ${error.message}`);
      }
      return;
    }
    console.error(`[loro] catalog refresh failed unexpectedly: ${String(error)}`);
  }
}
