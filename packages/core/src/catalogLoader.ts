// Relative and extension-ed, not '@/lib/…': core's modules load under plain
// node for their tests (same rule as starter/deck.ts).
import type { Video } from './types.ts';

/**
 * The remote catalog loader: fetch the published snapshot and turn it into
 * Video[], or fail loudly.
 *
 * PURE, AND DELIBERATELY INERT. It reads nothing global, writes nothing, and
 * touches neither the catalog seam (catalog.ts) nor any storage. fetch and the
 * base URL are both injected, so this module runs unchanged in a browser, in
 * React Native, and under `node --test` with a fake fetch — which is the only
 * reason its failure modes can be tested at all. The platform calls
 * resolveCatalog(), persists what comes back, and hands the videos to
 * initCatalog(); none of that is this module's business.
 *
 * THE TWO OBJECTS (published by scripts/publish-catalog.mts):
 *
 *   catalog/latest.json   the mutable pointer — {hash, count, generatedAt}
 *   catalog/<hash>.json   the immutable snapshot — the whole Video[]
 *
 * CLIENTS KEY ON THE HASH, NEVER ON THE POINTER'S BYTES. generatedAt is
 * rewritten on every publish even when the content is identical, so comparing
 * pointer bytes (or its mtime, or an ETag on latest.json) would report a new
 * version every single time and re-download ~0.9MB for nothing. The hash is
 * the sha256 of the snapshot body, so it changes if and only if the content
 * does. generatedAt is read past and ignored here on purpose.
 *
 * The pointer request itself does NOT disappear when nothing has changed. The
 * publisher can only set max-age (the Storage SDK has no way to add the
 * `immutable` directive), so a revalidating client gets a cheap 304 rather
 * than skipping the call. What this module guarantees is narrower and is the
 * part that matters: when the hash is unchanged, THE BLOB IS NOT FETCHED.
 *
 * VALIDATION IS THE POINT. A truncated download that happens to parse is worse
 * than one that fails outright: it would install a catalog with holes in it,
 * and nothing downstream could tell that from a genuinely short catalog. So
 * every failure here is an exception and there is no partial-success path —
 * this module never returns a short or empty Video[] as success.
 *
 * That failure policy is the opposite of the other untrusted-JSON parsers in
 * core (parseStarterEvents, sanitizePaywallLog), which drop bad entries and
 * keep going. Those read a LOCAL log where a lost event costs a row of
 * telemetry; this reads the content the whole app renders, where a dropped
 * entry is a missing video nobody would ever notice.
 */

// ------------------------------------------------------------------ errors

/**
 * Base for everything this module throws, so a caller that only wants "the
 * catalog didn't load" can catch one type.
 *
 * The `kind` split is not cosmetic — step 5 must treat the two differently:
 *
 *   'fetch'    the bytes never arrived: offline, DNS, a 5xx, a 404 because the
 *              pointer names a blob that is not up yet. TRANSIENT. Keep the
 *              cache, try again later, say nothing to the user.
 *   'content'  the bytes arrived and are wrong: unparseable, the wrong shape,
 *              or the wrong length. NOT transient — retrying the same hash
 *              fetches the same broken object. Keep the cache, stop retrying
 *              this hash, and surface it: something is wrong with what was
 *              published, and only a human can fix it.
 */
export class CatalogLoadError extends Error {
  readonly kind: 'fetch' | 'content';
  /** The object that failed, for the log line that will be all anyone has. */
  readonly url: string;

  constructor(kind: 'fetch' | 'content', url: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CatalogLoadError';
    this.kind = kind;
    this.url = url;
  }
}

/** The bytes never arrived. Transient — the platform retries. */
export class CatalogFetchError extends CatalogLoadError {
  /** HTTP status, or undefined when fetch itself threw (offline, DNS). */
  readonly status: number | undefined;

  constructor(url: string, message: string, status?: number, options?: { cause?: unknown }) {
    super('fetch', url, message, options);
    this.name = 'CatalogFetchError';
    this.status = status;
  }
}

/** The bytes arrived and are not a usable catalog. Not transient. */
export class CatalogContentError extends CatalogLoadError {
  constructor(url: string, message: string) {
    super('content', url, message);
    this.name = 'CatalogContentError';
  }
}

