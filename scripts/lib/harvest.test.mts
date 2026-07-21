import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  batchIds,
  bestThumbnail,
  parseCount,
  parseIsoDuration,
  QuotaMeter,
  type YouTubeVideo,
} from './youtube.mts';
import { mapVideoToCandidate, sanitizeText, toStoredLicense } from './candidates.mts';
import {
  buildMatrix,
  comboKey,
  pacificMidnightUtc,
  resolveResumeIndex,
} from './harvestState.mts';
import {
  SWEPT_LICENSE_BRANCHES,
  TOPICS,
  QUOTA_COST,
  type Topic,
} from '../config/harvest-queries.mts';

/**
 * Tests for the parts the harvest's correctness actually rests on: quota
 * accounting, the resume cursor, and the license mapping. All pure — no
 * network, no database, no API key.
 */

describe('parseIsoDuration', () => {
  it('parses the shapes YouTube actually returns', () => {
    assert.equal(parseIsoDuration('PT45S'), 45);
    assert.equal(parseIsoDuration('PT1M12S'), 72);
    assert.equal(parseIsoDuration('PT1H2M3S'), 3_723);
    assert.equal(parseIsoDuration('PT2M'), 120);
  });

  it('returns null rather than guessing on junk', () => {
    // A null duration is rejected as 'duration_unknown'; a wrong 0 would be
    // silently mis-bucketed as 'too short'.
    assert.equal(parseIsoDuration(undefined), null);
    assert.equal(parseIsoDuration(''), null);
    assert.equal(parseIsoDuration('PT'), null);
    assert.equal(parseIsoDuration('banana'), null);
  });

  it('handles the degenerate P0D livestream placeholder', () => {
    assert.equal(parseIsoDuration('P0D'), 0);
  });
});

describe('parseCount', () => {
  it('parses stringified counts', () => {
    assert.equal(parseCount('12345'), 12_345);
  });

  it('distinguishes hidden (undefined) from zero', () => {
    assert.equal(parseCount(undefined), null);
    assert.equal(parseCount('0'), 0);
  });
});

describe('bestThumbnail', () => {
  it('prefers the largest available rendition', () => {
    assert.equal(
      bestThumbnail({
        default: { url: 'small.jpg' },
        maxres: { url: 'big.jpg' },
      }),
      'big.jpg'
    );
  });

  it('falls back down the ladder and tolerates absence', () => {
    assert.equal(bestThumbnail({ medium: { url: 'm.jpg' } }), 'm.jpg');
    assert.equal(bestThumbnail(undefined), null);
    assert.equal(bestThumbnail({}), null);
  });
});

describe('toStoredLicense — the legal posture', () => {
  it('maps only the two exact API values', () => {
    assert.equal(toStoredLicense('creativeCommon'), 'creativeCommon');
    assert.equal(toStoredLicense('youtube'), 'youtube');
  });

  it('never coerces an unrecognised value into a usable license', () => {
    // Anything else must surface as unknown so the filter rejects it, rather
    // than being defaulted into the self-hostable branch.
    assert.equal(toStoredLicense(undefined), null);
    assert.equal(toStoredLicense(''), null);
    assert.equal(toStoredLicense('CreativeCommon'), null);
    assert.equal(toStoredLicense('cc'), null);
    assert.equal(toStoredLicense('public_domain'), null);
  });
});

