#!/usr/bin/env node
/**
 * Loro — set the Madrid-pass A/B switch the app reads at launch.
 *
 *   node scripts/set-paywall-flag.mts              # show the live value
 *   node scripts/set-paywall-flag.mts --percent 50 # 50% of NEW installs get the pass
 *   node scripts/set-paywall-flag.mts --percent 0  # everyone new: hard wall after onboarding
 *   node scripts/set-paywall-flag.mts --percent 100# everyone new: Madrid free first
 *   node scripts/set-paywall-flag.mts --multi 50   # 50% of NEW installs get the 3-page launch wall
 *
 * The two dials are independent splits (remoteFlags.ts); setting one keeps
 * the other's live value.
 *
 * Writes config/flags.json into the public loro-catalog bucket (60s cache).
 * Builds from 1.9.2 on fetch it once per launch (apps/mobile/src/platform/
 * remoteFlags.ts). An install's arm is fixed the first time it is decided, so
 * a change only affects installs that have not been decided yet. Older builds
 * ignore the file and keep the pass.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in .env.
 */
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { SNAPSHOT_BUCKET } from './lib/catalog.mts';

const PATH = 'config/flags.json';
const PUBLIC_URL = `https://iqfsnkmtpffrepcedwih.supabase.co/storage/v1/object/public/${SNAPSHOT_BUCKET}/${PATH}`;

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const rawPercent = arg('--percent');
const rawMulti = arg('--multi');

const res = await fetch(`${PUBLIC_URL}?t=${Date.now()}`);
const live = res.ok ? ((await res.json()) as { madridPassPercent?: number; multiPagePercent?: number }) : {};

if (rawPercent === undefined && rawMulti === undefined) {
  console.log(res.ok ? `live: ${JSON.stringify(live)}` : `no flags file yet (HTTP ${res.status}) — the app uses its defaults: madrid 100, multi 0`);
  process.exit(0);
}

const parse = (raw: string, name: string) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    console.error(`${name} must be a whole number 0..100, got "${raw}"`);
    process.exit(1);
  }
  return n;
};
const percent = rawPercent !== undefined ? parse(rawPercent, '--percent') : live.madridPassPercent ?? 100;
const multi = rawMulti !== undefined ? parse(rawMulti, '--multi') : live.multiPagePercent ?? 0;

const body = JSON.stringify({ madridPassPercent: percent, multiPagePercent: multi, updatedAt: new Date().toISOString() });
const { error } = await getAdminClient()
  .storage.from(SNAPSHOT_BUCKET)
  .upload(PATH, Buffer.from(body, 'utf8'), { contentType: 'application/json', cacheControl: '60', upsert: true });
if (error) {
  console.error(`✗ upload failed: ${error.message}`);
  process.exit(1);
}
console.log(`✓ madridPassPercent = ${percent}, multiPagePercent = ${multi}`);
console.log(`  ${PUBLIC_URL}`);
console.log('  New installs pick it up on their next launch (cache: 60s). multiPagePercent needs the build that has the 3-page wall.');
