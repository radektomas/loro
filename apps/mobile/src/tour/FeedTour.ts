import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCatalog } from '@loro/core/catalog';
import { collectionVideos } from '@loro/core/catalog/collectionVideos';
import { lookupGloss, normalizeSurface } from '@loro/core/dictionary';
import { storage } from '@loro/core/storage';
import type { Cue, Video, Word } from '@loro/core/types';
import { usePlayerApi, usePlayerClock, usePlayerStatus } from '../player/PlayerHost';
import type { FeedWalkthrough } from '../feed/FeedScreen';
import { setTourLine, setTourStep, type TourLine, type TourStep } from './tour';

/**
 * The feed half of the walkthrough (tour.ts): the beats that happen on top of
 * the REAL feed, through the seams the onboarding taste reel left in
 * FeedScreen (FeedWalkthrough). Nothing here is a mock: the blank is the
 * planner's own blue blank, the sheet is the real word sheet, the save is a
 * real save. The script watches, stops the clip at the right moment, rings a
 * word, and says its line in the tour dock (Shell) — never over the feed.
 *
 *   blank  "Turn the sound on" while muted, then "Fill the blue gap"; the
 *          first graded blank moves on once its celebration has played.
 *   save   the clip plays on until a line is being spoken that has a word to
 *          offer, lets that word be SAID, stops right after it, checks the
 *          player really is parked inside that line, and only then rings the
 *          word and says "Tap the glowing word".
 *   words  "Saved!", clip held; Shell lights the Words tab.
 *
 * A save at ANY beat counts — the user who taps a word before the blank came
 * did the thing the tour was going to ask for.
 */

const LINES: Record<'sound' | 'blank' | 'nice' | 'missed' | 'save' | 'words', TourLine> = {
  // Names the control on screen: the mint "Tap for sound" pill under the
  // video (FeedScreen SoundControl), not a gesture nobody can see.
  sound: { key: 'sound', title: 'Turn the sound on', body: 'Tap the green “Tap for sound” button under the video.' },
  blank: { key: 'blank', title: 'Fill the blue gap', body: 'A word goes missing. Type what you hear.' },
  nice: { key: 'nice', title: 'Nice one!', body: 'Now listen. I’ll stop on a word for you.' },
  // A wrong blue answer is filed into Words at box 0 by core (saveLevelWord),
  // so "I saved it" is literally what happened (Radek: "it says good job
  // instead of something like you got it wrong but it's okay, Loro saved you").
  missed: { key: 'missed', title: 'Not quite, no worries', body: 'I saved that word for you. Now let’s save one more.' },
  save: { key: 'save', title: 'Tap the glowing word', body: 'See what it means, then save it.' },
  words: { key: 'words', title: 'Saved!', body: 'Now tap Words, right below.' },
};

/** Long enough for the answer's own green celebration (Celebration.tsx). */
const AFTER_BLANK_MS = 1600;
/** No blue gap in the first clip after this long: go on to the save beat. */
const BLANK_FALLBACK_MS = 40_000;
/** The clip plays this long after the blank before a stop may be chosen. */
const SAVE_LEAD_MS = 1500;
/** Waiting for a usable spoken line longer than this: jump to the next one. */
const QUIET_JUMP_MS = 8000;
/** Stop this long after the chosen word ends. */
const AFTER_WORD_S = 0.08;
/** The word must end this far before its line does, so a late stop (the
    bridge, the player) still lands inside the line, which is the only time
    the subtitle shows it (subtitles.cueIndexAt). */
const LINE_TAIL_S = 0.45;

function findVideo(youtubeId: string | null): Video | null {
  if (!youtubeId) return null;
  return [...getCatalog(), ...collectionVideos].find((v) => v.youtubeId === youtubeId) ?? null;
}

type Target = { cueIndex: number; word: Word; stopAt: number; cue: Cue };

/**
 * A word on this line worth ringing: the sheet can explain it, it is not
 * saved or already known as blue, it is not still to come too late in the
 * line, and — the bug Radek hit twice — the line is not the one that just
 * held a blank: that line draws its blank word as the green answer, which
 * cannot carry a ring, so a stop there showed no glowing word at all.
 */
