#!/usr/bin/env node
/**
 * Answer a note with a QUESTION instead of a recut — for a headless run, where
 * nobody can be asked in a chat.
 *
 *   node scripts/cut/ask.mts <note id> "Lower by how much, below his chin?"
 *
 * The question shows under Radek's note on getloro.app/cut. The note stays
 * open, and the watcher does not start again for it: it waits for Radek to
 * write a new note (his answer), and that run handles both.
 */
import { getAdminClient } from '../lib/supabaseAdmin.mts';

const [id, ...rest] = process.argv.slice(2);
const question = rest.join(' ').trim();
if (!id || !question) {
  console.error('usage: node scripts/cut/ask.mts <note id> "question"');
  process.exit(1);
}
const { error } = await getAdminClient()
  .from('loro_cut_notes')
  .update({ reply: `❓ ${question}` })
  .eq('id', id)
  .is('done_version', null);
if (error) throw new Error(error.message);
console.log(`✓ asked on note ${id}`);
