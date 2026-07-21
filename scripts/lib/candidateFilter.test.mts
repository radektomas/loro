import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_CONTEXT,
  filterCandidate,
  looksDubbed,
  normalizeText,
  REJECT_REASONS,
  type CandidateFilterInput,
} from './candidateFilter.mts';
import { BLOCKED_CHANNELS, BLOCKED_CHANNEL_IDS, FILTER } from '../config/harvest-queries.mts';

/**
 * Filter tests — run with `npm test`.
 *
 * The filter is pure precisely so this file can exist: no network, no
 * database, no API key. Every threshold in FILTER gets a both-sides case, so
 * tuning a number in config either keeps these passing or tells you exactly
 * what you changed.
 */

/** A candidate that passes everything. Each test breaks exactly one thing. */
function eligibleRow(
  overrides: Partial<CandidateFilterInput> = {}
): CandidateFilterInput {
  return {
    title: 'Mi rutina diaria en la Ciudad de México',
    description: 'Les comparto cómo es un día normal en mi vida.',
    channel_id: 'UC_example',
    duration_seconds: 45,
    view_count: 50_000,
    like_count: 2_000,
    license: 'youtube',
    is_embeddable: true,
    default_audio_language: 'es-MX',
    category_id: '22',
    ...overrides,
  };
}

describe('filterCandidate — the happy path', () => {
  it('accepts a well-formed Spanish clip', () => {
    assert.deepEqual(filterCandidate(eligibleRow()), { eligible: true });
  });

  it('accepts a CC clip the same way it accepts a standard-licence one', () => {
    // License decides how a video may be USED, never whether it is eligible.
    const verdict = filterCandidate(
      eligibleRow({ license: 'creativeCommon' })
    );
    assert.equal(verdict.eligible, true);
  });
});

describe('duration', () => {
  it('rejects clips below the floor', () => {
    const verdict = filterCandidate(
      eligibleRow({ duration_seconds: FILTER.MIN_DURATION_SECONDS - 1 })
    );
    assert.equal(verdict.reason, REJECT_REASONS.DURATION_TOO_SHORT);
  });

  it('accepts exactly the floor', () => {
    const verdict = filterCandidate(
      eligibleRow({ duration_seconds: FILTER.MIN_DURATION_SECONDS })
    );
    assert.equal(verdict.eligible, true);
  });

  it('accepts exactly the ceiling', () => {
    const verdict = filterCandidate(
      eligibleRow({ duration_seconds: FILTER.MAX_DURATION_SECONDS })
    );
    assert.equal(verdict.eligible, true);
  });

  it('rejects clips above the ceiling', () => {
    const verdict = filterCandidate(
      eligibleRow({ duration_seconds: FILTER.MAX_DURATION_SECONDS + 1 })
    );
    assert.equal(verdict.reason, REJECT_REASONS.DURATION_TOO_LONG);
  });

  it('rejects an unparseable duration rather than assuming', () => {
    const verdict = filterCandidate(eligibleRow({ duration_seconds: null }));
    assert.equal(verdict.reason, REJECT_REASONS.DURATION_UNKNOWN);
  });
});

describe('rights and playability', () => {
  it('rejects non-embeddable videos', () => {
    const verdict = filterCandidate(eligibleRow({ is_embeddable: false }));
    assert.equal(verdict.reason, REJECT_REASONS.NOT_EMBEDDABLE);
  });

  it('tolerates an unstated embeddable flag', () => {
    assert.equal(filterCandidate(eligibleRow({ is_embeddable: null })).eligible, true);
  });

  it('rejects a video whose license is unknown', () => {
    // The legal posture in one test: unknown rights are never assumed usable.
    const verdict = filterCandidate(eligibleRow({ license: null }));
    assert.equal(verdict.reason, REJECT_REASONS.LICENSE_UNKNOWN);
  });
});

