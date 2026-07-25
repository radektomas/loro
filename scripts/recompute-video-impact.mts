#!/usr/bin/env node
/**
 * Loro — one-off recompute of loro_videos.saved_count and mastered_count.
 *
 *   node scripts/recompute-video-impact.mts            # dry run, prints the diff
 *   node scripts/recompute-video-impact.mts --apply    # write the corrections
 *
 * WHY THIS EXISTS. The box CHECK constraint was `box <= 5` while the app's
 * MAX_BOX is 6 (fixed in 20260725010000_saved_words_box_6.sql), so the
 * loro_track_video_impact trigger — which counts mastery at box >= 6 — has
 * never fired its mastery branch, and the sync poisoning the bug caused
 * (one box-6 word blocks a user's whole upsert batch) means some INSERTs
 * arrived late or not at all, skewing saved_count too.
 *
 * SEMANTICS, stated because they differ from the trigger's: the trigger's
 * DELETE branch says "mastery stays earned" — mastered_count is historical.
 * This recompute defines both counters from CURRENT rows instead:
 *
 *   saved_count    = rows in loro_saved_words with video_id = this video
 *   mastered_count = those rows at box >= 6
 *
 * That is the only reconstructible definition: the historical "stays earned"
 * count was never recorded (the bug made box 6 unreachable server-side, so
 * zero mastery increments ever happened — there is no history to preserve).
 * From the moment this runs, the trigger resumes its incremental semantics on
 * top of a correct baseline.
 *
 * Service-role only (counter columns are deliberately not client-writable).
 * Safe to re-run; each run converges to the same result.
 */

import { loadEnv } from './lib/env.mts';
import { getAdminClient } from './lib/supabaseAdmin.mts';

const MASTERED_BOX = 6; // mirrors top_box in loro_track_video_impact()

const apply = process.argv.includes('--apply');

loadEnv();
const supabase = getAdminClient();

// Current truth: every saved word's video and box, paginated past the
// 1000-row PostgREST default so a growing table can't silently truncate.
const words: { video_id: string; box: number }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('loro_saved_words')
    .select('video_id, box')
    .range(from, from + 999);
  if (error) throw new Error(`reading loro_saved_words: ${error.message}`);
  words.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const saved = new Map<string, number>();
const mastered = new Map<string, number>();
for (const w of words) {
  saved.set(w.video_id, (saved.get(w.video_id) ?? 0) + 1);
  if (w.box >= MASTERED_BOX) {
    mastered.set(w.video_id, (mastered.get(w.video_id) ?? 0) + 1);
  }
}

const videos: { id: string; saved_count: number; mastered_count: number }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('loro_videos')
    .select('id, saved_count, mastered_count')
    .range(from, from + 999);
  if (error) throw new Error(`reading loro_videos: ${error.message}`);
  videos.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

console.log(`\nRecompute video impact${apply ? '' : ' (DRY RUN)'}`);
console.log(`  ${words.length} saved words across ${saved.size} video ids, ${videos.length} videos\n`);

let drift = 0;
for (const v of videos) {
  // The trigger matches id::text = video_id, so the map key is the uuid text.
  const wantSaved = saved.get(v.id) ?? 0;
  const wantMastered = mastered.get(v.id) ?? 0;
  if (v.saved_count === wantSaved && v.mastered_count === wantMastered) continue;

  drift += 1;
  console.log(
    `  ${v.id}  saved ${v.saved_count} -> ${wantSaved}   mastered ${v.mastered_count} -> ${wantMastered}`
  );

  if (apply) {
    const { error } = await supabase
      .from('loro_videos')
      .update({ saved_count: wantSaved, mastered_count: wantMastered })
      .eq('id', v.id);
    if (error) throw new Error(`updating ${v.id}: ${error.message}`);
  }
}

// Saved words pointing at video ids that aren't UGC rows (seed clips and
// YouTube embeds live in JSON, not loro_videos) are expected and not drift —
// the trigger's `where id::text = video_id` update simply matches nothing for
// them, exactly as in normal operation.
const ugcIds = new Set(videos.map((v) => v.id));
const nonUgc = [...saved.keys()].filter((id) => !ugcIds.has(id)).length;

console.log(
  drift === 0
    ? '  all counters already correct.'
    : `\n  ${drift} video(s) ${apply ? 'corrected' : 'need correction (re-run with --apply)'}.`
);
console.log(`  (${nonUgc} video id(s) in saved words are non-UGC — JSON-shipped, no counters, expected.)\n`);
