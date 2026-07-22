import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { REPO_ROOT } from './lib/env.mts';

/**
 * Schema drift check — does production actually have everything this repo
 * depends on?
 *
 *   npm run check-schema
 *
 * Migrations here are applied BY HAND in the Supabase SQL editor, so an
 * unapplied file leaves no trace: the app keeps building, keeps deploying,
 * and only misbehaves at runtime. Three were once found unapplied at once,
 * and one of them (the public creator read policy) had silently degraded a
 * live feature for weeks — every published video's creator join returned
 * null, so the feed showed "Loro creator" instead of the creator's name.
 * Nothing failed loudly; it just quietly stopped being right.
 *
 * The expectations are PARSED OUT OF THE MIGRATION FILES, never hardcoded. A
 * hand-maintained list of "things that should exist" is itself a thing that
 * drifts — it would go stale the first time someone adds a migration and
 * forgets to update it, which is the exact failure this check exists to
 * prevent. Adding a migration is therefore enough to extend the check.
 *
 * Exits non-zero if anything is missing, naming the migration file to run.
 */

const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

/** The migration carrying the introspection function this check calls. */
const REPORT_FN = 'loro_schema_report';

/**
 * Return shape this script expects from REPORT_FN. The function reports its
 * own version, and a mismatch aborts instead of being interpreted.
 *
 * This exists because it already bit: the function gained a 'schema' key on
 * its policy rows, a database still running the previous copy returned rows
 * without it, and every policy key built from that came out as
 * "undefined.loro_videos.…" — 46 real policies reported as missing. False
 * MISSINGs are worse than no check at all, because the next real one gets
 * ignored.
 */
const REQUIRED_REPORT_VERSION = 2;

/**
 * Counter columns are trigger-maintained and must NEVER be writable by a
 * client — they are the numbers a revenue share is based on. Matched by
 * suffix rather than listed, so a new `*_count` column is protected the day
 * it is added.
 */
const COUNTER_SUFFIX = '_count';

const CLIENT_ROLES = ['anon', 'authenticated'] as const;

// ---------------------------------------------------------------- expected

/** One thing the schema must contain, and the file that would create it. */
export type Expectation = {
  category:
    | 'table'
    | 'column'
    | 'policy'
    | 'trigger'
    | 'function'
    | 'grant'
    | 'bucket';
  /** Human-readable identity, e.g. "loro_creators.follower_count" */
  name: string;
  file: string;
  /** Grants only: the check is that this is ABSENT, not present. */
  mustBeAbsent?: boolean;
};

export type Expectations = {
  items: Expectation[];
  /** table -> columns the migrations grant to `authenticated` */
  writable: Map<string, Set<string>>;
  counterColumns: Set<string>;
};

/** Column-ish lines inside a create-table body that aren't columns. */
const NOT_A_COLUMN = new Set([
  'primary',
  'unique',
  'check',
  'constraint',
  'foreign',
  'exclude',
  'like',
]);

function columnsInCreateTable(body: string): string[] {
  const names: string[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;
    const match = /^([a-z_][a-z0-9_]*)\s+/i.exec(line);
    if (!match) continue;
    if (NOT_A_COLUMN.has(match[1].toLowerCase())) continue;
    names.push(match[1]);
  }
  return names;
}

/**
 * Read every migration and derive what the database must contain.
 *
 * Deliberately conservative: it only understands the statement forms this
 * repo actually uses. Anything it cannot parse is simply not checked — a
 * silent under-count is the real hazard here (a regex that matches nothing
 * makes the whole check pass vacuously), which is why main() refuses to run
 * when a category comes back empty.
 */