// ------------------------------------------------------------------ shapes

/**
 * The minimum of the Response interface this module uses.
 *
 * Structural, not DOM's Response: core must not depend on the DOM lib, and RN's
 * fetch, the browser's, and a fake one in a test all satisfy this. text()
 * rather than json() so a parse failure is reported here as a content error
 * with the object's URL attached, instead of arriving as an opaque SyntaxError.
 */
export type CatalogResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type CatalogFetch = (url: string) => Promise<CatalogResponse>;

/** catalog/latest.json. `generatedAt` is carried for humans and ignored here. */
export type CatalogPointer = {
  hash: string;
  count: number;
  generatedAt: string;
};

export type CatalogResolution =
  | { unchanged: true }
  | { unchanged: false; hash: string; videos: Video[] };

/**
 * The object paths — THE single declaration, for both sides of the contract.
 *
 * scripts/lib/catalog.mts re-exports these rather than declaring its own, so
 * the publisher that writes the objects and the client that reads them cannot
 * drift apart. They must not: a disagreement here means the client 404s
 * forever while the publisher reports success, with nothing failing on either
 * side to say so.
 */
export const POINTER_PATH = 'catalog/latest.json';

export function snapshotPath(hash: string): string {
  return `catalog/${hash}.json`;
}

// ------------------------------------------------------------------ helpers
// Exported (not just used here) because the explanations loader
// (explanations.ts) reads sibling objects from the same bucket and must share
// this module's transport behaviour and error taxonomy exactly.

export function joinUrl(baseUrl: string, objectPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${objectPath}`;
}

/** GET a URL and return its body, or throw a typed fetch error. */
export async function getText(fetchFn: CatalogFetch, url: string): Promise<string> {
  let response: CatalogResponse;
  try {
    response = await fetchFn(url);
  } catch (error) {
    // Offline, DNS, TLS, an aborted request — never reached the server.
    throw new CatalogFetchError(url, `catalog request failed: ${String(error)}`, undefined, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new CatalogFetchError(url, `catalog request failed with ${response.status}`, response.status);
  }
  try {
    return await response.text();
  } catch (error) {
    // The body died mid-read: a dropped connection, not bad content.
    throw new CatalogFetchError(url, `catalog body could not be read: ${String(error)}`, response.status, {
      cause: error,
    });
  }
}

export function parseJson(url: string, body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    // A truncated download very often lands here — JSON.parse is the first
    // thing that notices a body cut mid-array.
    throw new CatalogContentError(url, `not valid JSON (${String(error)})`);
  }
}

// ----------------------------------------------------------------- pointer

/** Validate the parsed pointer, or throw. Only the fields we depend on. */
function assertPointer(url: string, value: unknown): CatalogPointer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogContentError(url, 'pointer is not an object');
  }
  const raw = value as Partial<CatalogPointer>;
  if (typeof raw.hash !== 'string' || raw.hash.trim() === '') {
    throw new CatalogContentError(url, 'pointer has no hash');
  }
  if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 0) {
    throw new CatalogContentError(url, `pointer count is not a non-negative integer (${String(raw.count)})`);
  }
  return {
    hash: raw.hash,
    count: raw.count,
    // Not validated and not depended on — see the header. Kept as a string so
    // the field is always the declared type for anyone logging it.
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
  };
}

/**
 * Fetch and validate a {hash, count, generatedAt} pointer at any object path.
 * The catalog and the explanations blob share this pointer shape and
 * publishing discipline (blob first, pointer last), so they share the fetch.
 */
export async function fetchPointerAt(
  fetchFn: CatalogFetch,
  baseUrl: string,
  pointerPath: string
): Promise<CatalogPointer> {
  const url = joinUrl(baseUrl, pointerPath);
  return assertPointer(url, parseJson(url, await getText(fetchFn, url)));
}

/** Fetch and validate catalog/latest.json. */
export async function fetchPointer(
  fetchFn: CatalogFetch,
  baseUrl: string
): Promise<CatalogPointer> {
  return fetchPointerAt(fetchFn, baseUrl, POINTER_PATH);
}

// -------------------------------------------------------------------- blob

/**
 * Validate one entry as a Video.
 *
 * Three fields, chosen because each one has a concrete failure behind it:
 *
 *   id       resolves saved words (loro_saved_words.video_id), the replay deep
 *            link and every per-video count. An entry without one is unusable.
 *   cues     the transcript. Not an array means the subtitle track, the blank
 *            planners and the starter planner all throw on first touch.
 *   author   the FeedAuthor union. Checked because this exact field has already
 *            shipped broken once: /welcome cast raw JSON to Video[], handed
 *            VideoSlide entries with no author, and crashed AuthorLine for
 *            every onboarding user (see catalog/staticVideos.ts). A catalog
 *            that can carry that again should fail at the loader, not at render.
 *
 * Deliberately NOT exhaustive: src/poster/level/dictionary are not checked,
 * because a stricter validator would reject a snapshot published by a newer
 * publisher for no real reason. This is a smoke test for corruption, not a
 * schema.
 */
function assertVideo(url: string, value: unknown, index: number): Video {
  const where = `entry ${index}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogContentError(url, `${where} is not an object`);
  }
  const raw = value as Partial<Video>;
  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    throw new CatalogContentError(url, `${where} has no id`);
  }
  if (!Array.isArray(raw.cues)) {
    throw new CatalogContentError(url, `${where} ("${raw.id}") has no cues array`);
  }
  const author = raw.author as { kind?: unknown } | undefined;
  if (!author || typeof author !== 'object' || typeof author.kind !== 'string') {
    throw new CatalogContentError(url, `${where} ("${raw.id}") has no author.kind`);
  }
  return value as Video;
}

