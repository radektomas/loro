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
 *
 * THE STEP IS CURRENTLY BENCHED (steps.tsx TASTE_BENCHED, 2026-09-01) but
 * these tests keep running on purpose: the script is maintained for its
 * return, and numbers that rot silently while benched would make un-benching
 * a debugging session instead of a flag flip.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPO_ROOT } from './lib/env.mts';
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

test('the coached word comes back in the fill clip, mid-sentence', () => {
  const clip = byId.get(TASTE_REEL[WALKTHROUGH.fill.clip]);
  assert.ok(clip, 'the fill clip is missing');

  // The cue is PINNED (TasteStep passes fill.expectedCueIndex as
  // focusCueIndex), not derived from earliest occurrence — que's earliest is
  // this clip's opening line, before startAt, where nobody is looking. So
  // what must hold is that the pinned cue actually speaks the word.
  const cue = clip.cues[WALKTHROUGH.fill.expectedCueIndex];
  assert.ok(cue, `${clip.id} has no cue ${WALKTHROUGH.fill.expectedCueIndex}`);
  const wordIndex = cue.words.findIndex((w) => flat(w.text) === flat(WALKTHROUGH.word));
  assert.ok(
    wordIndex >= 0,
    `"${WALKTHROUGH.word}" is not in cue ${WALKTHROUGH.fill.expectedCueIndex} of ` +
      `${clip.id} — the pinned blank would fall back to core's placement, before startAt`
  );

  // MID-SENTENCE, which is the visibility fix this pin exists for (Radek on
  // device, 2026-09-01): a line-initial gap renders and freezes in one
  // motion; a mid-line gap is seen with words lighting up around it.
  assert.ok(
    wordIndex > 0 && wordIndex < cue.words.length - 1,
    `"${WALKTHROUGH.word}" is word ${wordIndex} of ${cue.words.length - 1} in its ` +
      'cue — the blank must sit mid-sentence so the gap is visibly a gap'
  );

  // It has to arrive soon enough that nobody scrolls past it first.
  assert.ok(
    cue.start <= 20,
    `the blank arrives ${cue.start.toFixed(1)}s into ${clip.id}, which is long ` +
      'enough that most people will have swiped away before it appears'
  );

  // An ENGLISH GLOSS, not just an entry: the saved-word path needs it for
  // the sheet, and the missed-tap path needs it harder — when clip 1's tap
  // never happened, this same word arrives in this same cue as a scripted
  // BLUE blank (TasteStep's fallback), and buildScriptedLevelBlank refuses
  // a word it cannot gloss. Either colour of the beat dies without it.
  const fillGloss = (clip.dictionary ?? {})[dictKey(WALKTHROUGH.word)] as
    | { glosses?: Record<string, string | null> }
    | undefined;
  assert.ok(
    fillGloss?.glosses?.en,
    `"${WALKTHROUGH.word}" has no English gloss in ${clip.id}'s dictionary — ` +
      'both the green blank and the blue fallback need one'
  );
});

