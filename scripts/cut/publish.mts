#!/usr/bin/env node
/**
 * Put rendered reels on getloro.app/cut.
 *
 *   node scripts/cut/publish.mts <job.json> [<job.json> …]
 *
 * Each job.json is a scripts/cut/render.py job that has ALREADY been rendered
 * (its <out>, <out>.jpg and <out>.json exist) and carries three extra keys:
 *
 *   "account": "radek.spanish" | "radek.explains.spanish" | "loro.app",
 *   "batch":   "2026-11-10",
 *   "slot":    1,
 *   optional "replies": { "<note id>": "what I changed" }   — closes those notes
 *   optional "plan_item_id": "<uuid>"   — the scaler plan item this reel was cut from
 *
 * First publish of (account, batch, slot) creates the reel at version 1. A
 * later publish is a recut: version + 1, status back to "review" (unless the
 * reel is already "posted": then it stays posted with its link and views, so
 * tracking survives a recut), and every note named in "replies" is marked
 * answered by the new version.
 *
 * Videos go to the PRIVATE loro-cuts bucket (created on first run); the page
 * reads them through signed URLs. Needs SUPABASE_SERVICE_ROLE_KEY in .env.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getAdminClient } from '../lib/supabaseAdmin.mts';
import { CUT_BUCKET, ACCOUNTS, type Account } from '../../lib/cutReels.ts';

const s = getAdminClient();

async function ensureBucket() {
  const { data } = await s.storage.getBucket(CUT_BUCKET);
  if (data) return;
  const { error } = await s.storage.createBucket(CUT_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw new Error(`create bucket: ${error.message}`);
}

async function upload(dest: string, file: string, contentType: string) {
  const { error } = await s.storage.from(CUT_BUCKET).upload(dest, readFileSync(file), { contentType, upsert: true });
  if (error) throw new Error(`upload ${dest}: ${error.message}`);
}

async function publish(jobPath: string) {
  const job = JSON.parse(readFileSync(jobPath, 'utf8'));
  const base = path.dirname(path.resolve(jobPath));
  const abs = (p: string) => (path.isAbsolute(p) ? p : path.join(base, p));
  const account = job.account as Account;
  if (!ACCOUNTS.includes(account)) throw new Error(`${jobPath}: account must be one of ${ACCOUNTS.join(', ')}`);
  if (!job.batch || !job.slot) throw new Error(`${jobPath}: needs "batch" and "slot"`);
  const out = abs(job.out);
  for (const f of [out, `${out}.jpg`, `${out}.json`]) if (!existsSync(f)) throw new Error(`missing ${f} — render it first`);
  const meta = JSON.parse(readFileSync(`${out}.json`, 'utf8'));

  const { data: prev, error: e1 } = await s
    .from('loro_cut_reels')
    .select('id, version, status')
    .eq('account', account)
    .eq('batch', job.batch)
    .eq('slot', job.slot)
    .maybeSingle();
  if (e1) throw new Error(e1.message);
  const version = prev ? prev.version + 1 : 1;

  const stem = `${account}/${job.batch}/${String(job.slot).padStart(2, '0')}-v${version}`;
  await upload(`${stem}.mp4`, out, 'video/mp4');
  await upload(`${stem}.jpg`, `${out}.jpg`, 'image/jpeg');

  // the job is stored with absolute source paths so a recut works from any checkout
  const storedJob = { ...job, me: abs(job.me), demo: abs(job.demo), out };
  delete storedJob.replies;
  const row = {
    account,
    batch: job.batch,
    slot: job.slot,
    version,
    hook: meta.hook,
    lines: meta.lines,
    duration_s: meta.duration,
    video_path: `${stem}.mp4`,
    poster_path: `${stem}.jpg`,
    me_file: meta.me,
    demo_file: meta.demo,
    job: storedJob,
    // a posted reel keeps its status: "review" would hide its link + views
    // boxes on /cut and drop it out of hook tracking (happened 2026-11-11)
    status: prev?.status === 'posted' ? 'posted' : 'review',
    updated_at: new Date().toISOString(),
  };
  const { data: saved, error: e2 } = prev
    ? await s.from('loro_cut_reels').update(row).eq('id', prev.id).select('id').single()
    : await s.from('loro_cut_reels').insert(row).select('id').single();
  if (e2) throw new Error(e2.message);

  // cut from an approved scaler plan: mark that plan item as cut, so the
  // plan's track record can follow the reel once it's posted
  if (job.plan_item_id) {
    const { error } = await s.from('loro_scale_plan_items').update({ status: 'cut', cut_reel_id: saved.id }).eq('id', job.plan_item_id);
    if (error) throw new Error(`plan item ${job.plan_item_id}: ${error.message}`);
  }

  const replies = Object.entries((job.replies ?? {}) as Record<string, string>);
  for (const [noteId, reply] of replies) {
    const { error } = await s
      .from('loro_cut_notes')
      .update({ done_version: version, reply })
      .eq('id', noteId)
      .eq('reel_id', saved.id);
    if (error) throw new Error(`note ${noteId}: ${error.message}`);
  }
  if (replies.length) {
    // answered: drop them from the job so the next recut doesn't answer them again
    const { replies: _done, ...rest } = job;
    writeFileSync(jobPath, JSON.stringify(rest, null, 1) + '\n');
  }
  console.log(`✓ @${account} ${job.batch} #${job.slot} v${version}${replies.length ? ` · answered ${replies.length} note(s)` : ''}`);
}

await ensureBucket();
let failed = 0;
for (const j of process.argv.slice(2)) {
  try {
    await publish(j);
  } catch (e) {
    failed++;
    console.error(`✗ ${j}: ${(e as Error).message}`);
  }
}
if (process.argv.length < 3) console.error('usage: node scripts/cut/publish.mts <job.json> …');
process.exit(failed || process.argv.length < 3 ? 1 : 0);