/**
 * Fetch and validate catalog/<hash>.json.
 *
 * `expectedCount` is THE TRUNCATION CHECK and is required rather than optional
 * — an optional guard is one that gets forgotten, and this is the single thing
 * standing between a half-downloaded catalog and a feed with holes in it. Pass
 * null to skip it explicitly (re-validating a blob whose pointer is not to
 * hand); passing null is then a deliberate act rather than an omission.
 */
export async function fetchCatalogBlob(
  fetchFn: CatalogFetch,
  baseUrl: string,
  hash: string,
  expectedCount: number | null
): Promise<Video[]> {
  const url = joinUrl(baseUrl, snapshotPath(hash));
  const parsed = parseJson(url, await getText(fetchFn, url));

  if (!Array.isArray(parsed)) {
    throw new CatalogContentError(url, 'snapshot is not an array');
  }
  // Length first, before per-entry work: a truncated body that still parses is
  // the failure this whole function exists to catch, and saying "216 expected,
  // 173 received" is a far better error than "entry 173 has no id".
  if (expectedCount !== null && parsed.length !== expectedCount) {
    throw new CatalogContentError(
      url,
      `snapshot holds ${parsed.length} videos, pointer says ${expectedCount} — truncated or stale`
    );
  }
  if (parsed.length === 0) {
    // An empty catalog is never a legitimate publish, and installing one would
    // empty the seam's resting state — the crash catalog.ts exists to prevent.
    throw new CatalogContentError(url, 'snapshot is empty');
  }

  return parsed.map((entry, index) => assertVideo(url, entry, index));
}

// ----------------------------------------------------------------- resolve

/**
 * The one call a platform makes: what should be installed right now?
 *
 *   { unchanged: true }              the published hash matches what the caller
 *                                    already has. THE BLOB IS NOT FETCHED.
 *   { unchanged: false, hash, videos }  a different (or first) catalog, fully
 *                                    validated. The caller persists both the
 *                                    hash and the videos, then calls
 *                                    initCatalog(videos).
 *
 * Throws rather than falling back: this module cannot know whether the caller
 * has a usable cache, a bundled seed, or nothing at all, so choosing between
 * them is the platform's decision and not one to make silently here.
 */
export async function resolveCatalog(
  fetchFn: CatalogFetch,
  baseUrl: string,
  cachedHash: string | null
): Promise<CatalogResolution> {
  const pointer = await fetchPointer(fetchFn, baseUrl);
  if (cachedHash !== null && cachedHash === pointer.hash) {
    return { unchanged: true };
  }
  const videos = await fetchCatalogBlob(fetchFn, baseUrl, pointer.hash, pointer.count);
  return { unchanged: false, hash: pointer.hash, videos };
}