describe('content suitability', () => {
  it('rejects the Music category', () => {
    const verdict = filterCandidate(
      eligibleRow({ category_id: FILTER.MUSIC_CATEGORY_ID })
    );
    assert.equal(verdict.reason, REJECT_REASONS.CATEGORY_MUSIC);
  });

  it('rejects a declared non-Spanish audio language', () => {
    const verdict = filterCandidate(
      eligibleRow({ default_audio_language: 'en-US' })
    );
    assert.equal(verdict.reason, REJECT_REASONS.AUDIO_LANGUAGE_NOT_ES);
  });

  it('accepts every Spanish variant tag', () => {
    for (const tag of ['es', 'es-MX', 'es-419', 'es-ES']) {
      assert.equal(
        filterCandidate(eligibleRow({ default_audio_language: tag })).eligible,
        true,
        `expected ${tag} to pass`
      );
    }
  });

  it('does not treat a missing audio language as non-Spanish', () => {
    // It is absent on most videos; absence is not evidence.
    assert.equal(
      filterCandidate(eligibleRow({ default_audio_language: null })).eligible,
      true
    );
  });
});

describe('dubbing heuristic', () => {
  it('flags explicit dubbing vocabulary regardless of case or accents', () => {
    assert.equal(looksDubbed('Película DOBLADA al español', null), true);
    assert.equal(looksDubbed('Doblaje latino completo', null), true);
    assert.equal(looksDubbed(null, 'audio latino, versión completa'), true);
  });

  it('flags subtitled content — the original audio is not Spanish', () => {
    assert.equal(looksDubbed('Anime sub español', null), true);
  });

  it('does not fire on ordinary Spanish speech', () => {
    assert.equal(
      looksDubbed('Cómo hacer arepas', 'Voy a subir más recetas pronto'),
      false,
      '"subir" must not trip the \\bsub\\b pattern'
    );
    assert.equal(looksDubbed('Un día dubitativo', null), false);
  });

  it('rejects a dubbed row with the specific reason', () => {
    const verdict = filterCandidate(
      eligibleRow({ title: 'Escena doblada al español latino' })
    );
    assert.equal(verdict.reason, REJECT_REASONS.DUBBING_SUSPECTED);
  });
});

describe('audience signal', () => {
  it('rejects too few views', () => {
    const verdict = filterCandidate(
      eligibleRow({ view_count: FILTER.MIN_VIEW_COUNT - 1 })
    );
    assert.equal(verdict.reason, REJECT_REASONS.VIEW_COUNT_TOO_LOW);
  });

  it('treats missing view counts as zero', () => {
    const verdict = filterCandidate(eligibleRow({ view_count: null }));
    assert.equal(verdict.reason, REJECT_REASONS.VIEW_COUNT_TOO_LOW);
  });

  it('rejects a poor like ratio', () => {
    const views = 100_000;
    const verdict = filterCandidate(
      eligibleRow({
        view_count: views,
        like_count: Math.floor(views * FILTER.MIN_LIKE_RATIO) - 1,
      })
    );
    assert.equal(verdict.reason, REJECT_REASONS.LIKE_RATIO_TOO_LOW);
  });

  it('accepts a like ratio exactly at the threshold', () => {
    const views = 100_000;
    const verdict = filterCandidate(
      eligibleRow({ view_count: views, like_count: views * FILTER.MIN_LIKE_RATIO })
    );
    assert.equal(verdict.eligible, true);
  });

  it('treats hidden likes as unknown, not as zero', () => {
    // Channels that disable the like count would otherwise be wiped out.
    assert.equal(
      filterCandidate(eligibleRow({ like_count: null })).eligible,
      true
    );
  });
});

