import { createHash } from 'node:crypto';

/**
 * The catalog's pure half: JSON entry -> table row -> Video, validation, the
 * canonical serialization, and the snapshot hash.
 *
 * Split out of scripts/publish-catalog.mts so the parts that decide WHAT gets
 * published can be tested without a database or a network — and specifically so
 * the snapshot hash has a committed test. The hash is the version identity of
 * the whole catalog: if it is unstable, every publish invalidates every
 * client's cache and re-downloads ~0.9MB to every user for no reason, and
 * nothing about that failure is visible from the outside.
 *
 * Nothing here reads a file, touches env, prints, or exits. The script owns all
 * of that.
 */

// ------------------------------------------------------------------- shapes

export type Cue = {
  start: number;
  end: number;
  words: { text: string; start: number; end: number }[];
  translations: Record<string, string>;
};

export type Gloss = {
  lemma: string;
  pos: string;
  note: string | null;
  glosses: Record<string, string>;
};

/** One entry of data/videos.json. */
export type SeedEntry = {
  id: string;
  src: string;
  poster: string;
  creator: string;
  level: string;
  cues: Cue[];
  dictionary: Record<string, Gloss>;
};

/** One entry of data/embedVideos.json. */
export type EmbedEntry = {
  id: string;
  youtubeId: string;
  creator: string;
  level: string;
  durationSeconds: number;
  thumbnailUrl: string;
  attribution: {
    channelTitle: string;
    channelUrl: string;
    videoUrl: string;
    license: string;
  };
  cues: Cue[];
  dictionary: Record<string, Gloss>;
};

/** One row of loro_catalog_videos, exactly as the table declares it. */
export type CatalogRow = {
  id: string;
  kind: 'embed' | 'seed';
  creator: string;
  level: string;
  src: string | null;
  poster: string | null;
  youtube_id: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  attribution_channel_title: string | null;
  attribution_channel_url: string | null;
  attribution_video_url: string | null;
  attribution_license: string | null;
  cues: Cue[];
  dictionary: Record<string, Gloss>;
};

/**
 * The app's Video, as @loro/core/types declares it. Restated here rather than
 * imported: these scripts run under plain node with type stripping, and the
 * core module reaches for the bundler alias. The snapshot test pins the two
 * against each other by shape.
 */
export type SnapshotVideo = {
  id: string;
  src: string;
  poster: string;
  creator: string;
  author:
    | { kind: 'none' }
    | {
        kind: 'youtube';
        channelTitle: string;
        channelUrl: string;
        videoUrl: string;
        license: string;
      };
  level: string;
  cues: Cue[];
  dictionary: Record<string, Gloss>;
  youtubeId?: string;
  durationSeconds?: number;
};

export const LEVELS = new Set(['A1', 'A2', 'B1', 'B2']);
export const LICENSES = new Set(['creativeCommon', 'youtube']);

/** The columns the publish diff compares. created_at/updated_at are excluded
    on purpose — they are bookkeeping, and including them would report every
    row as changed on every run. */
export const COMPARED_COLUMNS = [
  'id',
  'kind',
  'creator',
  'level',
  'src',
  'poster',
  'youtube_id',
  'thumbnail_url',
  'duration_seconds',
  'attribution_channel_title',
  'attribution_channel_url',
  'attribution_video_url',
  'attribution_license',
  'cues',
  'dictionary',
] as const;

// ------------------------------------------------------------ JSON -> row

export function seedRow(entry: SeedEntry): CatalogRow {
  return {
    id: entry.id,
    kind: 'seed',
    creator: entry.creator,
    level: entry.level,
    src: entry.src,
    poster: entry.poster ?? '',
    youtube_id: null,
    thumbnail_url: null,
    duration_seconds: null,
    attribution_channel_title: null,
    attribution_channel_url: null,
    attribution_video_url: null,
    attribution_license: null,
    cues: entry.cues,
    dictionary: entry.dictionary,
  };
}

export function embedRow(entry: EmbedEntry): CatalogRow {
  return {
    id: entry.id,
    kind: 'embed',
    creator: entry.creator,
    level: entry.level,
    // An embed's Video.src is '' — the slide renders the iframe. Stored as
    // null rather than '' so "no media file" is one value, not two.
    src: null,
    poster: null,
    youtube_id: entry.youtubeId,
    thumbnail_url: entry.thumbnailUrl,
    duration_seconds: entry.durationSeconds,
    attribution_channel_title: entry.attribution?.channelTitle ?? null,
    attribution_channel_url: entry.attribution?.channelUrl ?? null,
    attribution_video_url: entry.attribution?.videoUrl ?? null,
    attribution_license: entry.attribution?.license ?? null,
    cues: entry.cues,
    dictionary: entry.dictionary,
  };
}