export function deriveExpectations(dir: string = MIGRATIONS_DIR): Expectations {
  const items: Expectation[] = [];
  const writable = new Map<string, Set<string>>();
  const counterColumns = new Set<string>();
  const seen = new Set<string>();
  /** table -> the migration that last declared its column grants, so a
      counter-writability failure points at the file that fixes it. */
  const grantFile = new Map<string, string>();

  const add = (e: Expectation): void => {
    const key = `${e.category}:${e.name}`;
    // Migrations re-create policies and functions (drop-if-exists + create);
    // credit the FIRST file that introduced each object.
    if (seen.has(key)) return;
    seen.add(key);
    items.push(e);
  };

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), 'utf8');

    // create table if not exists public.X ( ... );
    for (const m of sql.matchAll(
      /create table if not exists\s+public\.(\w+)\s*\(([\s\S]*?)\n\);/gi
    )) {
      const [, table, body] = m;
      add({ category: 'table', name: table, file });
      for (const col of columnsInCreateTable(body)) {
        add({ category: 'column', name: `${table}.${col}`, file });
        if (col.endsWith(COUNTER_SUFFIX)) counterColumns.add(`${table}.${col}`);
      }
    }

    // alter table public.X add column if not exists NAME TYPE
    for (const m of sql.matchAll(
      /alter table\s+public\.(\w+)\s+add column if not exists\s+(\w+)/gi
    )) {
      const [, table, col] = m;
      add({ category: 'column', name: `${table}.${col}`, file });
      if (col.endsWith(COUNTER_SUFFIX)) counterColumns.add(`${table}.${col}`);
    }

    // create policy "NAME" on <schema>.X — schema-qualified, because storage
    // policies live on storage.objects and would otherwise collide with (or
    // masquerade as) a policy on a public table.
    for (const m of sql.matchAll(
      /create policy\s+"([^"]+)"\s+on\s+(public|storage)\.(\w+)/gi
    )) {
      add({ category: 'policy', name: `${m[2]}.${m[3]}."${m[1]}"`, file });
    }

    // insert into storage.buckets (...) values ('NAME', ...)
    for (const m of sql.matchAll(
      /insert into storage\.buckets[\s\S]*?values\s*\(\s*'([^']+)'/gi
    )) {
      add({ category: 'bucket', name: m[1], file });
    }

    // create trigger NAME <timing> ... on public.X
    for (const m of sql.matchAll(
      /create trigger\s+(\w+)\s+(?:before|after|instead of)[\s\S]*?on\s+public\.(\w+)/gi
    )) {
      add({ category: 'trigger', name: `${m[2]}.${m[1]}`, file });
    }

    // create or replace function public.NAME(
    for (const m of sql.matchAll(
      /create or replace function\s+public\.(\w+)\s*\(/gi
    )) {
      add({ category: 'function', name: m[1], file });
    }

    // grant insert|update (cols) on public.X to <roles>;
    for (const m of sql.matchAll(
      /grant\s+(insert|update)\s*\(([\s\S]*?)\)\s*on\s+public\.(\w+)\s+to\s+([^;]+);/gi
    )) {
      const [, privilege, cols, table, roles] = m;
      if (!/authenticated/i.test(roles)) continue;
      const set = writable.get(table) ?? new Set<string>();
      for (const col of cols.split(',').map((c) => c.trim()).filter(Boolean)) {
        set.add(col);
        add({
          category: 'grant',
          name: `${table}.${col} ${privilege.toUpperCase()} to authenticated`,
          file,
        });
      }
      writable.set(table, set);
      grantFile.set(table, file);
    }
  }

  // Counters must be absent from client write grants. Only meaningful for
  // tables whose grants the migrations actually manage — on any other table a
  // blanket grant is still the default and this would be a false alarm.
  for (const counter of counterColumns) {
    const [table] = counter.split('.');
    if (!writable.has(table)) continue;
    for (const role of CLIENT_ROLES) {
      add({
        category: 'grant',
        name: `${counter} NOT writable by ${role}`,
        file: grantFile.get(table) ?? '',
        mustBeAbsent: true,
      });
    }
  }

  return { items, writable, counterColumns };
}

// ------------------------------------------------------------------ report

export type SchemaReport = {
  /** Absent on version 1, which predates this field. */
  version?: number;
  tables: string[];
  columns: Record<string, string[]>;
  buckets: string[];
  policies: { schema: string; table: string; name: string }[];
  triggers: { table: string; name: string }[];
  functions: string[];
  grants: {
    table: string;
    column: string;
    privilege: string;
    grantee: string;
  }[];
};

export type Result = Expectation & { ok: boolean };

