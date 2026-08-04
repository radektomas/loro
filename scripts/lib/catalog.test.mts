import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSnapshot,
  canonical,
  embedRow,
  findProblem,
  sameRow,
  seedRow,
  snapshotPath,
  SNAPSHOT_HASH_LENGTH,
  toVideo,
  type CatalogRow,
  type EmbedEntry,
  type SeedEntry,
} from './catalog.mts';

const cue = (text = 'hola') => ({
  start: 0,
  end: 1,
  words: [{ text, start: 0, end: 0.5 }],
  translations: { en: 'hi', cs: 'ahoj' },
});

const gloss = (en = 'hi') => ({
  lemma: 'hola',
  pos: 'other',
  note: null,
  glosses: { en, cs: 'ahoj' },
});

const seed = (over: Partial<SeedEntry> = {}): SeedEntry => ({
  id: 'seed-1',
  src: 'seed-1.mp4',
  poster: 'seed-1.jpg',
  creator: 'Loro',
  level: 'A2',
  cues: [cue()],
  dictionary: { hola: gloss() },
  ...over,
});

const embed = (over: Partial<EmbedEntry> = {}): EmbedEntry => ({
  id: 'AQRWt2bNMHo',
  youtubeId: 'AQRWt2bNMHo',
  creator: 'Canal',
  level: 'B1',
  durationSeconds: 31.5,
  thumbnailUrl: 'https://i.ytimg.com/vi/AQRWt2bNMHo/hq.jpg',
  attribution: {
    channelTitle: 'Canal',
    channelUrl: 'https://www.youtube.com/channel/UC1',
    videoUrl: 'https://www.youtube.com/watch?v=AQRWt2bNMHo',
    license: 'creativeCommon',
  },
  cues: [cue()],
  dictionary: { hola: gloss() },
  ...over,
});

/** Reverse every object's key order, recursively — what a jsonb round trip
    does to a row, and what an unstable serializer would trip over. */
function reorderKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reorderKeys);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, reorderKeys(v)])
      .reverse()
  );
}

describe('canonical', () => {
  it('is insensitive to object key order, at every depth', () => {
    const rows = [seedRow(seed()), embedRow(embed())];
    assert.equal(canonical(rows), canonical(reorderKeys(rows)));
  });

  it('is sensitive to a real content change', () => {
    const a = seedRow(seed());
    const b = seedRow(seed({ dictionary: { hola: gloss('hello') } }));
    assert.notEqual(canonical(a), canonical(b));
  });

  it('is sensitive to array order — order is content', () => {
    const x = seedRow(seed({ id: 'a' }));
    const y = seedRow(seed({ id: 'b' }));
    assert.notEqual(canonical([x, y]), canonical([y, x]));
  });

  it('drops undefined-valued keys, matching JSON.stringify', () => {
    assert.equal(canonical({ a: 1, b: undefined }), canonical({ a: 1 }));
  });

  it('would be wrong as a plain JSON.stringify', () => {
    // The reason this function exists: the naive version reports a reordered
    // row as changed, which would mean re-publishing all 216 rows every run.
    const row = seedRow(seed());
    assert.notEqual(JSON.stringify(row), JSON.stringify(reorderKeys(row)));
  });
});

describe('sameRow', () => {
  it('matches a row that came back with its keys reordered', () => {
    const row = embedRow(embed());
    assert.equal(sameRow(row, reorderKeys(row) as Record<string, unknown>), true);
  });

  it('treats numeric-as-string from PostgREST as equal', () => {
    // duration_seconds is `numeric`, and PostgREST serializes it as "31.5".
    const row = embedRow(embed());
    const remote = { ...row, duration_seconds: '31.5' } as unknown as Record<string, unknown>;
    assert.equal(sameRow(row, remote), true);
  });

  it('still notices a changed duration', () => {
    const row = embedRow(embed());
    const remote = { ...row, duration_seconds: '32' } as unknown as Record<string, unknown>;
    assert.equal(sameRow(row, remote), false);
  });

  it('notices a changed gloss buried in the dictionary', () => {
    const row = embedRow(embed());
    const remote = {
      ...row,
      dictionary: { hola: gloss('hello') },
    } as unknown as Record<string, unknown>;
    assert.equal(sameRow(row, remote), false);
  });
});

describe('toVideo', () => {
  it('rebuilds the youtube author union for an embed', () => {
    const video = toVideo(embedRow(embed()));
    assert.deepEqual(video.author, {
      kind: 'youtube',
      channelTitle: 'Canal',
      channelUrl: 'https://www.youtube.com/channel/UC1',
      videoUrl: 'https://www.youtube.com/watch?v=AQRWt2bNMHo',
      license: 'creativeCommon',
    });
    // src is '' for an embed, never null: Feed branches on youtubeId long
    // before it reads src, and a null would reach the DOM as "null".
    assert.equal(video.src, '');
    assert.equal(video.poster, 'https://i.ytimg.com/vi/AQRWt2bNMHo/hq.jpg');
    assert.equal(video.youtubeId, 'AQRWt2bNMHo');
    assert.equal(video.durationSeconds, 31.5);
  });

  it('rebuilds the none author for a seed, with no embed-only keys', () => {
    const video = toVideo(seedRow(seed()));
    assert.deepEqual(video.author, { kind: 'none' });
    assert.equal(video.src, 'seed-1.mp4');
    assert.equal(video.poster, 'seed-1.jpg');
    // ABSENT, not null — staticVideos.ts sets neither, and a null would make
    // Feed treat a seed as an embed with a missing id.
    assert.ok(!('youtubeId' in video));
    assert.ok(!('durationSeconds' in video));
  });
});

