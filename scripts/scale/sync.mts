/**
 * Sync Radek's Instagram accounts now, from this Mac (the same code the
 * daily Vercel cron runs: app/api/_lib/instagram.ts).
 *
 *   node scripts/scale/sync.mts         (like the cron)
 *   node scripts/scale/sync.mts --all   (re-read every post's insights once)
 */
import { getAdminClient } from '../lib/supabaseAdmin.mts';
import { syncAll } from '../../app/api/_lib/instagram.ts';

const results = await syncAll(getAdminClient(), { rereadAll: process.argv.includes('--all') });
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} @${r.username}: ${r.posts} posts, ${r.insights} insight rows${r.refreshed ? ', token renewed' : ''}${r.error ? ` — ${r.error}` : ''}`);
}
if (results.some((r) => !r.ok)) process.exit(1);
