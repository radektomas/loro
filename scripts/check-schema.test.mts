import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveExpectations,
  evaluate,
  type Expectations,
  type SchemaReport,
} from './check-schema.mts';

/**
 * Tests for the schema drift check — run with `npm test`.
 *
 * The check is only as good as two halves that can each fail silently: a
 * parser that quietly matches nothing (making every check pass vacuously),
 * and a comparison that quietly reports PASS for something absent. Both are
 * pure functions precisely so this file can pin them down without a database.
 *
 * The parser assertions name objects from real migrations on purpose. If a
 * migration is ever renamed or restructured such that these stop being found,
 * that is exactly the moment the check would start under-reporting.
 */

const expected = deriveExpectations();

function names(category: string): string[] {
  return expected.items.filter((i) => i.category === category).map((i) => i.name);
}

/** A report that satisfies every expectation — the all-clear baseline. */
function fullReport(exp: Expectations = expected): SchemaReport {
  const columns: Record<string, string[]> = {};
  const report: SchemaReport = {
    tables: [],
    columns,
    buckets: [],
    policies: [],
    triggers: [],
    functions: [],
    grants: [],
  };
  for (const item of exp.items) {
    switch (item.category) {
      case 'table':
        report.tables.push(item.name);
        break;
      case 'column': {
        const [table, column] = item.name.split('.');
        (columns[table] ??= []).push(column);
        break;
      }
      case 'policy': {
        // schema.table."policy name"
        const match = /^(\w+)\.(\w+)\."(.+)"$/.exec(item.name);
        assert.ok(match, `unparseable policy expectation: ${item.name}`);
        report.policies.push({
          schema: match[1],
          table: match[2],
          name: match[3],
        });
        break;
      }
      case 'bucket':
        report.buckets.push(item.name);
        break;
      case 'trigger': {
        const idx = item.name.lastIndexOf('.');
        report.triggers.push({
          table: item.name.slice(0, idx),
          name: item.name.slice(idx + 1),
        });
        break;
      }
      case 'function':
        report.functions.push(item.name);
        break;
      case 'grant': {
        // Absence expectations contribute nothing — that is the point.
        if (item.mustBeAbsent) break;
        const [target, privilege, , grantee] = item.name.split(' ');
        const [table, column] = target.split('.');
        report.grants.push({ table, column, privilege, grantee });
        break;
      }
    }
  }
  return report;
}

describe('deriveExpectations — parsed from the real migrations', () => {
  it('finds tables created across different migrations', () => {
    const tables = names('table');
    for (const table of [
      'loro_creators',
      'loro_videos',
      'loro_admins',
      'loro_follows',
      'loro_video_candidates',
    ]) {
      assert.ok(tables.includes(table), `expected table ${table}`);
    }
  });

  it('finds columns from create-table bodies AND later alters', () => {
    const columns = names('column');
    // In the original create table:
    assert.ok(columns.includes('loro_videos.poster_path'));
    // Added by a later migration — a table existing is not enough:
    assert.ok(columns.includes('loro_creators.follower_count'));
    assert.ok(columns.includes('loro_creators.avatar_url'));
  });

  it('does not mistake table constraints for columns', () => {
    const columns = names('column');
    assert.ok(columns.includes('loro_follows.follower_id'));
    assert.ok(!columns.some((c) => c.endsWith('.primary')));
    assert.ok(!columns.some((c) => c.endsWith('.check')));
    assert.ok(!columns.some((c) => c.endsWith('.unique')));
  });

  it('finds the policy whose absence degraded the live feed', () => {
    assert.ok(
      names('policy').includes(
        'public.loro_creators."anyone reads approved creators"'
      )
    );
  });

  it('covers storage buckets and their policies', () => {
    const buckets = names('bucket');
    assert.ok(buckets.includes('avatars'));
    assert.ok(buckets.includes('loro-videos'));
    const policies = names('policy');
    for (const name of [
      'public read avatars',
      'users upload own avatar',
      'users update own avatar',
      'users delete own avatar',
    ]) {
      assert.ok(
        policies.includes(`storage.objects."${name}"`),
        `expected storage policy ${name}`
      );
    }
  });

  it('finds the counter triggers and the review guard', () => {
    const triggers = names('trigger');
    assert.ok(triggers.includes('loro_follows.loro_follows_count'));
    assert.ok(triggers.includes('loro_saved_words.loro_saved_words_impact'));
    assert.ok(triggers.includes('loro_creators.loro_creators_guard'));
  });

  it('finds the trigger functions', () => {
    const functions = names('function');
    for (const fn of [
      'loro_track_follow_count',
      'loro_track_video_impact',
      'loro_creators_guard',
      'loro_is_admin',
      'loro_schema_report',
    ]) {
      assert.ok(functions.includes(fn), `expected function ${fn}`);
    }
  });

  it('treats every *_count column as one that must not be client-writable', () => {
    assert.ok(expected.counterColumns.has('loro_creators.follower_count'));
    assert.ok(expected.counterColumns.has('loro_videos.saved_count'));
    assert.ok(expected.counterColumns.has('loro_videos.mastered_count'));
    for (const role of ['anon', 'authenticated']) {
      assert.ok(
        names('grant').includes(
          `loro_creators.follower_count NOT writable by ${role}`
        )
      );
    }
  });

  it('records the writable column grants, counters excluded', () => {
    const writable = expected.writable.get('loro_creators');
    assert.ok(writable?.has('display_name'));
    // The admin review path runs as `authenticated` too, so these must stay.
    assert.ok(writable?.has('status'));
    assert.ok(writable?.has('reviewed_at'));
    assert.ok(!writable?.has('follower_count'));
  });

  it('parses enough of every category to be worth running', () => {
    for (const category of [
      'table',
      'column',
      'policy',
      'trigger',
      'function',
      'grant',
      'bucket',
    ]) {
      assert.ok(names(category).length > 0, `parsed 0 ${category}`);
    }
  });
});

