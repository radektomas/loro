#!/usr/bin/env node
/**
 * Lets an open Claude chat jump on Radek's notes from getloro.app/cut.
 *
 *   node scripts/cut/wait-notes.mts            # blocks until it CLAIMS notes, prints them, exits
 *   node scripts/cut/wait-notes.mts --release  # after the recut: frees the claim
 *
 * Every chat in the loro repo runs the first form in the background (a
 * SessionStart hook tells it to). It polls every POLL_S. Once there are open
 * notes nobody has handled and the newest is QUIET_S old (three notes typed in
 * a row → one recut), it tries to take the claim: mkdir is atomic, so when
 * several chats are open exactly one wins and the others keep waiting. The
 * winner prints the note ids and exits, which wakes that chat; it recuts with
 * the cut-reels skill, then runs --release and starts waiting again.
 *
 * It also keeps loro-cuts/_worker.json fresh, so the page can say "a Claude
 * chat is watching" (heartbeat) and "Claude is on it" (claimed).
 *
 * A claim older than STALE_MIN (a chat closed mid-recut) is broken by the next
 * waiter, so notes never get stuck.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { getAdminClient } from '../lib/supabaseAdmin.mts';
import { CUT_BUCKET } from '../../lib/cutReels.ts';

const POLL_S = 10;
const QUIET_S = 20;
const HEARTBEAT_S = 60;
const STALE_MIN = 30;
const LOCK = `${process.env.HOME}/Desktop/Reels/.recut-claim`;

const s = getAdminClient();

async function status(state: 'watching' | 'working', noteIds: string[] = []) {
  const body = { state, noteIds, at: new Date().toISOString() };
  await s.storage.from(CUT_BUCKET).upload('_worker.json', JSON.stringify(body), { contentType: 'application/json', upsert: true, cacheControl: '0' });
}

if (process.argv.includes('--release')) {
  rmSync(LOCK, { recursive: true, force: true });
  await status('watching');
  console.log('released');
  process.exit(0);
}

function claim(ids: string[]): boolean {
  try {
    if (Date.now() - statSync(LOCK).mtimeMs > STALE_MIN * 60_000) rmSync(LOCK, { recursive: true, force: true });
  } catch {
    /* no claim yet */
  }
  try {
    mkdirSync(LOCK);
  } catch {
    return false; // another chat is on it
  }
  writeFileSync(`${LOCK}/notes.json`, JSON.stringify({ ids, pid: process.ppid, at: new Date().toISOString() }));
  return true;
}

let lastBeat = 0;
for (;;) {
  try {
    const { data, error } = await s
      .from('loro_cut_notes')
      .select('id, created_at')
      .is('done_version', null)
      .is('reply', null)
      .order('created_at');
    if (error) throw new Error(error.message);
    const notes = data ?? [];
    const newest = notes.length ? Date.parse(notes[notes.length - 1].created_at) : 0;
    if (notes.length && Date.now() - newest >= QUIET_S * 1000) {
      const ids = notes.map((n) => n.id);
      if (claim(ids)) {
        await status('working', ids);
        console.log(`CLAIMED ${ids.length} note(s): ${ids.join(' ')}`);
        console.log('Recut them now with the cut-reels skill (node scripts/cut/notes.mts), then run: node scripts/cut/wait-notes.mts --release, and start waiting again.');
        process.exit(0);
      }
    }
    // heartbeat only while nobody holds a claim, so "working" stays on the page during a recut
    let claimed = false;
    try {
      readFileSync(`${LOCK}/notes.json`);
      claimed = true;
    } catch {
      /* free */
    }
    if (!claimed && Date.now() - lastBeat >= HEARTBEAT_S * 1000) {
      await status('watching');
      lastBeat = Date.now();
    }
  } catch (e) {
    console.error(`wait-notes: ${(e as Error).message}`); // stderr: doesn't wake the chat
  }
  await new Promise((r) => setTimeout(r, POLL_S * 1000));
}
