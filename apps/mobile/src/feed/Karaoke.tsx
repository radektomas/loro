import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { Cue, Word } from '@loro/core/types';
import { tierFor } from '@loro/core/levels';
import { normalizeAnswer, type AnswerMatch } from '@loro/core/srs';
import { usePlayerClock } from '../player/PlayerHost';
import { useRecallAnswer, useRecallView } from './RecallHost';
import {
  CELEBRATE_MS,
  FeatherBurst,
  LoroCelebration,
  useReduceMotion,
} from './Celebration';
import { flog } from './recall';
import { buildCueSpans, cueIndexAt, wordIndexAt } from './subtitles';

/**
 * Karaoke subtitles for the active slide.
 *
 * THE 60fps PATH, and where each piece runs:
 *
 *   UI thread, every frame   extrapolate the clock from the anchor, find the
 *                            cue and word indices, write them to shared values
 *   UI thread, every frame   each word's highlight style reads wordIndex
 *   JS thread, ~3x/second    ONLY when the cue index changes, re-render the
 *                            line of words
 *
 * Nothing crosses to JS per frame, and nothing crosses the WebView bridge at
 * all — the clock is the local anchor plus elapsed time. That is the whole
 * point of the optimistic model: the web reads video.currentTime in a rAF loop
 * and RN cannot afford the equivalent RPC.
 *
 * The web calls setWordIndex EVERY frame and lets React bail on an unchanged
 * value. That would be a wasted render pass here, so the change detection is
 * explicit: the word highlight never touches React at all, and the cue does so
 * only on a real transition.
 *
 * CHECKPOINT F adds the blank, and adds it WITHOUT touching any of the above.
 * The hold, its re-seat clamp and the typed input live in RecallHost/RecallBar,
 * not here — this component only swaps one word's <Text> for a blank slot when
 * the plan says the visible cue has one. The frame callback below is untouched,
 * and the blank slot re-renders on keystroke while the highlight never does.
 */