/** Compare expectations against what the database reports. Pure. */
export function evaluate(
  expected: Expectations,
  report: SchemaReport
): Result[] {
  const tables = new Set(report.tables);
  const columns = new Map(
    Object.entries(report.columns).map(([t, cols]) => [t, new Set(cols)])
  );
  const buckets = new Set(report.buckets ?? []);
  const policies = new Set(
    report.policies.map((p) => `${p.schema}.${p.table}."${p.name}"`)
  );
  const triggers = new Set(report.triggers.map((t) => `${t.table}.${t.name}`));
  const functions = new Set(report.functions);
  const grants = new Set(
    report.grants.map(
      (g) => `${g.table}.${g.column} ${g.privilege} to ${g.grantee}`
    )
  );

  return expected.items.map((item) => {
    let ok: boolean;
    switch (item.category) {
      case 'table':
        ok = tables.has(item.name);
        break;
      case 'column': {
        const [table, column] = item.name.split('.');
        ok = columns.get(table)?.has(column) ?? false;
        break;
      }
      case 'policy':
        ok = policies.has(item.name);
        break;
      case 'bucket':
        ok = buckets.has(item.name);
        break;
      case 'trigger':
        ok = triggers.has(item.name);
        break;
      case 'function':
        ok = functions.has(item.name);
        break;
      case 'grant': {
        if (item.mustBeAbsent) {
          // "loro_creators.follower_count NOT writable by authenticated"
          const [target, , , , role] = item.name.split(' ');
          ok = !['INSERT', 'UPDATE'].some((p) =>
            grants.has(`${target} ${p} to ${role}`)
          );
        } else {
          ok = grants.has(item.name);
        }
        break;
      }
    }
    return { ...item, ok };
  });
}

// -------------------------------------------------------------------- output

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function printTable(results: Result[]): void {
  const nameWidth = Math.min(
    64,
    Math.max(...results.map((r) => r.name.length), 6)
  );
  let lastCategory = '';
  for (const r of results) {
    if (r.category !== lastCategory) {
      lastCategory = r.category;
      console.log(`\n  ${r.category.toUpperCase()}`);
    }
    const status = r.ok ? 'PASS   ' : 'MISSING';
    const where = r.ok ? '' : `  <- ${r.file}`;
    console.log(`    ${status}  ${pad(r.name, nameWidth)}${where}`);
  }
}

async function main(): Promise<void> {
  const expected = deriveExpectations();

  // A category that parses to nothing means a broken regex, and a broken
  // regex makes this check pass by checking nothing. Fail loudly instead.
  const categories = [
    'table',
    'column',
    'policy',
    'trigger',
    'function',
    'grant',
    'bucket',
  ] as const;
  const empty = categories.filter(
    (c) => !expected.items.some((i) => i.category === c)
  );
  if (empty.length > 0) {
    console.error(
      `\nDerived 0 ${empty.join(', ')} from the migrations — the parser is ` +
        `broken, not the schema. Fix scripts/check-schema.mts before trusting ` +
        `this check.\n`
    );
    process.exit(1);
  }

  console.log(
    `\nChecking ${expected.items.length} schema objects derived from ` +
      `supabase/migrations/…\n`
  );

  const supabase = getAdminClient();
  const { data, error } = await supabase.rpc(REPORT_FN);

  if (error) {
    const file = expected.items.find(
      (i) => i.category === 'function' && i.name === REPORT_FN
    )?.file;
    console.error(
      `Could not read the schema: ${error.message}\n\n` +
        `This check needs the ${REPORT_FN}() function — PostgREST cannot ` +
        `read pg_policies,\npg_trigger or information_schema directly, so ` +
        `introspection has to happen in the\ndatabase.\n\n` +
        `Apply supabase/migrations/${file} in the Supabase SQL editor, then ` +
        `re-run.\n`
    );
    process.exit(1);
  }

  const report = data as SchemaReport;
  const version = report.version ?? 1;
  if (version < REQUIRED_REPORT_VERSION) {
    const file = expected.items.find(
      (i) => i.category === 'function' && i.name === REPORT_FN
    )?.file;
    console.error(
      `${REPORT_FN}() is version ${version}; this check needs version ` +
        `${REQUIRED_REPORT_VERSION}.\n\n` +
        `The database is running an older copy of the introspection function, ` +
        `whose output\nthis script cannot read correctly — continuing would ` +
        `report objects as missing that\nare present.\n\n` +
        `Re-apply supabase/migrations/${file} (it is CREATE OR REPLACE, so ` +
        `running it again\nis safe), then re-run.\n`
    );
    process.exit(1);
  }

  const results = evaluate(expected, report);
  printTable(results);

  const missing = results.filter((r) => !r.ok);
  if (missing.length === 0) {
    console.log(`\n${results.length} objects checked — schema is current.\n`);
    return;
  }

  const files = [...new Set(missing.map((m) => m.file))].filter(Boolean).sort();
  console.log(
    `\n${missing.length} of ${results.length} missing. Apply these in the ` +
      `Supabase SQL editor, oldest first:\n`
  );
  for (const file of files) console.log(`    supabase/migrations/${file}`);
  console.log('');
  process.exit(1);
}

// Only run when invoked directly, so the pure functions above can be imported
// (and tested) without executing anything.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