describe('mapVideoToCandidate', () => {
  const video: YouTubeVideo = {
    id: 'abc123',
    snippet: {
      title: 'Receta fácil',
      description: 'Una receta rápida.',
      channelId: 'UC_chan',
      channelTitle: 'Cocina Rápida',
      publishedAt: '2026-01-05T10:00:00Z',
      categoryId: '26',
      defaultAudioLanguage: 'es',
      thumbnails: { high: { url: 'thumb.jpg' } },
    },
    contentDetails: { duration: 'PT58S' },
    statistics: { viewCount: '20000', likeCount: '900' },
    status: { license: 'creativeCommon', embeddable: true },
  };

  it('maps a full video into a discovered candidate', () => {
    const row = mapVideoToCandidate({
      video,
      regionHint: 'MX',
      topicTags: ['food', 'cooking'],
    });
    assert.ok(row);
    assert.equal(row.youtube_id, 'abc123');
    assert.equal(row.duration_seconds, 58);
    assert.equal(row.view_count, 20_000);
    assert.equal(row.like_count, 900);
    assert.equal(row.license, 'creativeCommon');
    assert.equal(row.is_embeddable, true);
    assert.equal(row.region_hint, 'MX');
    assert.deepEqual(row.topic_tags, ['food', 'cooking']);
    assert.equal(row.thumbnail_url, 'thumb.jpg');
    // New rows always enter unjudged; the filter is a separate step.
    assert.equal(row.status, 'discovered');
    assert.equal(row.reject_reason, null);
  });

  it('degrades to nulls instead of throwing on a sparse video', () => {
    const row = mapVideoToCandidate({
      video: { id: 'sparse' },
      regionHint: 'AR',
      topicTags: [],
    });
    assert.ok(row);
    assert.equal(row.title, null);
    assert.equal(row.duration_seconds, null);
    assert.equal(row.view_count, null);
    assert.equal(row.license, null);
    assert.equal(row.is_embeddable, null);
  });

  it('skips a video with no id', () => {
    assert.equal(
      mapVideoToCandidate({ video: {}, regionHint: 'ES', topicTags: [] }),
      null
    );
  });

  it('truncates runaway descriptions', () => {
    const row = mapVideoToCandidate({
      video: { id: 'x', snippet: { description: 'a'.repeat(5_000) } },
      regionHint: 'ES',
      topicTags: [],
    });
    assert.ok(row?.description);
    assert.equal(row.description.length, 1_000);
  });

  it('falls back to defaultLanguage when the audio language is absent', () => {
    const row = mapVideoToCandidate({
      video: { id: 'y', snippet: { defaultLanguage: 'es-CO' } },
      regionHint: 'CO',
      topicTags: [],
    });
    assert.equal(row?.default_audio_language, 'es-CO');
  });
});