export function Karaoke({
  cues,
  language,
  active,
  videoKey,
  onWordTap,
}: {
  cues: Cue[];
  language: string;
  /** Only the slide that owns the player runs its loop. A background slide
      reading the shared clock would highlight against another video's time. */
  active: boolean;
  /**
   * This slide's video id, checked against the recall plan's own. FlashList
   * recycles cells, so without it a cell that used to show the active video
   * could draw its blank into a different video's line.
   */
  videoKey: string;
  /**
   * Tapping a word opens the save sheet. Only the ACTIVE slide renders words at
   * all (cueIndex stays -1 otherwise), so this can never fire for a background
   * slide — the guard is structural rather than a check.
   */
  onWordTap?: (word: Word, cueIndex: number) => void;
}) {
  const { anchorTime, anchorAt, isPlaying, rate } = usePlayerClock();
  const spans = useMemo(() => buildCueSpans(cues), [cues]);

  const cueIndexSv = useSharedValue(-1);
  const wordIndexSv = useSharedValue(-1);
  const [cueIndex, setCueIndex] = useState(-1);

  // A new video: drop the previous one's indices before the first frame runs.
  useEffect(() => {
    cueIndexSv.value = -1;
    wordIndexSv.value = -1;
    setCueIndex(-1);
  }, [spans, cueIndexSv, wordIndexSv]);

  const frame = useFrameCallback(() => {
    'worklet';
    // Extrapolation from the anchor, done here on the UI thread. PlayerHost
    // used to carry a JS-thread twin of this arithmetic for its drift readout;
    // that readout and its sampler are gone, so this is now the only copy.
    //
    // THE RATE FACTOR IS WHAT KEEPS WORDS ON THE BEAT AT NON-1x SPEEDS. Wall
    // clock is not media clock below 1x — at 0.5x an unscaled model advances
    // twice as fast as the speech, so the highlight reaches the end of the line
    // while the speaker is halfway through it, then snaps back on the next
    // anchor. Multiplying here is the entire fix, and at rate 1 it is a no-op.
    const t = isPlaying.value
      ? anchorTime.value + ((Date.now() - anchorAt.value) / 1000) * rate.value
      : anchorTime.value;

    const ci = cueIndexAt(spans, t, cueIndexSv.value);
    if (ci !== cueIndexSv.value) cueIndexSv.value = ci;

    const wi = wordIndexAt(spans, ci, t);
    if (wi !== wordIndexSv.value) wordIndexSv.value = wi;
  }, false);

  useEffect(() => {
    frame.setActive(active);
  }, [active, frame]);

  // The only JS hop, and only on a real cue transition.
  useAnimatedReaction(
    () => cueIndexSv.value,
    (next, previous) => {
      if (next !== previous) runOnJS(setCueIndex)(next);
    },
    []
  );

  const cue = cueIndex >= 0 ? cues[cueIndex] : null;

  /**
   * CHECKPOINT F. Is there a blank on the cue currently on screen?
   *
   * The plan is the ACTIVE video's, held once in RecallHost, so the videoKey
   * check is what keeps a recycled cell honest. When recall is flagged off the
   * context value is null and everything below is dead code.
   *
   * Note the blank is drawn from the moment its cue is VISIBLE, not from the
   * moment the hold engages — the web does the same, and deliberately: you see
   * the gap coming, hear the word spoken into it, and only then does the video
   * stop for you to type.
   */
  const recall = useRecallView();
  const blank =
    recall && recall.videoKey === videoKey && cueIndex >= 0
      ? (recall.byCue.get(cueIndex) ?? null)
      : null;
  const blankResult = blank ? (recall?.results.get(cueIndex) ?? null) : null;

  /**
   * CELEBRATING — true for CELEBRATE_MS after a correct answer, exactly the
   * web's `celebrating` (SubtitleTrack.tsx:97, set in gradeBlank).
   *
   * FIRED ON THE TRANSITION, NOT ON THE VALUE, and the difference is what
   * keeps a recycled cell honest. `results` is a Map that PERSISTS for the
   * life of the plan, so a cue that was answered ten seconds ago still reads
   * 'correct' — rendering the hop whenever blankResult === 'correct' would
   * replay it every time the cue came back on screen, and again on every
   * FlashList remount. Only a null -> 'correct' change is a fresh answer.
   *
   * The `undefined` seed is the other half of that: on the first run of this
   * effect there is no previous value to compare against, and a cell that
   * mounts already showing a graded cue must not read as a new answer. So the
   * first observation only records, never celebrates.
   */
  const previousResult = useRef<AnswerMatch | null | undefined>(undefined);
  const [celebrating, setCelebrating] = useState(false);
  /**
   * THE TIMER IS A REF, NOT AN EFFECT CLEANUP, and that is a bug fix rather
   * than a style preference. Tying it to this effect's cleanup means the cue
   * advancing cancels it — and the cue DOES advance mid-celebration, because
   * the player resumes 600ms after grading while this runs for 1200ms. The
   * clear would fire with no re-arm, `celebrating` would stick at true
   * forever, and because the flag never falls back to false the NEXT correct
   * answer could not remount the hop: setCelebrating(true) on an already-true
   * flag changes nothing, so Loro would appear exactly once per session.
   *
   * Clear-then-set on a ref is the web's own shape (SubtitleTrack.tsx:269-270)
   * and survives any number of cue changes underneath it.
   */
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    },
    []
  );
  useEffect(() => {
    const previous = previousResult.current;
    previousResult.current = blankResult;
    if (previous === undefined) return;
    if (blankResult !== 'correct' || previous === 'correct') return;
    setCelebrating(true);
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    celebrationTimer.current = setTimeout(() => setCelebrating(false), CELEBRATE_MS);
  }, [blankResult]);

  /**
   * TEMPORARY [loro:F] diagnostic. If a blank is planned for the visible cue
   * but its wordIndex does not point at the word core chose, the line renders
   * that word normally — karaoke-highlighted green as it is spoken, which
   * looks exactly like "the blank is showing the answer". This log names both
   * so the two cases can be told apart on device.
   */
  useEffect(() => {
    if (!blank) return;
    const target = cue?.words[blank.wordIndex]?.text;
    flog(
      `slot cue=${cueIndex} wordIndex=${blank.wordIndex} ` +
        `expects="${blank.word.text}" lineHas="${target ?? '<none>'}"` +
        (target && normalizeAnswer(target) === normalizeAnswer(blank.word.text)
          ? ''
          : '  <-- MISMATCH, blank is on the wrong word')
    );
  }, [blank, cue, cueIndex]);

  return (
    <View style={styles.track}>
      {/* Loro, absolute at the top of THIS box — which is the band, below the
          player. Mounted only while celebrating so the hop restarts cleanly on
          the next correct answer rather than needing a reset. */}
      {celebrating && <LoroCelebration />}
      {cue ? (
        <>
          <View style={styles.line}>
            {cue.words.map((word, index) => {
              if (blank && index === blank.wordIndex) {
                // Answered: reveal the cue's own surface form with a short
                // confirmation (the web's resolved branch, SubtitleTrack:393).
                if (blankResult) {
                  return (
                    <RevealedWord
                      key={`${cueIndex}-${index}-r`}
                      text={word.text}
                      result={blankResult}
                      kind={blank.kind}
                      celebrating={celebrating}
                    />
                  );
                }
                // Waiting. A plain View, never a Pressable and never a
                // TextInput — see RecallBar for why the real input is not in
                // this line (R5: it would compete with the list's pan).
                return (
                  <BlankSlot
                    key={`${cueIndex}-${index}-b`}
                    answerLength={blank.word.text.length}
                    gloss={blank.word.translation}
                    kind={blank.kind}
                    // The tier chip names the word's OWN band, which is what
                    // the web labels it with (SubtitleTrack.tsx:338) — not the
                    // user's level. They differ whenever the exact band had no
                    // material in this video.
                    tier={blank.kind === 'level' ? tierFor(blank.word.level).name : null}
                  />
                );
              }
              return (
                <KaraokeWord
                  key={`${cueIndex}-${index}`}
                  text={word.text}
                  index={index}
                  current={wordIndexSv}
                  onPress={
                    onWordTap ? () => onWordTap(word, cueIndex) : undefined
                  }
                />
              );
            })}
          </View>
          <Text style={styles.translation}>
            {cue.translations[language] ?? cue.translations.en ?? ''}
          </Text>
        </>
      ) : (
        // Reserve the height so the band — and therefore the player box above
        // it — never resizes mid-playback. The web file's note applies: a
        // stable frame beats a few pixels of extra player.
        <View style={styles.placeholder} />
      )}
    </View>
  );
}