describe('source diversity', () => {
  it('rejects a channel that is already over its cap', () => {
    const verdict = filterCandidate(eligibleRow(), {
      eligibleCountsByChannel: new Map([
        ['UC_example', FILTER.MAX_ELIGIBLE_PER_CHANNEL + 1],
      ]),
    });
    assert.equal(verdict.reason, REJECT_REASONS.CHANNEL_SATURATED);
  });

  it('still accepts a channel sitting exactly at the cap', () => {
    const verdict = filterCandidate(eligibleRow(), {
      eligibleCountsByChannel: new Map([
        ['UC_example', FILTER.MAX_ELIGIBLE_PER_CHANNEL],
      ]),
    });
    assert.equal(verdict.eligible, true);
  });

  it('ignores channel counts for other channels', () => {
    const verdict = filterCandidate(eligibleRow(), {
      eligibleCountsByChannel: new Map([['UC_someone_else', 999]]),
    });
    assert.equal(verdict.eligible, true);
  });
});

describe('reject reasons are specific', () => {
  it('never returns a generic reason', () => {
    const broken = filterCandidate(
      eligibleRow({ duration_seconds: 3, category_id: '10', view_count: 0 })
    );
    assert.equal(broken.eligible, false);
    // Cheapest-and-most-decisive check wins, so the histogram stays meaningful.
    assert.equal(broken.reason, REJECT_REASONS.DURATION_TOO_SHORT);
    assert.notEqual(broken.reason, 'filtered');
  });

  it('always pairs eligible:false with a reason', () => {
    const verdict = filterCandidate(eligibleRow({ license: null }));
    assert.equal(verdict.eligible, false);
    assert.ok(verdict.reason, 'reject_reason must never be empty');
  });
});

describe('normalizeText', () => {
  it('strips accents and lowercases', () => {
    assert.equal(normalizeText('ESPAÑOL Doblají'), 'espanol doblaji');
  });

  it('leaves an empty context usable', () => {
    assert.equal(EMPTY_CONTEXT.eligibleCountsByChannel.size, 0);
  });
});

describe('channel blocklist', () => {
  // The blocklist is editorial, so these tests inject their own rather than
  // depending on whatever BLOCKED_CHANNELS currently holds.
  it('rejects a video from a blocked channel', () => {
    const blocked = BLOCKED_CHANNELS[0];
    assert.ok(blocked, 'expected at least one blocked channel to test against');
    const verdict = filterCandidate(eligibleRow({ channel_id: blocked.channelId }));
    assert.equal(verdict.reason, REJECT_REASONS.CHANNEL_BLOCKED);
  });

  it('blocks regardless of how good the video otherwise looks', () => {
    // The block runs first precisely so it is not shadowed by other checks —
    // and so channel_blocked counts every video from the channel.
    const blocked = BLOCKED_CHANNELS[0];
    assert.ok(blocked);
    const verdict = filterCandidate(
      eligibleRow({
        channel_id: blocked.channelId,
        duration_seconds: 500, // would otherwise be duration_too_long
        view_count: 10,        // would otherwise be view_count_too_low
      })
    );
    assert.equal(verdict.reason, REJECT_REASONS.CHANNEL_BLOCKED);
  });

  it('leaves unblocked channels alone', () => {
    assert.equal(filterCandidate(eligibleRow()).eligible, true);
  });

  it('has no duplicate entries', () => {
    const ids = BLOCKED_CHANNELS.map((c) => c.channelId);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('derives its lookup set from the list', () => {
    assert.equal(BLOCKED_CHANNEL_IDS.size, BLOCKED_CHANNELS.length);
    for (const channel of BLOCKED_CHANNELS) {
      assert.ok(BLOCKED_CHANNEL_IDS.has(channel.channelId));
    }
  });

  it('requires a stated reason for every blocked channel', () => {
    // An unexplained blocklist rots — nobody dares remove an entry they
    // cannot justify.
    for (const channel of BLOCKED_CHANNELS) {
      assert.ok(channel.reason.trim().length > 0, `${channel.title} has no reason`);
      assert.match(channel.channelId, /^UC[\w-]{20,}$/, `${channel.title} has a malformed id`);
    }
  });

  it('exposes channel_blocked as a specific reason', () => {
    assert.equal(REJECT_REASONS.CHANNEL_BLOCKED, 'channel_blocked');
  });
});
