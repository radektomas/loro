/**
 * Loro — the onboarding walkthrough's script, checked against the real catalog.
 *
 * WHY THIS TEST EXISTS. The guided taste reel (apps/mobile/src/onboarding/
 * taste.ts) is a set of numbers pointing into data/embedVideos.json: a word
 * that must be spoken in two specific clips, a second to stop the first clip
 * on, and the cue that must be on screen when it stops. None of that is checked
 * at runtime, and it CANNOT be — the walkthrough is best-effort by design, so
 * every one of those numbers going wrong degrades silently to "three clips you
 * swipe" rather than throwing. That is the right behaviour on a stranger's
 * phone and the worst possible behaviour in a repo, because it means swapping a
 * clip breaks the demonstration and nothing says so.
 *
 * So the loud failure lives here instead. If someone changes TASTE_REEL and the
 * shared word stops being shared, this test names the problem.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPO_ROOT } from './lib/env.mts';
import { computeLevelBlankPlan } from '../packages/core/src/levels.ts';
import { TASTE_REEL, WALKTHROUGH } from '../apps/mobile/src/onboarding/taste.ts';

type Word = { text: string; start: number; end: number };
type Cue = { start: number; end: number; words: Word[] };
type Embed = {
  id: string;
  youtubeId?: string;
  level: string;
  cues: Cue[];
  dictionary?: Record<string, unknown>;
};

const embeds = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'data', 'embedVideos.json'), 'utf8')
) as Embed[];
const byId = new Map(embeds.map((v) => [v.id, v]));

/** The walkthrough's own match rule: accent- and punctuation-insensitive. */
const flat = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]/g, '');

/** The dictionary's key rule, which is a different (looser) normalisation. */
const dictKey = (s: string) =>
  s.toLowerCase().replace(/^[^a-z0-9áéíóúüñ]+|[^a-z0-9áéíóúüñ]+$/g, '');

function occurrences(video: Embed, word: string) {
  const out: { cueIndex: number; start: number; end: number }[] = [];
  video.cues.forEach((cue, cueIndex) => {
    for (const w of cue.words) {
      if (flat(w.text) === flat(word)) out.push({ cueIndex, start: w.start, end: w.end });
    }
  });
  return out;
}

test('every reel clip is in the catalog and embeddable', () => {
  assert.ok(TASTE_REEL.length >= 2, 'the walkthrough needs at least two clips');
  for (const id of TASTE_REEL) {
    const video = byId.get(id);
    assert.ok(video, `TASTE_REEL id ${id} is not in data/embedVideos.json`);
    assert.ok(video.youtubeId, `${id} has no youtubeId, so it cannot be played`);
    assert.ok(video.cues.length > 0, `${id} has no cues, so there is no karaoke line`);
  }
});

test('every hold point sits on the word, inside its own cue', () => {
  const clip = byId.get(TASTE_REEL[WALKTHROUGH.tap.clip]);
  assert.ok(clip, 'the tap clip is missing');

  const hits = occurrences(clip, WALKTHROUGH.word);
  assert.ok(
    hits.length > 0,
    `"${WALKTHROUGH.word}" is never spoken in ${clip.id} — nothing to point at`
  );
  assert.ok(WALKTHROUGH.tap.holds.length > 0, 'there must be at least one hold');

  let previous = -Infinity;
  for (const [n, hold] of WALKTHROUGH.tap.holds.entries()) {
    const where = `hold ${n} (cue ${hold.cueIndex} @ ${hold.holdAt}s)`;
    const cue = clip.cues[hold.cueIndex];
    assert.ok(cue, `${where}: ${clip.id} has no cue ${hold.cueIndex}`);

    const atCue = hits.filter((h) => h.cueIndex === hold.cueIndex);
    assert.ok(
      atCue.length > 0,
      `${where}: "${WALKTHROUGH.word}" is not in that cue; it is in ` +
        `cue(s) ${[...new Set(hits.map((h) => h.cueIndex))].join(', ')}`
    );

    // Inside its own cue, or the karaoke line moves on under the ring.
    assert.ok(
      hold.holdAt > cue.start && hold.holdAt <= cue.end,
      `${where} is outside cue ${hold.cueIndex} [${cue.start}-${cue.end}]`
    );

    // At or after the word has been SPOKEN — a word pointed at before it is
    // heard is a spoiler, not a prompt.
    assert.ok(
      atCue.some((h) => hold.holdAt >= h.end),
      `${where} is before "${WALKTHROUGH.word}" finishes ` +
        `(ends at ${atCue.map((h) => h.end.toFixed(2)).join(', ')}s)`
    );

    // Ordered, because the fallbacks are reached by letting the clip play on.
    assert.ok(hold.holdAt > previous, `${where} does not come after the one before it`);
    previous = hold.holdAt;
  }

  assert.ok(
    clip.dictionary?.[dictKey(WALKTHROUGH.word)],
    `${clip.id} has no dictionary entry for "${WALKTHROUGH.word}", so the save has no gloss`
  );
});