// ---------------------------------------------------------------- validate

export type CatalogProblem = { id: string; reason: string };

/**
 * The FIRST thing wrong with the rows, or null.
 *
 * First rather than all, because the caller's contract is to abort: a partial
 * catalog is worse than no catalog — a client that fetched one would render a
 * feed with holes and have no way to tell that from a short catalog. Every rule
 * here is one the table's own constraints also enforce; checking first is what
 * makes the failure name the id and the source file instead of arriving as a
 * Postgres constraint violation mid-batch.
 */
export function findProblem(rows: readonly CatalogRow[]): CatalogProblem | null {
  const seen = new Map<string, number>();

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const id = typeof row.id === 'string' ? row.id : '';
    const bad = (reason: string): CatalogProblem => ({
      id: id.trim() ? id : `<index ${index}>`,
      reason,
    });

    if (!id.trim()) return bad('id is empty or not a string');

    // A duplicate id would silently collapse two videos into one row on
    // upsert — the catalog would come back one video short with no error.
    const first = seen.get(id);
    if (first !== undefined) return bad(`duplicate id (also at index ${first})`);
    seen.set(id, index);

    if (!Array.isArray(row.cues)) return bad('cues is not an array');
    if (row.cues.length === 0) return bad('cues is empty — not a playable slide');
    if (!row.dictionary || typeof row.dictionary !== 'object') {
      return bad('dictionary is missing');
    }
    if (!row.creator?.trim()) return bad('creator is empty');
    if (!LEVELS.has(row.level)) {
      return bad(`level "${row.level}" is not one of A1/A2/B1/B2`);
    }

    // Kind-specific completeness. The embed half is the one that matters: a
    // slide missing any TASL field cannot render a lawful attribution line,
    // and that must fail here rather than on a user's screen.
    if (row.kind === 'embed') {
      if (!row.youtube_id?.trim()) return bad('embed has no youtube_id');
      if (!row.thumbnail_url?.trim()) return bad('embed has no thumbnail_url');
      if (!row.attribution_channel_title?.trim()) return bad('embed has no attribution channelTitle');
      if (!row.attribution_channel_url?.trim()) return bad('embed has no attribution channelUrl');
      if (!row.attribution_video_url?.trim()) return bad('embed has no attribution videoUrl');
      if (!row.attribution_license || !LICENSES.has(row.attribution_license)) {
        return bad(`attribution license "${row.attribution_license}" is not creativeCommon|youtube`);
      }
    } else if (row.kind === 'seed') {
      if (!row.src?.trim()) return bad('seed has no src');
    } else {
      return bad(`unknown kind "${String(row.kind)}"`);
    }
  }

  return null;
}

// --------------------------------------------------------------- canonical

/**
 * Stable stringify with recursively sorted object keys.
 *
 * TWO JOBS, both load-bearing:
 *
 * 1. The publish diff. jsonb does not preserve key order, so a row read back
 *    from Postgres has the same content as the file with its keys in a
 *    different order. A plain JSON.stringify comparison would report all 216
 *    rows as changed on every single run.
 * 2. The snapshot hash. The hash names the file, and an unstable serialization
 *    means a new hash on every publish — a fresh ~0.9MB download for every
 *    user, every time, forever, with nothing to show for it.
 *
 * undefined-valued keys are dropped, matching JSON.stringify, so an absent
 * optional field and an explicitly-undefined one serialize identically.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** Does this row already match what the table holds? */