function targetIn(video: Video, idx: number, after: number, avoidCues: Set<number>): Target | null {
  if (avoidCues.has(idx)) return null;
  const cue = video.cues[idx];
  if (!cue || cue.words.length === 0) return null;
  const taken = new Set([
    ...storage.getSavedWords().map((w) => normalizeSurface(w.text)),
    ...storage.getLevelKnownWords().map((w) => normalizeSurface(w.text)),
  ]);
  const ok = cue.words.filter((w) => {
    const key = normalizeSurface(w.text);
    return (
      key.length >= 3 &&
      !taken.has(key) &&
      w.end > after &&
      w.end <= cue.end - LINE_TAIL_S &&
      lookupGloss(video, w.text) !== null
    );
  });
  const word = ok.find((w) => normalizeSurface(w.text).length >= 4) ?? ok[0];
  return word ? { cueIndex: idx, word, stopAt: word.end + AFTER_WORD_S, cue } : null;
}

export function useFeedTour(step: TourStep): FeedWalkthrough | undefined {
  const api = usePlayerApi();
  const clock = usePlayerClock();
  const status = usePlayerStatus();
  const [spotlight, setSpotlight] = useState<{ cueIndex: number; surface: string } | null>(null);
  /** The tour's blue blank was answered wrong — Loro says so, kindly. */
  const [missed, setMissed] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Cues that held a blank in this clip (onBlankResolved) — never rung. */
  const blankCues = useRef<Set<number>>(new Set());
  // Through the Words beats too: the feed stays in walkthrough mode (no card,
  // nothing armed) until the tour is over, so opening Words changes nothing
  // on the hidden feed in the same frame.
  const onFeed = step !== 'off' && step !== 'done';

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    []
  );

  // blank: a clip with no early blue gap must not stall the tour.
  useEffect(() => {
    if (step !== 'blank') return;
    const t = setTimeout(() => setTourStep('save'), BLANK_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [step]);

  // A new clip: its cue numbers are not the old clip's.
  useEffect(() => {
    blankCues.current = new Set();
    setSpotlight(null);
  }, [status.loadedVideoId]);

  /**
   * THE SAVE STOP, as a small state machine on a 100 ms tick:
   *   listen  — playing; find a line being spoken (or about to be, after a
   *             quiet jump) with a word still to come
   *   wait    — let the word be said; pause just after it
   *   verify  — paused: read where the player REALLY is (the page's anchor);
   *             inside the line → ring the word; not → seek back and re-check
   */
  useEffect(() => {
    if (step !== 'save') {
      setSpotlight(null);
      return;
    }
    const entered = Date.now();
    let phase: 'listen' | 'wait' | 'verify' | 'done' = 'listen';
    let target: Target | null = null;
    let verifyAt = 0;
    /** After a seek of ours, the clock needs a moment to report the new spot. */
    let settleUntil = 0;
    let tries = 0;
    const now = () =>
      clock.isPlaying.value
        ? clock.anchorTime.value + ((Date.now() - clock.anchorAt.value) / 1000) * clock.rate.value
        : clock.anchorTime.value;

    const id = setInterval(() => {
      if (phase === 'done') return;
      const video = findVideo(status.loadedVideoId);
      if (!video) return;
      const t = now();

      if (phase === 'listen') {
        if (Date.now() - entered < SAVE_LEAD_MS) return;
        /**
         * NEVER RUN OUT OF CLIP (Radek on device: "sometimes it's short and it
         * ends before the user gets to click a word"). When nothing usable is
         * left between here and the end — or the clip has already ended —
         * rewind to the first usable line and play into the stop from there.
         * The same video, so nothing about the beat changes but the time.
         */
        const lastEnd = video.cues.length ? video.cues[video.cues.length - 1].end : 0;
        const ended = !clock.isPlaying.value && t >= lastEnd - 0.5;
        if (!clock.isPlaying.value && !ended) return; // a blank holding, the user pausing
        let leftAhead = false;
        for (let i = 0; i < video.cues.length && !leftAhead; i++) {
          if (video.cues[i].end <= t) continue;
          leftAhead = targetIn(video, i, t + 0.05, blankCues.current) !== null;
        }
        if (ended || !leftAhead) {
          for (let i = 0; i < video.cues.length && !target; i++) target = targetIn(video, i, 0, blankCues.current);
          if (target) {
            api.seek(Math.max(target.cue.start - 0.3, 0));
            api.play();
            settleUntil = Date.now() + 700;
            phase = 'wait';
          }
          return;
        }
        const idx = video.cues.findIndex((c) => c.start <= t && t <= c.end);
        target = idx >= 0 ? targetIn(video, idx, t + 0.05, blankCues.current) : null;
        if (!target && Date.now() - entered > SAVE_LEAD_MS + QUIET_JUMP_MS) {
          // A quiet stretch (music, a pause): jump to just before the next
          // usable line and let it play into the stop like any other.
          for (let i = 0; i < video.cues.length && !target; i++) {
            if (video.cues[i].start > t) target = targetIn(video, i, 0, blankCues.current);
          }
          if (target) {
            api.seek(Math.max(target.cue.start - 0.2, 0));
            settleUntil = Date.now() + 700;
          }
        }
        if (target) phase = 'wait';
        return;
      }

      if (phase === 'wait' && target) {
        if (Date.now() < settleUntil) return;
        if (!clock.isPlaying.value) return; // a blank holding, the user pausing
        if (t > target.cue.end) {
          phase = 'listen'; // missed it (a hiccup): find the next one
          target = null;
          return;
        }
        if (t >= target.stopAt) {
          api.pause();
          phase = 'verify';
          verifyAt = Date.now() + 450;
        }
        return;
      }

      if (phase === 'verify' && target && Date.now() >= verifyAt) {
        if (clock.isPlaying.value) {
          api.pause();
          verifyAt = Date.now() + 300;
          return;
        }
        const at = clock.anchorTime.value;
        const inside = at >= target.cue.start && at <= target.cue.end - 0.05;
        if (inside || tries >= 3) {
          setSpotlight({ cueIndex: target.cueIndex, surface: target.word.text });
          phase = 'done';
          return;
        }
        tries += 1;
        api.seek(Math.min(target.stopAt, target.cue.end - 0.2));
        verifyAt = Date.now() + 450;
      }
    }, 100);
    return () => clearInterval(id);
    // status.loadedVideoId: a swipe to another clip starts the search again.
  }, [step, status.loadedVideoId, api, clock]);

  // THE HOLD: while a word is ringed, or "Saved!" is up, the clip stays
  // stopped — the sheet resumes playback when it closes, and a moving line
  // would carry the ring away (the taste reel learned this on device).
  useEffect(() => {
    const holding = (step === 'save' && spotlight !== null) || step === 'words';
    if (holding && status.playing) api.pause();
  }, [step, spotlight, status.playing, api]);

  const onBlankResolved = useCallback(
    (_kind: 'recall' | 'level', cueIndex: number, correct: boolean) => {
      blankCues.current.add(cueIndex);
      if (step !== 'blank') return;
      setMissed(!correct);
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => setTourStep('save'), AFTER_BLANK_MS);
    },
    [step]
  );

  const onWordSaved = useCallback(() => {
    if (step !== 'blank' && step !== 'save') return;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setSpotlight(null);
    setTourStep('words');
  }, [step]);

  // Loro's line for the dock.
  const line: TourLine | null =
    step === 'blank'
      ? status.muted
        ? LINES.sound
        : LINES.blank
      : step === 'save'
        ? spotlight
          ? LINES.save
          : missed
            ? LINES.missed
            : LINES.nice
        : step === 'words'
          ? LINES.words
          : null;
  useEffect(() => {
    if (step === 'blank' || step === 'save' || step === 'words') setTourLine(line);
  }, [step, line]);

  return useMemo<FeedWalkthrough | undefined>(
    () =>
      onFeed
        ? {
            spotlight: step === 'save' ? spotlight : null,
            coach: null,
            focusWord: null,
            levelBlanks: true,
            onBlankResolved,
            onWordSaved,
          }
        : undefined,
    [onFeed, step, spotlight, onBlankResolved, onWordSaved]
  );
}