/**
 * One word. Its highlight is an animated style reading a shared value, so the
 * transition happens entirely on the UI thread — this component never
 * re-renders while the cue is on screen.
 */
function KaraokeWord({
  text,
  index,
  current,
  onPress,
}: {
  text: string;
  index: number;
  current: { value: number };
  onPress?: () => void;
}) {
  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: current.value === index ? '#5ee6a8' : 'transparent',
  }));
  const textStyle = useAnimatedStyle(() => ({
    color: current.value === index ? '#06130d' : '#f2f5f3',
  }));

  /**
   * Pressable OUTSIDE the animated view, so the touch target is the word's own
   * padded box and the highlight styling stays untouched — the highlight is a
   * UI-thread animated style and must not be re-rendered by press state.
   *
   * `hitSlop` widens the target without widening the layout: the words wrap as
   * a line of text, so growing the box would re-flow the line mid-playback.
   */
  return (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={6}>
      <Animated.View style={[styles.word, boxStyle]}>
        <Animated.Text style={[styles.wordText, textStyle]}>{text}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The gap in the line, showing what you have typed so far.
 *
 * THE ONLY THING IN THIS FILE THAT SUBSCRIBES TO THE ANSWER. It is its own
 * component precisely so a keystroke re-renders 30pt of underline and nothing
 * else — Karaoke itself reads the plan, which changes once per slide, so the
 * "never re-renders while a cue is on screen" property survives typing.
 *
 * Width is seeded from the answer's own length, the same length leak the web
 * accepts by sizing its input in `ch` (SubtitleTrack.tsx:358-364). RN has no
 * `ch`, so this approximates one at the line's 26pt bold.
 */
function BlankSlot({
  answerLength,
  gloss,
  kind,
  tier,
}: {
  /** Length of the word being recalled — sizes the slot. */
  answerLength: number;
  /** The word's gloss. It is the PROMPT shown in the empty slot, and its length
      feeds the web's width formula. */
  gloss: string;
  kind: 'recall' | 'level';
  /** Tier name for a level blank, null for recall. */
  tier: string | null;
}) {
  const answer = useRecallAnswer();
  const isLevel = kind === 'level';
  const color = isLevel ? LEVEL : ACCENT;
  // The web's own width formula (SubtitleTrack.tsx:358-364), in points rather
  // than `ch`. It leaks the answer's length; that is the web's trade and is
  // kept rather than quietly tightened.
  const width =
    Math.max(4, answerLength + 1, Math.min(gloss.length, 14)) * APPROX_CHAR_PT;
  /**
   * How far the rule has to reach. The box is `minWidth: width` but GROWS with
   * whatever is typed into it — and a long answer must not run past the end of
   * the underline. This over-estimates the typed width at the line's 26pt bold
   * and the surplus dashes are clipped, which costs a few empty Views and
   * removes a whole class of "the rule stops halfway" bug.
   */
  const ruleWidth = Math.max(width, answer.length * (APPROX_CHAR_PT + 4) + 24);

  return (
    <View style={styles.blankRow}>
      {isLevel && tier && (
        <View style={styles.tierChip}>
          <Text style={styles.tierChipText}>{tier}</Text>
        </View>
      )}
      <View style={[styles.word, styles.blank, { minWidth: width }]}>
        {/*
          THE ANSWER IS NEVER RENDERED HERE — only what the user has typed, and
          the gloss as a prompt while that is empty. That is the whole
          exercise: the web puts an <input> in the word's place whose value is
          the typed text and whose PLACEHOLDER is the gloss, so the Spanish
          word stays hidden until it is revealed (SubtitleTrack.tsx:340-370).
          Rendering the word here would hand over the answer and leave the
          blank as decoration.
        */}
        {answer.length > 0 ? (
          <Text
            style={[styles.wordText, styles.blankSlotText, { color }]}
            numberOfLines={1}
          >
            {answer}
          </Text>
        ) : (
          /**
           * The web's placeholder, ported down to its styling: 0.6em, medium
           * weight, the accent at half opacity (SubtitleTrack.tsx:368-370). It
           * is the same gloss the answer bar shows, and duplicated on purpose —
           * on the web the input IS the blank, so this is where the prompt has
           * always lived, and it is also what makes an empty slot legible as a
           * slot rather than as a gap in the sentence.
           */
          <Text
            style={[styles.blankPrompt, { color: isLevel ? LEVEL_HALF : ACCENT_HALF }]}
            numberOfLines={1}
          >
            {gloss}
          </Text>
        )}
        <Rule color={color} dashed={!isLevel} width={ruleWidth} />
      </View>
    </View>
  );
}

/**
 * The slot's underline — DRAWN, not a border, and that is not a style choice.
 *
 * `borderStyle: 'dashed'` WITH A SINGLE-SIDE BORDER RENDERS NOTHING ON iOS.
 * RCTBorderDrawing.m:496-499 refuses the whole dashed image unless all four
 * border COLOURS are equal — and setting only borderBottomColor leaves the
 * other three at their default, so the check fails, it logs "Unsupported dashed
 * / dotted border style" and returns nil. No border image, no underline. That
 * is the Metro warning, and it is why the empty slot was invisible.
 *
 * Satisfying that check is not a fix either: the dashed path strokes the whole
 * outline at RCTMaxBorderInset (:501), so four equal colours would buy a dashed
 * BOX, not the web's dashed rule. A dashed underline is simply not expressible
 * through borderStyle here.
 *
 * So both kinds get the same drawn rule — solid for level, dashed for recall —
 * which also guarantees the two sit at identical geometry rather than one being
 * a border box and the other an overlay. Plain Views: identical on iOS and
 * Android, no native module, no rebuild.
 */
function Rule({
  color,
  dashed,
  width,
}: {
  color: string;
  dashed: boolean;
  /** Used only to count dashes; the rule itself stretches to the box. */
  width: number;
}) {
  if (!dashed) {
    return <View pointerEvents="none" style={[styles.rule, { backgroundColor: color }]} />;
  }
  // +2 so rounding and a mid-typing growth spurt can never leave a bald end.
  const count = Math.ceil(width / (DASH_W + DASH_GAP)) + 2;
  return (
    <View pointerEvents="none" style={styles.ruleClip}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dash, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

/**
 * The revealed word, after grading.
 *
 * THE CONFIRMATION, DELIBERATELY SMALL. The web celebrates a correct answer for
 * 1200ms with a mascot hop and a feather burst (SubtitleTrack.tsx:268-278).
 * That budget does not fit here: the player resumes 600ms after grading, and an
 * animation still running when the video restarts reads as jank rather than
 * reward. So a quick scale pop plus a green fill that fades out, both finished
 * inside ~480ms — comfortably under the resume. The haptic already fires from
 * RecallHost, matching the web's navigator.vibrate.
 *
 * A miss gets one short shake, the restrained equivalent of animate-wrong.
 * Neither animation moves layout — scale and translateX are transforms — so the
 * line cannot reflow mid-reveal and shift the band under the player.
 */
function RevealedWord({
  text,
  result,
  kind,
  celebrating,
}: {
  text: string;
  result: AnswerMatch;
  kind: 'recall' | 'level';
  /** Whether the burst should be thrown — owned by Karaoke, see `celebrating`. */
  celebrating: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const shift = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    // globals.css drops .animate-correct/.animate-wrong to `animation: none`
    // under prefers-reduced-motion — the tint alone carries the result.
    if (reduceMotion) return;
    if (result !== 'wrong') {
      /**
       * loro-snap, transcribed. The web starts the word at 1.25 and lets it
       * settle THROUGH 1 rather than easing up to it: 1.25 -> 0.96 at 60% ->
       * 1.04 at 80% -> 1. The undershoot is what makes it read as a snap
       * rather than a zoom, and dropping it (this used to be a plain
       * 1.14 -> 1) is most of why the old version felt flat.
       *
       * 'almost' — a spelling near-miss that graded as correct — gets the
       * same snap with a yellow fill: a success beat, not a shake. Only the
       * feather burst is reserved for the exact answer.
       */
      scale.value = 1.25;
      scale.value = withSequence(
        withTiming(0.96, { duration: 210 }),
        withTiming(1.04, { duration: 70 }),
        withTiming(1, { duration: 70 })
      );
      // loro-bloom, 600ms. RN cannot animate textShadow, so the glow is a
      // fill behind the word — same read, and it was already built that way.
      glow.value = 1;
      glow.value = withTiming(0, { duration: 600 });
      return;
    }
    shift.value = withSequence(
      withTiming(-3, { duration: 55 }),
      withTiming(3, { duration: 55 }),
      withTiming(0, { duration: 55 })
    );
  }, [result, scale, shift, glow, reduceMotion]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateX: shift.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const tint =
    result === 'wrong'
      ? styles.revealBad
      : result === 'almost'
        ? styles.revealAlmost
        : kind === 'level'
          ? styles.revealOkLevel
          : styles.revealOk;
  const glowColor =
    result === 'almost' ? ALMOST : kind === 'level' ? LEVEL : ACCENT;

  /**
   * TWO BOXES, AND THE OUTER ONE EXISTS ONLY SO THE FEATHERS CAN LEAVE.
   *
   * revealBox clips (overflow:'hidden'), which it must — the glow is an
   * absolutely positioned fill and would otherwise square off the rounded
   * corners. The burst throws feathers up to 50pt out of a ~40pt box, so
   * nesting it inside that clip would cut every one of them off at the word's
   * edge. The wrapper does not clip and sizes to the same content, so the
   * feathers escape while the glow stays contained.
   */
  return (
    <View style={styles.revealWrap}>
      <Animated.View style={[styles.word, styles.revealBox, boxStyle]}>
        {/* The fill sits behind the text so the word stays readable through it. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.revealGlow, { backgroundColor: glowColor }, glowStyle]}
        />
        <Text style={[styles.wordText, tint]}>{text}</Text>
      </Animated.View>
      {result === 'correct' && celebrating && <FeatherBurst />}
    </View>
  );
}

/** One character's advance at the line's 26pt bold, near enough for sizing. */
const APPROX_CHAR_PT = 14;

/** Green = your own saved word coming back (SRS recall). */
const ACCENT = '#5ee6a8';
/** The near-miss yellow — 'almost right', warmer than the wrong-answer red. */
const ALMOST = '#f2c14e';
/** Blue = level practice. `--level` from the web's globals.css:15, unchanged. */
const LEVEL = '#57b3f2';
/** The web's placeholder:text-accent/50 and placeholder:text-level/50. */
const ACCENT_HALF = 'rgba(94,230,168,0.5)';
const LEVEL_HALF = 'rgba(87,179,242,0.5)';

/** The drawn dash and the gap after it. Sized against the 3pt rule so the
    result reads like a CSS dashed border rather than a dotted one. */
const DASH_W = 7;
const DASH_GAP = 5;
const RULE_H = 3;

const styles = StyleSheet.create({
  // Matches the web's min-h-[11rem]: sized for the common worst case (a
  // three-line cue plus a two-line translation), not the average.
  track: { minHeight: 176, justifyContent: 'flex-end', paddingHorizontal: 16 },
  placeholder: { height: 176 },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  word: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  wordText: { fontSize: 26, fontWeight: '700', lineHeight: 34 },
  blankRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  /** Room at the foot of the box for the drawn rule, which overlays rather
      than adding height the way a real border did. */
  blank: { justifyContent: 'flex-end', paddingBottom: 6 },
  /** Holds the slot open at a word's height while it is empty — an empty Text
      has no line box, so without this the rule would sit under nothing and the
      line would jump when the first character lands. */
  blankSlotText: { minHeight: 34, textAlign: 'center' },
  /** The gloss prompt: the web's placeholder:text-[0.6em] placeholder:font-medium
      at the line's 26pt, on the same 34pt line box so the slot does not resize
      the moment the first character is typed. */
  blankPrompt: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 34,
    minHeight: 34,
    textAlign: 'center',
  },
  /** Both rules span the box and sit at its foot, exactly where a
      border-bottom would have been. */
  rule: {
    borderRadius: RULE_H / 2,
    bottom: 0,
    height: RULE_H,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  /** Same box, but the dashes are laid out left-to-right and whatever runs
      past the end is clipped. */
  ruleClip: {
    bottom: 0,
    flexDirection: 'row',
    height: RULE_H,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
  },
  dash: {
    borderRadius: RULE_H / 2,
    flexShrink: 0,
    height: RULE_H,
    marginRight: DASH_GAP,
    width: DASH_W,
  },
  tierChip: {
    backgroundColor: 'rgba(87,179,242,0.16)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  tierChipText: {
    color: '#57b3f2',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  /** Non-clipping host for the feather burst — see RevealedWord. Sizes to the
      word, so the line's wrap behaviour is unchanged by the extra level. */
  revealWrap: { position: 'relative' },
  /** The reveal needs its own box so the glow can be absolutely positioned
      behind the word without escaping the rounded corners. */
  revealBox: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  revealGlow: {
    borderRadius: 10,
    bottom: 0,
    left: 0,
    opacity: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  revealOk: { color: '#5ee6a8' },
  revealOkLevel: { color: '#57b3f2' },
  revealAlmost: { color: '#f2c14e' },
  revealBad: { color: '#ff8b7a' },
  translation: {
    marginTop: 8,
    paddingHorizontal: 6,
    fontSize: 16,
    lineHeight: 23,
    color: 'rgba(242,245,243,0.7)',
  },
});