test('the coached word comes back in the fill clip', () => {
  const clip = byId.get(TASTE_REEL[WALKTHROUGH.fill.clip]);
  assert.ok(clip, 'the fill clip is missing');

  const hits = occurrences(clip, WALKTHROUGH.word);
  assert.ok(
    hits.length > 0,
    `"${WALKTHROUGH.word}" is never spoken in ${clip.id} — the promise made in ` +
      'clip one ("it comes back as a blank") would be broken by the next screen'
  );

  // core places the asked-for word at its EARLIEST audible cue (srs.ts
  // locateAsked), so that is the cue the blank will land on.
  const earliest = Math.min(...hits.map((h) => h.cueIndex));
  assert.equal(
    earliest,
    WALKTHROUGH.fill.expectedCueIndex,
    `core will blank "${WALKTHROUGH.word}" at cue ${earliest} of ${clip.id}, ` +
      `but the script records ${WALKTHROUGH.fill.expectedCueIndex}`
  );

  // It has to arrive soon enough that nobody scrolls past it first.
  const arrivesAt = clip.cues[earliest].start;
  assert.ok(
    arrivesAt <= 20,
    `the blank arrives ${arrivesAt.toFixed(1)}s into ${clip.id}, which is long ` +
      'enough that most people will have swiped away before it appears'
  );

  assert.ok(
    clip.dictionary?.[dictKey(WALKTHROUGH.word)],
    `${clip.id} has no dictionary entry for "${WALKTHROUGH.word}"`
  );
});

test('the fill clip opens just before the word, not at the start', () => {
  const clip = byId.get(TASTE_REEL[WALKTHROUGH.fill.clip]);
  assert.ok(clip, 'the fill clip is missing');
  const startAt = WALKTHROUGH.fill.startAt;

  const hits = occurrences(clip, WALKTHROUGH.word);
  assert.ok(hits.length > 0, 'checked by the previous test');
  const earliest = hits.reduce((a, b) => (a.cueIndex <= b.cueIndex ? a : b));

  assert.ok(
    startAt < earliest.start,
    `startAt ${startAt}s is at or after "${WALKTHROUGH.word}" (${earliest.start}s), ` +
      'so the clip would open past the word it exists to lead into'
  );

  // Close enough to be a lead-in rather than a wait. Anything longer and the
  // user is watching an unexplained clip; anything shorter and the blank is on
  // screen before they have settled.
  const leadIn = earliest.start - startAt;
  assert.ok(
    leadIn >= 1 && leadIn <= 6,
    `the lead-in is ${leadIn.toFixed(1)}s, which is outside the 1-6s the beat wants`
  );

  const last = clip.cues[clip.cues.length - 1];
  assert.ok(startAt >= 0 && startAt < last.end, `startAt ${startAt}s is outside the clip`);
});