describe('buildMatrix', () => {
  it('covers every query x per-topic region x swept license', () => {
    const expected = TOPICS.reduce(
      (n, t) => n + t.queries.length * t.regions.length * SWEPT_LICENSE_BRANCHES.length,
      0
    );
    assert.equal(buildMatrix().length, expected);
  });

  it('is ordered query-first, so any prefix samples every topic', () => {
    // The whole reason for the ordering: matrix order == information order.
    const matrix = buildMatrix();
    // Every topic's FIRST query must appear before any topic's SECOND query.
    const firstRoundEnd = TOPICS.reduce((n, t) => n + t.regions.length, 0);
    const prefix = matrix.slice(0, firstRoundEnd);
    const topicsInPrefix = new Set(prefix.map((c) => c.topic));
    assert.equal(topicsInPrefix.size, TOPICS.length, 'prefix should cover all topics');
    for (const combo of prefix) {
      const topic = TOPICS.find((t) => t.slug === combo.topic);
      assert.equal(combo.query, topic?.queries[0], 'prefix must be first queries only');
    }
  });

  it('carries each topic\'s configured page depth onto its combos', () => {
    for (const combo of buildMatrix()) {
      const topic = TOPICS.find((t) => t.slug === combo.topic);
      assert.equal(combo.pages, topic?.pages);
    }
  });

  it('uses each topic\'s own regions, not a global list', () => {
    for (const combo of buildMatrix()) {
      const topic = TOPICS.find((t) => t.slug === combo.topic);
      assert.ok(topic?.regions.includes(combo.region), `${combo.topic}/${combo.region}`);
    }
  });

  it('is deterministic — the cursor is an index into this order', () => {
    const a = buildMatrix().map(comboKey);
    const b = buildMatrix().map(comboKey);
    assert.deepEqual(a, b);
  });

  it('produces unique combo keys', () => {
    const keys = buildMatrix().map(comboKey);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('sweeps Creative Commons only — the any branch is dropped', () => {
    // Embed-only content cannot feed the transcription pipeline, so it is no
    // longer harvested. Existing license='youtube' rows stay in the table.
    const matrix = buildMatrix();
    assert.ok(matrix.length > 0);
    assert.ok(matrix.every((c) => c.license === 'creativeCommon'));
  });
});

describe('resolveResumeIndex', () => {
  const matrix = buildMatrix();

  it('starts at the beginning with no cursor', () => {
    const resolved = resolveResumeIndex(null, matrix);
    assert.equal(resolved.index, 0);
    assert.equal(resolved.pageToken, null);
  });

  it('resumes exactly where it stopped', () => {
    const target = matrix[37];
    const resolved = resolveResumeIndex(
      { comboIndex: 37, comboKey: comboKey(target), pageToken: 'PAGE2' },
      matrix
    );
    assert.equal(resolved.index, 37);
    assert.equal(resolved.pageToken, 'PAGE2');
    assert.equal(resolved.note, null);
  });

  it('relocates the combo when the config shifted it', () => {
    // Simulate a query being added ahead of the saved position: the saved
    // index now points at the wrong combo, but the key still exists.
    const target = matrix[37];
    const resolved = resolveResumeIndex(
      { comboIndex: 5, comboKey: comboKey(target), pageToken: null },
      matrix
    );
    assert.equal(resolved.index, 37);
    assert.match(resolved.note ?? '', /config changed/);
  });

  it('restarts rather than silently skipping when the combo is gone', () => {
    const resolved = resolveResumeIndex(
      { comboIndex: 12, comboKey: 'deleted|query|MX|any', pageToken: 'X' },
      matrix
    );
    assert.equal(resolved.index, 0);
    assert.equal(resolved.pageToken, null);
    assert.match(resolved.note ?? '', /no longer exists/);
  });
});

describe('QuotaMeter', () => {
  it('refuses a call it cannot fully afford', () => {
    const meter = new QuotaMeter(QUOTA_COST.search);
    assert.equal(meter.canAfford('search'), true);
    meter.charge('search');
    // Exactly spent — the next search must not start.
    assert.equal(meter.canAfford('search'), false);
    assert.equal(meter.remaining, 0);
  });

  it('tracks the two endpoint costs separately', () => {
    const meter = new QuotaMeter(1_000);
    meter.charge('search');
    meter.charge('videos');
    meter.charge('videos');
    assert.equal(meter.searchCalls, 1);
    assert.equal(meter.videoCalls, 2);
    assert.equal(meter.spent, QUOTA_COST.search + 2 * QUOTA_COST.videos);
  });

  it('still allows a cheap videos.list when a search is unaffordable', () => {
    const meter = new QuotaMeter(QUOTA_COST.search + 5);
    meter.charge('search');
    assert.equal(meter.canAfford('search'), false);
    assert.equal(meter.canAfford('videos'), true);
  });
});

describe('batchIds', () => {
  it('batches at 50 — videos.list costs the same per call, not per id', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
    assert.deepEqual(
      batchIds(ids).map((b) => b.length),
      [50, 50, 20]
    );
  });

  it('handles the empty and exact cases', () => {
    assert.deepEqual(batchIds([]), []);
    assert.equal(batchIds(Array.from({ length: 50 }, (_, i) => `${i}`)).length, 1);
  });
});

describe('pacificMidnightUtc', () => {
  it('lands within the 24h before the given instant', () => {
    const now = new Date('2026-07-21T15:30:00Z');
    const midnight = pacificMidnightUtc(now);
    assert.ok(midnight.getTime() <= now.getTime());
    assert.ok(now.getTime() - midnight.getTime() < 24 * 3_600 * 1_000);
  });

  it('tracks the Pacific day, not the UTC one', () => {
    // 06:00 UTC on the 21st is still 23:00 on the 20th in Los Angeles, so the
    // quota day began on the 20th. Using UTC here would reset quota early.
    const early = new Date('2026-07-21T06:00:00Z');
    assert.equal(pacificMidnightUtc(early).toISOString().slice(0, 10), '2026-07-20');
  });
});

describe('topic config', () => {
  it('gives every topic queries, tags, regions and a page depth', () => {
    for (const topic of TOPICS as readonly Topic[]) {
      assert.ok(topic.queries.length > 0, `${topic.slug} has no queries`);
      assert.ok(topic.tags.length > 0, `${topic.slug} has no tags`);
      assert.ok(topic.regions.length > 0, `${topic.slug} has no regions`);
      assert.ok(topic.pages >= 1, `${topic.slug} has an invalid page depth`);
    }
  });

  it('has unique topic slugs', () => {
    const slugs = TOPICS.map((t) => t.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it('writes queries in Spanish, not English', () => {
    // The whole point: English queries return English content ABOUT Spain.
    const englishGiveaways = /\b(the|how to|best|with|and|food|travel)\b/i;
    for (const topic of TOPICS) {
      for (const query of topic.queries) {
        assert.doesNotMatch(
          query,
          englishGiveaways,
          `"${query}" (${topic.slug}) looks like English`
        );
      }
    }
  });
});

describe('provenance', () => {
  const base: YouTubeVideo = {
    id: 'prov1',
    snippet: { title: 'Receta', channelId: 'UC_c' },
    contentDetails: { duration: 'PT30S' },
    status: { license: 'creativeCommon', embeddable: true },
  };

  it('records the query that surfaced the video', () => {
    const row = mapVideoToCandidate({
      video: base,
      regionHint: 'AR',
      topicTags: ['food'],
      sourceQuery: 'receta facil',
    });
    assert.deepEqual(row?.source_queries, ['receta facil']);
    assert.deepEqual(row?.discovery_sources, ['query']);
  });

  it('defaults to the query source but records no query when none is given', () => {
    // Channel-seeded rows have a source but no search query.
    const row = mapVideoToCandidate({
      video: base,
      regionHint: 'AR',
      topicTags: ['food'],
      source: 'channel',
    });
    assert.deepEqual(row?.source_queries, []);
    assert.deepEqual(row?.discovery_sources, ['channel']);
  });
});

describe('sanitizeText — the surrogate bug that killed a sweep', () => {
  const hasLoneSurrogate = (s: string): boolean =>
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

  it('never splits an emoji at the truncation boundary', () => {
    // A plain slice(0, 1000) here leaves a lone high surrogate, and Postgres
    // rejects the entire insert with "invalid input syntax for type json".
    const description = 'a'.repeat(999) + '\u{1F389}' + 'b'.repeat(50);
    assert.equal(hasLoneSurrogate(description.slice(0, 1_000)), true, 'precondition');
    const safe = sanitizeText(description, 1_000);
    assert.ok(safe);
    assert.equal(hasLoneSurrogate(safe), false);
  });

  it('produces JSON without lone surrogate escapes', () => {
    const safe = sanitizeText('x'.repeat(999) + '\u{1F600}\u{1F600}', 1_000);
    assert.ok(safe);
    assert.equal(hasLoneSurrogate(safe), false);
  });

  it('keeps whole emoji that fit', () => {
    assert.equal(sanitizeText('hola \u{1F389}', 100), 'hola \u{1F389}');
  });

  it('strips NUL, which Postgres text cannot hold', () => {
    assert.equal(sanitizeText('a\u0000b'), 'ab');
  });

  it('passes through null and ordinary text untouched', () => {
    assert.equal(sanitizeText(null), null);
    assert.equal(sanitizeText(undefined), null);
    assert.equal(sanitizeText('Receta f\u00e1cil de tortilla'), 'Receta f\u00e1cil de tortilla');
  });

  it('truncates by code point, not code unit', () => {
    // 5 emoji = 10 UTF-16 code units but 5 code points.
    assert.equal(sanitizeText('\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}', 3), '\u{1F600}\u{1F600}\u{1F600}');
  });
});
