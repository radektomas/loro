#!/usr/bin/env node
/**
 * Loro — set the Madrid-pass A/B switch the app reads at launch.
 *
 *   node scripts/set-paywall-flag.mts              # show the live value
 *   node scripts/set-paywall-flag.mts --percent 50 # 50% of NEW installs get the pass
 *   node scripts/set-paywall-flag.mts --percent 0  # everyone new: hard wall after onboarding
 *   node scripts/set-paywall-flag.mts --percent 100# everyone new: Madrid free first
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

const i = process.argv.indexOf('--percent');
const raw = i >= 0 ? process.argv[i + 1] : undefined;

if (raw === undefined) {
  const res = await fetch(`${PUBLIC_URL}?t=${Date.now()}`);
  console.log(res.ok ? `live: ${await res.text()}` : `no flags file yet (HTTP ${res.status}) — the app uses its default: 100`);
  process.exit(0);
}

const percent = Number(raw);
if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
  console.error(`--percent must be a whole number 0..100, got "${raw}"`);
  process.exit(1);
}

const body = JSON.stringify({ madridPassPercent: percent, updatedAt: new Date().toISOString() });
const { error } = await getAdminClient()
  .storage.from(SNAPSHOT_BUCKET)
  .upload(PATH, Buffer.from(body, 'utf8'), { contentType: 'application/json', cacheControl: '60', upsert: true });
if (error) {
  console.error(`✗ upload failed: ${error.message}`);
  process.exit(1);
}
console.log(`✓ madridPassPercent = ${percent}`);
console.log(`  ${PUBLIC_URL}`);
console.log('  New installs on 1.9.2+ pick it up on their next launch (cache: 60s).');