describe('buildSnapshot — the hash is the version identity', () => {
  const rows: CatalogRow[] = [seedRow(seed()), embedRow(embed())];

  it('is stable: the same rows hash the same, every time', () => {
    // THE INVARIANT THE WHOLE IMMUTABLE-URL MODEL RESTS ON. If this drifts,
    // every publish renames the snapshot and re-downloads ~0.9MB to every
    // user, and nothing about that is visible from the outside.
    assert.equal(buildSnapshot(rows).hash, buildSnapshot(rows).hash);
  });

  it('is stable across a key-order round trip', () => {
    const reordered = reorderKeys(rows) as CatalogRow[];
    assert.equal(buildSnapshot(rows).hash, buildSnapshot(reordered).hash);
  });

  it('changes when a single gloss changes', () => {
    const changed: CatalogRow[] = [
      seedRow(seed({ dictionary: { hola: gloss('hello') } })),
      embedRow(embed()),
    ];
    assert.notEqual(buildSnapshot(rows).hash, buildSnapshot(changed).hash);
  });

  it('changes when a single word timing moves', () => {
    const shifted = structuredClone(rows);
    shifted[0].cues[0].words[0].end = 0.51;
    assert.notEqual(buildSnapshot(rows).hash, buildSnapshot(shifted).hash);
  });

  it('changes when the videos are reordered', () => {
    // The hash names the BYTES, not a set of videos — a reshuffled catalog is
    // a different download and must get a different name.
    assert.notEqual(
      buildSnapshot(rows).hash,
      buildSnapshot([rows[1], rows[0]]).hash
    );
  });

  it('reports counts per kind and a parseable body', () => {
    const snapshot = buildSnapshot(rows);
    assert.equal(snapshot.count, 2);
    assert.deepEqual(snapshot.byKind, { seed: 1, embed: 1 });
    const parsed = JSON.parse(snapshot.body);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].id, 'seed-1');
  });

  it('hashes to a fixed-length hex name', () => {
    const { hash } = buildSnapshot(rows);
    assert.equal(hash.length, SNAPSHOT_HASH_LENGTH);
    assert.match(hash, /^[0-9a-f]+$/);
    assert.equal(snapshotPath(hash), `catalog/${hash}.json`);
  });
});

describe('findProblem', () => {
  const ok = (): CatalogRow[] => [seedRow(seed()), embedRow(embed())];

  it('passes a well-formed catalog', () => {
    assert.equal(findProblem(ok()), null);
  });

  it('rejects a duplicate id — it would silently collapse on upsert', () => {
    const rows = [seedRow(seed()), seedRow(seed())];
    assert.match(findProblem(rows)?.reason ?? '', /duplicate id/);
    assert.equal(findProblem(rows)?.id, 'seed-1');
  });

  it('rejects an empty id, naming the index', () => {
    const rows = [seedRow(seed({ id: '  ' }))];
    assert.match(findProblem(rows)?.id ?? '', /index 0/);
  });

  it('rejects a non-array or empty cues', () => {
    assert.match(
      findProblem([seedRow(seed({ cues: undefined as never }))])?.reason ?? '',
      /not an array/
    );
    assert.match(
      findProblem([seedRow(seed({ cues: [] }))])?.reason ?? '',
      /empty/
    );
  });

  it('rejects a missing dictionary', () => {
    assert.match(
      findProblem([seedRow(seed({ dictionary: undefined as never }))])?.reason ?? '',
      /dictionary is missing/
    );
  });

  it('rejects a non-CEFR level', () => {
    assert.match(
      findProblem([seedRow(seed({ level: 'C1' }))])?.reason ?? '',
      /not one of A1/
    );
  });

  it('rejects an embed missing any TASL field', () => {
    // Each of these makes the attribution line unlawful, so each must abort
    // the publish rather than reach a slide.
    const fields = ['channelTitle', 'channelUrl', 'videoUrl'] as const;
    for (const field of fields) {
      const rows = [embedRow(embed({ attribution: { ...embed().attribution, [field]: '' } }))];
      assert.ok(findProblem(rows), `missing ${field} must be rejected`);
    }
    const badLicense = [
      embedRow(embed({ attribution: { ...embed().attribution, license: 'all-rights' } })),
    ];
    assert.match(findProblem(badLicense)?.reason ?? '', /license/);
  });

  it('rejects a seed with no src', () => {
    assert.match(
      findProblem([seedRow(seed({ src: '' }))])?.reason ?? '',
      /seed has no src/
    );
  });
});
