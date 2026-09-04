import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT } from './lib/env.mts';
import { alreadyBlocked, insertBlockedVideos, type NewBlock } from './block-videos.mts';

const CONFIG = readFileSync(
  path.join(REPO_ROOT, 'scripts', 'config', 'harvest-queries.mts'),
  'utf8'
);

const ENTRY: NewBlock = {
  youtubeId: 'zzTESTzz001',
  title: 'Some Channel — A title',
  reason: 'test',
};

test('appends inside the BLOCKED_VIDEOS array, not after it', () => {
  const out = insertBlockedVideos(CONFIG, [ENTRY]);
  const start = out.indexOf('export const BLOCKED_VIDEOS');
  const close = out.indexOf('\n];', start);
  const inserted = out.indexOf('zzTESTzz001');
  assert.ok(inserted > start, 'entry lands after the declaration');
  assert.ok(inserted < close, 'entry lands before the closing bracket');
});

test('the edited config still parses as a module', async () => {
  // The real regression risk is producing syntactically valid-looking text
  // that TypeScript cannot load. Importing a data: URL is not possible here
  // (the config imports siblings), so assert the structural invariants that
  // string surgery can actually break.
  const out = insertBlockedVideos(CONFIG, [ENTRY]);
  const opens = (out.match(/\{/g) ?? []).length;
  const closes = (out.match(/\}/g) ?? []).length;
  assert.equal(opens, closes, 'braces stay balanced');
  assert.match(out, /youtubeId: 'zzTESTzz001',\n {4}title: 'Some Channel — A title',/);
  assert.match(out, /reason: 'test',\n {2}\},\n\];/);
});

test('escapes quotes in titles rather than breaking the literal', () => {
  const out = insertBlockedVideos(CONFIG, [
    { youtubeId: 'x1', title: "Bob's Channel — \\ backslash", reason: "it's bad" },
  ]);
  assert.match(out, /title: 'Bob\\'s Channel — \\\\ backslash'/);
  assert.match(out, /reason: 'it\\'s bad'/);
});

test('inserting nothing changes nothing', () => {
  assert.equal(insertBlockedVideos(CONFIG, []), CONFIG);
});

test('appends several entries in order', () => {
  const out = insertBlockedVideos(CONFIG, [
    { ...ENTRY, youtubeId: 'aaa' },
    { ...ENTRY, youtubeId: 'bbb' },
  ]);
  assert.ok(out.indexOf("youtubeId: 'aaa'") < out.indexOf("youtubeId: 'bbb'"));
});

test('refuses to guess when the declaration is missing', () => {
  assert.throws(
    () => insertBlockedVideos('const other = [];\n', [ENTRY]),
    /Could not find/
  );
});

test('alreadyBlocked sees ids the real config holds, and not others', () => {
  // Mi Coreana's line-timed-captions row, blocked 2026-09-01.
  assert.equal(alreadyBlocked(CONFIG, '1qrp5PogzhU'), true);
  assert.equal(alreadyBlocked(CONFIG, 'definitely-not-in-there'), false);
});

test('a blocked id stays blocked after a round trip', () => {
  const out = insertBlockedVideos(CONFIG, [ENTRY]);
  assert.equal(alreadyBlocked(out, ENTRY.youtubeId), true);
  assert.equal(insertBlockedVideos(out, []), out);
});