test('the tap clip and the fill clip are different videos', () => {
  assert.notEqual(
    TASTE_REEL[WALKTHROUGH.tap.clip],
    TASTE_REEL[WALKTHROUGH.fill.clip],
    'the word has to come back in a DIFFERENT video, or it demonstrates nothing'
  );
});

/**
 * THE ONE BLUE BLANK ON THE LAST CLIP, AND THE CARD THAT MUST NOT BEAT IT.
 *
 * The last clip's level blank is the only place in onboarding that shows the
 * level ladder exists, and TWO numbers decide whether anybody ever sees it:
 * a floor that pushes it out of the clip's opening seconds, and the closing
 * card's timer, which is racing it. Both live in WALKTHROUGH.last.
 *
 * Neither is checked at runtime and both fail silently — too high a floor and
 * there is no blue blank, too low a timer and the card covers it — so a clip
 * swap could delete the beat with nothing to show for it but a reel that feels
 * slightly emptier. Hence this.
 *
 * LEVEL 1 IS THE CASE THAT MATTERS. It is what every fresh device carries, and
 * a device reaching onboarding has by definition not climbed anywhere, so it is
 * the only level this reel is ever planned at in practice. The others are
 * checked for the floor alone, since a returning user replaying the flow should
 * not meet a gap in the first breath either.
 */
test('the last clip keeps its blue blank, and the closing card waits for it', () => {
  const clip = byId.get(TASTE_REEL[TASTE_REEL.length - 1]);
  assert.ok(clip, 'the last clip is missing');
  const { blankAfterS, outroAfterPlayedMs } = WALKTHROUGH.last;
  const outroAtS = outroAfterPlayedMs / 1000;

  /** recall.ts's CUE_START_PAD_S, mirrored so pauseAt matches the app's. */
  const CUE_START_PAD_S = 0.02;

  const planAt = (level: number) =>
    [...computeLevelBlankPlan(clip as never, level, [], 'en', new Set()).entries()]
      .map(([cueIndex, planned]) => {
        // What RecallHost filters on: the moment the video actually STOPS.
        // Same resolution as locateBlank — the first word in the cue matching
        // the planned text, clamped inside the cue's display window.
        const cue = clip.cues[cueIndex];
        const word = cue.words.find((w) => flat(w.text) === flat(planned.text));
        assert.ok(word, `cue ${cueIndex} does not contain "${planned.text}"`);
        return {
          cueIndex,
          text: planned.text,
          pauseAt: Math.min(cue.end, Math.max(word.end, cue.start + CUE_START_PAD_S)),
        };
      })
      .sort((a, b) => a.cueIndex - b.cueIndex);

  for (const level of [1, 2, 3, 4, 5, 6]) {
    const survivors = planAt(level).filter((e) => e.pauseAt >= blankAfterS);
    assert.ok(
      survivors.length > 0,
      `at level ${level} the floor of ${blankAfterS}s removes every blue blank ` +
        `from ${clip.id}, so the last clip would show none at all`
    );
    if (level !== 1) continue;

    const first = survivors[0];
    assert.ok(
      first.pauseAt >= blankAfterS,
      `the level 1 blank stops the clip at ${first.pauseAt.toFixed(2)}s, ` +
        `inside the ${blankAfterS}s the clip is meant to just play`
    );
    assert.ok(
      first.pauseAt < outroAtS,
      `the closing card comes up after ${outroAtS}s of playback but the level 1 ` +
        `blank does not arrive until ${first.pauseAt.toFixed(2)}s, so the card ` +
        'would cover the only blue blank in the whole flow'
    );
    // A tail, so the reel ends on speech rather than on a gap that was just
    // filled. Under a second would read as the card interrupting the answer.
    assert.ok(
      outroAtS - first.pauseAt >= 2,
      `only ${(outroAtS - first.pauseAt).toFixed(2)}s of video is left after the ` +
        'blank before the closing card, which is too abrupt an ending'
    );
  }
});