export function sameRow(
  local: CatalogRow,
  remote: Record<string, unknown>
): boolean {
  for (const column of COMPARED_COLUMNS) {
    if (column === 'duration_seconds') {
      // numeric comes back from PostgREST as a string ("31.5"), so compare the
      // NUMBER rather than its representation.
      const a = local[column];
      const b = remote[column];
      const an = a === null ? null : Number(a);
      const bn = b === null || b === undefined ? null : Number(b);
      if (an !== bn) return false;
      continue;
    }
    if (canonical(local[column]) !== canonical(remote[column] ?? null)) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- snapshot

/**
 * A row as the app's Video — the exact shape the client's catalog seam takes,
 * so the snapshot needs no mapping on the way in: JSON.parse and hand it to
 * initCatalog().
 *
 * This mirrors packages/core/src/catalog/{staticVideos,embedVideos}.ts field
 * for field, including the two things that are easy to get subtly wrong: an
 * embed's src is '' (never null — Feed branches on youtubeId long before it
 * reads src), and a seed carries NO youtubeId/durationSeconds keys at all
 * rather than null ones.
 */
export function toVideo(row: CatalogRow): SnapshotVideo {
  const base = {
    id: row.id,
    src: row.src ?? '',
    poster: (row.kind === 'embed' ? row.thumbnail_url : row.poster) ?? '',
    creator: row.creator,
    level: row.level,
    cues: row.cues,
    dictionary: row.dictionary,
  };
  if (row.kind === 'seed') {
    return { ...base, author: { kind: 'none' } };
  }
  return {
    ...base,
    author: {
      kind: 'youtube',
      channelTitle: row.attribution_channel_title ?? '',
      channelUrl: row.attribution_channel_url ?? '',
      videoUrl: row.attribution_video_url ?? '',
      license: row.attribution_license ?? '',
    },
    youtubeId: row.youtube_id ?? '',
    durationSeconds: row.duration_seconds ?? 0,
  };
}

/** Hex characters kept from the sha256. 16 hex = 64 bits of the digest, which
    is a collision space this catalog will never approach, and it keeps the
    object path readable. */
export const SNAPSHOT_HASH_LENGTH = 16;

export type Snapshot = {
  /** The bytes uploaded, verbatim. */
  body: string;
  /** sha256 of `body`, truncated. Names the object. */
  hash: string;
  count: number;
  byKind: { seed: number; embed: number };
  /**
   * Every id in `body`, in the same order. Written to MANIFEST_PATH for
   * /admin/catalog, which needs to tell the live catalog apart from rows the
   * table keeps after a removal.
   *
   * Carried on the Snapshot rather than recomputed at the upload site so the
   * manifest and the blob are derived from ONE list. A separately derived id
   * list is a second source of truth that can disagree with the bytes it
   * claims to describe, which is exactly the failure the pointer/blob ordering
   * elsewhere in this file exists to prevent.
   */
  ids: readonly string[];
};

/**
 * Build the snapshot from rows.
 *
 * ARRAY ORDER IS PART OF THE CONTENT, and it is the order the caller passes —
 * seeds then embeds, each in source-file order, which is exactly what
 * localVideos gives the web today. The hash is taken over the bytes that are
 * actually uploaded, so a reordering produces a new hash and a new object.
 * That is the honest behaviour: the hash identifies the bytes, not a
 * set-of-videos abstraction over them.
 */
export function buildSnapshot(rows: readonly CatalogRow[]): Snapshot {
  const videos = rows.map(toVideo);
  const body = canonical(videos);
  return {
    body,
    hash: createHash('sha256')
      .update(body, 'utf8')
      .digest('hex')
      .slice(0, SNAPSHOT_HASH_LENGTH),
    count: videos.length,
    byKind: {
      seed: rows.filter((r) => r.kind === 'seed').length,
      embed: rows.filter((r) => r.kind === 'embed').length,
    },
    ids: videos.map((v) => v.id),
  };
}

/** The mutable pointer object: the only thing in the bucket that ever changes. */
export type CatalogPointer = {
  hash: string;
  count: number;
  /** ISO 8601. Provenance for a human reading the bucket; readers key on hash. */
  generatedAt: string;
};

/**
 * The bucket. Publisher-side only, and therefore declared here: the client is
 * handed a base URL that already names it, so the loader never needs it.
 */
export const SNAPSHOT_BUCKET = 'loro-catalog';

/**
 * The object paths come from the LOADER, which owns them.
 *
 * The publisher and the client have to agree on these two strings exactly, and
 * a disagreement is the worst kind: the client 404s forever while the publisher
 * reports success. They were briefly declared in both places; now there is one
 * declaration and this is a re-export, so drift is not expressible.
 *
 * Relative and extension-ed because these scripts run under plain node, outside
 * the bundler's alias — the same specifier style scripts/lib/glossCues.mts
 * already uses to reach core.
 */
export {
  MANIFEST_PATH,
  POINTER_PATH,
  snapshotPath,
} from '../../packages/core/src/catalogLoader.ts';
