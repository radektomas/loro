#!/usr/bin/env node
/**
 * Verbose caption-fetch probe — run this when publish-embeds can't fetch.
 *
 *   npm run probe-captions -- rnY8kn2rqDA [moreIds...]
 *
 * Prints every step of both strategies (Android API, watch page) so a failed
 * fetch shows exactly WHERE it died: consent wall, empty pot-gated body,
 * missing track, or parse failure. Zero writes, zero quota.
 */

process.env.LORO_DEBUG_CAPTIONS = '1';

const { fetchCaptions } = await import('./lib/captionFetch.mts');
const { json3ToWords } = await import('./lib/json3ToCues.mts');

const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (ids.length === 0) {
  console.error('\nUsage: npm run probe-captions -- <videoId> [moreIds...]\n');
  process.exit(1);
}

for (const id of ids) {
  console.log(`\n════════ ${id} ════════`);
  try {
    const { json3, track } = await fetchCaptions(id);
    const words = json3ToWords(json3);
    console.log(`✓ track ${track.languageCode}/${track.kind || 'uploaded'} — ${json3.events?.length} events, ${words.length} words`);
    const sample = words.slice(0, 8);
    console.log(
      '  first words: ' +
        sample.map((w) => `"${w.text}"@${w.start.toFixed(2)}s`).join(' ')
    );
    const distinctStarts = new Set(sample.map((w) => w.start)).size;
    console.log(
      `  WORD-LEVEL TIMING: ${distinctStarts > 1 ? 'YES' : 'NO — cue-level only'}`
    );
  } catch (error) {
    console.log(`✗ ${error instanceof Error ? error.message : error}`);
  }
}
console.log('');