test('the fill clip opens just before the word, not at the start', () => {
  const clip = byId.get(TASTE_REEL[WALKTHROUGH.fill.clip]);
  assert.ok(clip, 'the fill clip is missing');
  const startAt = WALKTHROUGH.fill.startAt;

  // The occurrence that matters is the PINNED one — see the previous test.
  const pinned = occurrences(clip, WALKTHROUGH.word).find(
    (h) => h.cueIndex === WALKTHROUGH.fill.expectedCueIndex
  );
  assert.ok(pinned, 'checked by the previous test');

  assert.ok(
    startAt < pinned.start,
    `startAt ${startAt}s is at or after "${WALKTHROUGH.word}" (${pinned.start}s), ` +
      'so the clip would open past the word it exists to lead into'
  );

  // Close enough to be a lead-in rather than a wait. Anything longer and the
  // user is watching an unexplained clip; anything shorter and the blank is on
  // screen before they have settled.
  const leadIn = pinned.start - startAt;
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
 * THE SCRIPTED BLUE BLANK, AND THE CARD BEHIND IT.
 *
 * 2026-09-01, round two: the last clip's blank is scripted, not planned —
 * exactly "mi", now at cue 2 (WALKTHROUGH.last.blank). The beat: the clip
 * starts from 0:00, the OPENING line hands out the answer ("…a hacer MI
 * peinado siempre"), two lines play, and the freeze lands on the second
 * "mi" mid-line at ~5.6s. The first "mi" (cue 0, a 0.96s freeze) held the
 * slot for one morning and read on device as "starts ON the blank" — a
 * clip that never visibly played.
 *
 * The planner cannot be trusted with any of this (it chooses by frequency
 * band, not by which word the opening line just gave away), which is why
 * it is scripted, and why nothing checks it at runtime:
 * buildScriptedLevelBlank returns null on any miss and the reel silently
 * degrades to a clip that plays 7.5s and closes. A clip swap, a
 * re-transcription that moves the word, or a dictionary regeneration that
 * drops the gloss would all delete the beat without a sound. Hence this.
 */
test('the scripted "mi" blank waits mid-clip, after its giveaway line', () => {
  const clip = byId.get(TASTE_REEL[TASTE_REEL.length - 1]);
  assert.ok(clip, 'the last clip is missing');
  const { blank, outroAfterPlayedMs } = WALKTHROUGH.last;
  const outroAtS = outroAfterPlayedMs / 1000;

  /** recall.ts's pads, mirrored so pauseAt matches locateBlank exactly
      (CUE_END_PAD_S keeps a last-word hold strictly inside its cue). */
  const CUE_START_PAD_S = 0.02;
  const CUE_END_PAD_S = 0.12;

  const cue = clip.cues[blank.cueIndex];
  assert.ok(cue, `the last clip has no cue ${blank.cueIndex}`);

  // The word must be there, audible, and glossable — the three conditions
  // buildScriptedLevelBlank enforces, mirrored against the raw data.
  const wordIndex = cue.words.findIndex((w) => flat(w.text) === flat(blank.text));
  assert.ok(
    wordIndex >= 0,
    `cue ${blank.cueIndex} of ${clip.id} does not contain "${blank.text}" — ` +
      'the scripted blank would silently resolve to nothing'
  );
  const word = cue.words[wordIndex];
  assert.ok(
    word.end - word.start > 0.05,
    `"${blank.text}" has no audible span (${word.start}-${word.end}) — ` +
      'a word never heard must not be blanked'
  );
  const gloss = (clip.dictionary ?? {})[flat(blank.text)] as
    | { glosses?: Record<string, string | null> }
    | undefined;
  assert.ok(
    gloss?.glosses?.en,
    `"${blank.text}" has no English gloss in ${clip.id}'s dictionary — ` +
      'the empty slot would have no prompt'
  );

  // MID-LINE, same rule as the fill clip's blank and the same device verdict
  // behind it: the gap must be seen inside a sentence, words lighting up on
  // their way toward it, not hugging an edge of the line.
  assert.ok(
    wordIndex > 0 && wordIndex < cue.words.length - 1,
    `"${blank.text}" is word ${wordIndex} of ${cue.words.length - 1} in cue ` +
      `${blank.cueIndex} — the blank must sit mid-sentence so the gap is visibly a gap`
  );

  // THE GIVEAWAY LINE: an earlier cue must speak the word first. The beat is
  // "hear it handed out, then hand it back" — without the early occurrence
  // this is just a quiz on a function word.
  assert.ok(
    occurrences(clip, blank.text).some((h) => h.cueIndex < blank.cueIndex),
    `no cue before ${blank.cueIndex} speaks "${blank.text}" — the giveaway ` +
      'line the beat is built on is gone'
  );

  // THE LEAD-IN. The clip starts from 0:00, so the freeze point alone decides
  // whether the clip visibly PLAYS first. Under ~3s reads as "starts on the
  // blank" (the 0.96s version did, verbatim device feedback); past ~10s the
  // last clip before the paywall is dragging.
  const holdCeiling = Math.max(cue.start + CUE_START_PAD_S, cue.end - CUE_END_PAD_S);
  const pauseAt = Math.min(holdCeiling, Math.max(word.end, cue.start + CUE_START_PAD_S));
  assert.ok(
    pauseAt >= 3 && pauseAt <= 10,
    `the scripted blank freezes at ${pauseAt.toFixed(2)}s — outside the 3-10s ` +
      'window where the clip has visibly played but not dragged'
  );

  // The card's timer a small tail past the freeze: enough video after the
  // answer that the reel ends on speech, not so much that "the card follows
  // the answer" quietly becomes a wait.
  assert.ok(
    pauseAt < outroAtS,
    `the closing card comes up after ${outroAtS}s of playback but the scripted ` +
      `blank does not freeze until ${pauseAt.toFixed(2)}s — the card would ` +
      'cover the blank the reel exists to have the user try'
  );
  const tail = outroAtS - pauseAt;
  assert.ok(
    tail >= 1.5 && tail <= 3,
    `the card follows the blank by ${tail.toFixed(2)}s of playback — the beat ` +
      'is "about two seconds after the answer", so retune outroAfterPlayedMs ' +
      'to the freeze point plus ~2s'
  );
});
