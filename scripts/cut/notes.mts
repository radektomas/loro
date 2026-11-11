#!/usr/bin/env node
/**
 * What Radek asked for on getloro.app/cut that no recut has answered yet.
 *
 *   node scripts/cut/notes.mts            # open notes, grouped by reel
 *   node scripts/cut/notes.mts --json     # the same, machine-readable
 *
 * For each reel: its job (the render recipe, with absolute source paths), the
 * version Radek watched, and each note with the second it is pinned to and
 * what was on screen there (hook or line) so the note can be read in context.
 */
import { getAdminClient } from '../lib/supabaseAdmin.mts';

const s = getAdminClient();
const { data: notes, error } = await s
  .from('loro_cut_notes')
  .select('id, reel_id, version, at_s, body, created_at')
  .is('done_version', null)
  .order('at_s');
if (error) throw new Error(error.message);

const ids = [...new Set((notes ?? []).map((n) => n.reel_id))];
const { data: reels, error: e2 } = ids.length
  ? await s.from('loro_cut_reels').select('id, account, batch, slot, version, hook, lines, status, job').in('id', ids)
  : { data: [], error: null };
if (e2) throw new Error(e2.message);

type Line = { text: string; from: number; to: number };
const out = (reels ?? []).map((r) => {
  const beat = Number((r.job as { beat?: number } | null)?.beat ?? 3);
  const onScreen = (t: number) => {
    const l = (r.lines as Line[]).find((x) => t >= x.from && t < x.to);
    return l ? `line: ${l.text}` : t < beat ? `hook: ${r.hook}` : '';
  };
  return {
    ...r,
    notes: (notes ?? [])
      .filter((n) => n.reel_id === r.id)
      .map((n) => ({ ...n, on_screen: onScreen(Number(n.at_s)) })),
  };
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 1));
} else if (out.length === 0) {
  console.log('No open notes.');
} else {
  for (const r of out) {
    console.log(`\n@${r.account} ${r.batch} #${r.slot} v${r.version} [${r.status}]  id=${r.id}`);
    for (const n of r.notes) {
      const stale = n.version < r.version ? ` (left on v${n.version})` : '';
      console.log(`  ${Number(n.at_s).toFixed(1)}s  ${n.body}${stale}\n        note=${n.id}  ${n.on_screen}`);
    }
  }
}
