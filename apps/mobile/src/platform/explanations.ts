import { File, Paths } from 'expo-file-system';
import {
  CatalogLoadError,
  type CatalogFetch,
} from '@loro/core/catalogLoader';
import {
  fetchExplanationsBlob,
  fetchExplanationsPointer,
  type WordExplanation,
} from '@loro/core/explanations';
import { CATALOG_BASE_URL } from './config';
import { mmkv } from './storage';

/**
 * The RN half of the word-explanations loader — platform/catalog.ts's shape,
 * scaled down for content that is NOT boot-critical:
 *
 *   - LAZY. Nothing here runs until the first word-detail sheet asks. No boot
 *     cost, no splash-screen dependency, and a user who never opens a word
 *     detail never downloads the blob.
 *   - NULL IS A NORMAL ANSWER. Offline first launch, a 404 before the first
 *     publish, a broken blob — the sheet renders without its explanation
 *     section and asks again next time. Nothing throws out of here.
 *   - Disk cache + in-memory memo. The blob is a few MB of JSON — far too big
 *     for MMKV (which memory-maps its whole store); the filesystem holds it,
 *     parsed once per process on first ask.
 *
 * MMKV scalars live OUTSIDE the 'loro.' namespace for the same reason the
 * catalog's do (catalog.ts:42-58): this is public content, not user data, and
 * the account-deletion sweep must not desync the hash from the file.
 */

const EXPLANATIONS_FILENAME = 'explanations.json';
const TEMP_FILENAME = 'explanations.json.tmp';

const HASH_KEY = 'explanations.hash';
const CHECKED_AT_KEY = 'explanations.checkedAt';
const BAD_HASH_KEY = 'explanations.badHash';

/** One pointer check a day is plenty for pregenerated reference text. */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

function explanationsFile(): File {
  return new File(Paths.document, EXPLANATIONS_FILENAME);
}

let memo: Map<string, WordExplanation> | null = null;
let inflight: Promise<ReadonlyMap<string, WordExplanation> | null> | null = null;
/** In-memory only: don't re-hit the network on every sheet open after a
    failure — once per process is a fair retry rhythm for a lazy nicety. */
let failedThisProcess = false;

/**
 * The one call the UI makes. Resolves to the lemma -> explanation map, or
 * null when nothing usable is available right now.
 */
export function getExplanations(): Promise<ReadonlyMap<string, WordExplanation> | null> {
  if (memo) return Promise.resolve(memo);
  if (inflight) return inflight;
  if (failedThisProcess) return Promise.resolve(null);
  inflight = load().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function load(): Promise<ReadonlyMap<string, WordExplanation> | null> {
  // 1. Disk. Smoke-tested only — the blob was fully validated by
  // fetchExplanationsBlob before it was ever written, and the atomic move
  // means a half-written file cannot be observed.
  const file = explanationsFile();
  if (file.exists) {
    try {
      const parsed: unknown = JSON.parse(file.textSync());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        memo = new Map(Object.entries(parsed as Record<string, WordExplanation>));
        // A cache is a valid answer; look for a newer publish in the
        // background, throttled to the daily rhythm.
        void refresh(false);
        return memo;
      }
      console.warn('[loro] cached explanations were not an object — dropping them');
    } catch (error) {
      console.warn(`[loro] cached explanations could not be read: ${String(error)}`);
    }
    try {
      file.delete();
      mmkv.remove(HASH_KEY);
    } catch {
      // The next successful refresh overwrites it regardless.
    }
  }

  // 2. Network, unthrottled — there is nothing to show without it.
  await refresh(true);
  if (memo === null) failedThisProcess = true;
  return memo;
}

/** Write-temp-then-move, so a crash mid-write leaves the previous file intact. */
function persistAtomically(record: Record<string, WordExplanation>): void {
  const temp = new File(Paths.document, TEMP_FILENAME);
  if (temp.exists) temp.delete();
  temp.create();
  temp.write(JSON.stringify(record));
  temp.moveSync(explanationsFile(), { overwrite: true });
}

async function refresh(force: boolean): Promise<void> {
  const lastChecked = Number(mmkv.getString(CHECKED_AT_KEY) ?? '0');
  if (!force && Number.isFinite(lastChecked) && Date.now() - lastChecked < REFRESH_INTERVAL_MS) {
    return;
  }

  const cachedHash = explanationsFile().exists
    ? (mmkv.getString(HASH_KEY) ?? null)
    : null;
  let publishedHash: string | null = null;

  try {
    const fetchFn: CatalogFetch = fetch;
    const pointer = await fetchExplanationsPointer(fetchFn, CATALOG_BASE_URL);
    publishedHash = pointer.hash;

    if (cachedHash === publishedHash && memo !== null) {
      mmkv.set(CHECKED_AT_KEY, String(Date.now()));
      return;
    }

    // Same immutable-blob backoff as the catalog: a hash that already came
    // back unusable is not retried inside the window (catalog.ts:201-212).
    if (publishedHash === mmkv.getString(BAD_HASH_KEY)) {
      if (Number.isFinite(lastChecked) && Date.now() - lastChecked < REFRESH_INTERVAL_MS) {
        return;
      }
    }

    const downloaded = await fetchExplanationsBlob(
      fetchFn,
      CATALOG_BASE_URL,
      pointer.hash,
      pointer.count
    );
    mmkv.set(CHECKED_AT_KEY, String(Date.now()));
    mmkv.remove(BAD_HASH_KEY);

    // File first, then the hash — the same crash-ordering rule as the catalog
    // (catalog.ts:241-244).
    persistAtomically(downloaded);
    mmkv.set(HASH_KEY, publishedHash);
    memo = new Map(Object.entries(downloaded));
  } catch (error) {
    if (error instanceof CatalogLoadError) {
      if (error.kind === 'content') {
        mmkv.set(CHECKED_AT_KEY, String(Date.now()));
        if (publishedHash !== null) mmkv.set(BAD_HASH_KEY, publishedHash);
        console.error(`[loro] published explanations are unusable (${error.url}): ${error.message}`);
      } else {
        // Offline, DNS, or simply not published yet (the pointer 404s until
        // the first publish) — quiet, transient, retry another time.
        console.warn(`[loro] explanations refresh deferred: ${error.message}`);
      }
      return;
    }
    console.error(`[loro] explanations refresh failed unexpectedly: ${String(error)}`);
  }
}