describe('evaluate', () => {
  it('passes when the database has everything', () => {
    const results = evaluate(expected, fullReport());
    assert.deepEqual(
      results.filter((r) => !r.ok),
      []
    );
  });

  it('flags a missing table', () => {
    const report = fullReport();
    report.tables = report.tables.filter((t) => t !== 'loro_follows');
    const missing = evaluate(expected, report).filter((r) => !r.ok);
    assert.ok(missing.some((m) => m.category === 'table' && m.name === 'loro_follows'));
  });

  it('flags a column missing from a table that DOES exist', () => {
    const report = fullReport();
    report.columns.loro_creators = report.columns.loro_creators.filter(
      (c) => c !== 'follower_count'
    );
    const missing = evaluate(expected, report).filter((r) => !r.ok);
    assert.ok(
      missing.some((m) => m.name === 'loro_creators.follower_count'),
      'an existing table with a stale column set must not pass'
    );
  });

  it('flags the public creator read policy — the real regression', () => {
    const report = fullReport();
    report.policies = report.policies.filter(
      (p) => p.name !== 'anyone reads approved creators'
    );
    const missing = evaluate(expected, report).filter((r) => !r.ok);
    assert.ok(
      missing.some((m) => m.category === 'policy'),
      'the policy whose absence broke creator names must be caught'
    );
  });

  it('flags a missing storage bucket and a missing storage policy', () => {
    const noBucket = fullReport();
    noBucket.buckets = noBucket.buckets.filter((b) => b !== 'avatars');
    assert.ok(
      evaluate(expected, noBucket).some(
        (r) => !r.ok && r.category === 'bucket' && r.name === 'avatars'
      )
    );

    const noPolicy = fullReport();
    noPolicy.policies = noPolicy.policies.filter(
      (p) => p.name !== 'users upload own avatar'
    );
    assert.ok(
      evaluate(expected, noPolicy).some(
        (r) => !r.ok && r.name === 'storage.objects."users upload own avatar"'
      ),
      'a missing storage policy fails at upload time, so it must be caught here'
    );
  });

  it('flags a missing trigger', () => {
    const report = fullReport();
    report.triggers = report.triggers.filter(
      (t) => t.name !== 'loro_follows_count'
    );
    const missing = evaluate(expected, report).filter((r) => !r.ok);
    assert.ok(missing.some((m) => m.name === 'loro_follows.loro_follows_count'));
  });

  it('flags a restored blanket grant that makes a counter writable', () => {
    const report = fullReport();
    // Exactly what re-running an older migration would do: the counter comes
    // back as writable, via a table-level grant expanded per column.
    report.grants.push({
      table: 'loro_creators',
      column: 'follower_count',
      privilege: 'UPDATE',
      grantee: 'authenticated',
    });
    const missing = evaluate(expected, report).filter((r) => !r.ok);
    assert.ok(
      missing.some(
        (m) =>
          m.name === 'loro_creators.follower_count NOT writable by authenticated'
      ),
      'a counter that became client-writable must fail the check'
    );
  });

  it('flags a revoked grant the app still needs', () => {
    const report = fullReport();
    report.grants = report.grants.filter(
      (g) => !(g.table === 'loro_creators' && g.column === 'status')
    );
    const missing = evaluate(expected, report).filter((r) => !r.ok);
    assert.ok(
      missing.some((m) => m.name.startsWith('loro_creators.status ')),
      'losing the status grant breaks admin approve/reject and must be caught'
    );
  });
});
