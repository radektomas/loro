import { File, Paths } from 'expo-file-system';
import { initCatalog } from '@loro/core/catalog';
import { CatalogLoadError, resolveCatalog } from '@loro/core/catalogLoader';
import type { Video } from '@loro/core/types';
import { CATALOG_BASE_URL } from './config';
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
 */

/** The snapshot itself. ~0.9MB of JSON — far too big for MMKV, which memory-
    maps its whole store; the filesystem is the right home for a blob. */
const CATALOG_FILENAME = 'catalog.json';
/** Written first, then moved over the real file — see persistAtomically. */
const TEMP_FILENAME = 'catalog.json.tmp';

/**
 * MMKV keys for the two scalars, deliberately OUTSIDE the 'loro.' namespace.
 *
 * Everything prefixed 'loro.' is swept by the account-deletion path. The
 * catalog is public content, not user data, so sweeping it would cost a
 * pointless 0.9MB re-download — and worse, it would clear the hash while
 * leaving the FILE untouched (the sweep only walks MMKV), producing exactly the
 * hash/file disagreement that installCachedCatalog has to repair. Keeping both
 * scalars out of the sweep keeps them consistent with the file they describe.
 */
const HASH_KEY = 'catalog.hash';
const CHECKED_AT_KEY = 'catalog.checkedAt';

/** Once a day. The pointer is ~80 bytes, but the check is not free on a cold
    radio, and the catalog changes on the order of weeks. */
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
      initCatalog(parsed as Video[]);
      return 'cache';
    }
    console.warn('[loro] cached catalog was empty or not an array — dropping it');
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
 */
export async function refreshCatalog(): Promise<void> {
  const lastChecked = Number(mmkv.getString(CHECKED_AT_KEY) ?? '0');
  if (Number.isFinite(lastChecked) && Date.now() - lastChecked < REFRESH_INTERVAL_MS) {
    return;
  }

  /**
   * The hash is only trustworthy while the file it describes still exists.
   *
   * Passing a stored hash whose file is gone would let resolveCatalog answer
   * `unchanged: true` — correctly, by its own contract — and we would keep
   * running on the 8-video seed forever, once a day, silently. Forcing null
   * re-downloads instead.
   */
  const cachedHash = catalogFile().exists ? (mmkv.getString(HASH_KEY) ?? null) : null;

  try {
    const resolution = await resolveCatalog(fetch, CATALOG_BASE_URL, cachedHash);
    mmkv.set(CHECKED_AT_KEY, String(Date.now()));

    if (resolution.unchanged) return;

    // File first, then the hash: if the process dies between them the hash is
    // stale-but-absent rather than present-but-wrong, and the next run
    // re-downloads. The reverse order would record a hash for a file that was
    // never written.
    persistAtomically(resolution.videos);
    mmkv.set(HASH_KEY, resolution.hash);
    initCatalog(resolution.videos);
  } catch (error) {
    /**
     * The loader's kind split is acted on here, which is what it exists for:
     *
     *   'fetch'    the bytes never arrived — offline, DNS, a 5xx. Transient, so
     *              do NOT stamp checkedAt: retry on the next launch rather than
     *              waiting out the full day.
     *   'content'  the bytes arrived and are wrong. Retrying fetches the same
     *              broken object, so DO stamp checkedAt to stop hammering it,
     *              and log loudly — only a re-publish fixes this.
     */
    if (error instanceof CatalogLoadError) {
      if (error.kind === 'content') {
        mmkv.set(CHECKED_AT_KEY, String(Date.now()));
        console.error(`[loro] published catalog is unusable (${error.url}): ${error.message}`);
      } else {
        console.warn(`[loro] catalog refresh deferred: ${error.message}`);
      }
      return;
    }
    console.error(`[loro] catalog refresh failed unexpectedly: ${String(error)}`);
  }
}
