#!/usr/bin/env node
/**
 * Which hook to use next, per account.
 *
 *   node scripts/cut/hooks.mts radek.spanish
 *
 * Lists the bank (scripts/cut/hooks.json) with how often each hook was already
 * cut for that account and for the others, plus its score once posted reels
 * have views. Least-used-for-this-account first, ties broken by the best score:
 * the cut skill takes from the top, never repeating a hook inside one batch.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAdminClient } from '../lib/supabaseAdmin.mts';
import { ACCOUNTS, hookKey, hookStats, type Account } from '../../lib/cutReels.ts';

const account = process.argv[2] as Account;
if (!ACCOUNTS.includes(account)) {
  console.error(`usage: node scripts/cut/hooks.mts <${ACCOUNTS.join('|')}>`);
  process.exit(1);
}
const bank = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'hooks.json'), 'utf8'))
  .hooks as { text: string; kind: string }[];

const { data, error } = await getAdminClient().from('loro_cut_reels').select('account, hook, status, manual_views');
if (error) throw new Error(error.message);
const reels = (data ?? []).map((r) => ({ ...r, views: r.manual_views == null ? null : Number(r.manual_views) }));
const stats = new Map(hookStats(reels).map((s) => [hookKey(s.hook), s]));

const rows = bank.map((h) => {
  const k = hookKey(h.text);
  const here = reels.filter((r) => r.account === account && r.status !== 'dropped' && hookKey(r.hook) === k).length;
  const elsewhere = reels.filter((r) => r.account !== account && r.status !== 'dropped' && hookKey(r.hook) === k).length;
  return { ...h, here, elsewhere, score: stats.get(k)?.avgMultiple ?? null };
});
rows.sort((a, b) => a.here - b.here || (b.score ?? 1) - (a.score ?? 1));
for (const r of rows) {
  const score = r.score == null ? '  –  ' : `${r.score.toFixed(1)}x`.padStart(5);
  console.log(`${String(r.here).padStart(2)} here ${String(r.elsewhere).padStart(2)} other  ${score}  [${r.kind}] ${r.text.replace(/\n/g, ' / ')}`);
}
