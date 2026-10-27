import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { ACCENT, CARD, MUTED, ON_ACCENT, PrimaryButton, Screen, TEXT, TextButton } from './chrome';
import { LoroSays } from './LoroSays';
import { TINTS } from './art';
import { LESSON } from './copy';
import { track } from '../platform/analytics';

/**
 * HOW IT WORKS, DONE INSTEAD OF SHOWN (Radek, 2026-10-27: "put there
 * clickable subtitles … he taps the word, sees the translation, taps save,
 * some animation that he saved it. Then on the next page the word will be
 * there as a blank … when he writes it right, animation, yay first word").
 *
 * Two screens, one word:
 *   1. TapWordStep  — a subtitle line, one word glowing. Any word shows its
 *      meaning on tap; the glowing one opens the save card, and Save flies
 *      the word into a Words counter.
 *   2. WordBackStep — a new line with that word as a gap and its meaning
 *      over it. They type it; right, and it turns green with a burst.
 *
 * This replaced the animated three-scene explainer (LoopStory) and the
 * looping typing mock: same two claims, now the user's own hands make them,
 * and it is the first moment of the onboarding that gives instead of asks.
 *
 * NOTHING IS PERSISTED. A saved word in the app is tied to a real clip (the
 * Words tab replays the moment it was said), and there is no clip behind
 * these lines, so writing "playa" to storage would put a word in Words that
 * cannot play. The copy says "Saved" and never says "in your Words".
 *
 * Self-contained on purpose: no player, no catalog, no SRS. The benched taste
 * reel taught that a scripted path through the live feed breaks in a new way
 * every run; this cannot.
 */

/** The word the two screens share. */
export const LESSON_WORD = { text: 'playa', gloss: 'beach' };

const TAP_LINE: { text: string; gloss: string; target?: boolean }[] = [
  { text: 'Mañana', gloss: 'tomorrow' },
  { text: 'vamos', gloss: 'we’re going' },
  { text: 'a', gloss: 'to' },
  { text: 'la', gloss: 'the' },
  { text: LESSON_WORD.text, gloss: LESSON_WORD.gloss, target: true },
];
const TAP_ENGLISH = 'Tomorrow we’re going to the beach.';

/** The second line: the word as a gap. */
const BACK_BEFORE = ['¿Dónde', 'está', 'la'];
const BACK_AFTER = '?';
const BACK_ENGLISH = 'Where is the beach?';

/** Typed answers are graded the way the feed's blanks are, loosely: case,
    accents and stray spaces never cost the win. */
function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// ---------------------------------------------------------------- stepper

/** Where you are in the three beats, as one small mint line. It was a
    second row of progress bars under the onboarding's own bar, and two
    bars stacked read as chaos (Radek, 2026-10-27). */
function Stepper({ at }: { at: 0 | 1 | 2 | 3 }) {
  const label = at >= 3 ? LESSON.stepsDone : `Step ${at + 1} of 3 · ${LESSON.steps[at]}`;
  return <Text style={styles.kicker}>{label.toUpperCase()}</Text>;
}

/** The big open quote over a Spanish line: marks it as the thing being
    said, so it never reads as the screen's own heading. */
function Quote() {
  return <Text style={styles.quote}>“</Text>;
}

/** The frame both screens share: content from the TOP (the second screen
    raises the keyboard, and centred content would sit under it), the
    button pinned at the bottom like every other step. */
function LessonFrame({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.frame}>
      <ScrollView
        contentContainerStyle={styles.frameScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
      >
        {children}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View>
    </View>
  );
}

// ------------------------------------------------------------- 0. intro

/**
 * WHAT IS ABOUT TO HAPPEN (Radek, 2026-10-27: "put in front of tap it,
 * comes back, it's yours some screen explaining what will happen now").
 * The three beats as a numbered timeline, so the two hands-on screens
 * after it are met as a promise being kept, not a test sprung on them.
 */
export function LessonIntroStep({ next, isCurrent }: { next: () => void; isCurrent: boolean }) {
  return (
    <Screen footer={<PrimaryButton label={LESSON.introCta} onPress={next} />}>
      <LoroSays line={LESSON.introLoro} active={isCurrent} />
      <Text style={styles.introTitle}>{LESSON.introTitle}</Text>
      <View style={styles.timeline}>
        <View style={styles.rail} />
        {LESSON.introSteps.map((step, i) => (
          <IntroRow key={i} n={i + 1} head={step.head} body={step.body} active={isCurrent} delay={250 + i * 220} />
        ))}
      </View>
    </Screen>
  );
}

function IntroRow({ n, head, body, active, delay }: { n: number; head: string; body: string; active: boolean; delay: number }) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(0);
  useEffect(() => {
    if (!active) return;
    shown.value = reduced ? 1 : withDelay(delay, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [active, delay, reduced, shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 12 }] }));
  return (
    <Animated.View style={[styles.introRow, style]}>
      <View style={styles.introNum}>
        <Text style={styles.introNumText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.introHead}>{head}</Text>
        <Text style={styles.introBody}>{body}</Text>
      </View>
    </Animated.View>
  );
}

// ------------------------------------------------------------- 1. tap it

/** Material Icons "bookmark" (Apache 2.0), 24-unit viewBox. */
const BOOKMARK = 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z';

/**
 * NO APP CHROME AROUND THE LINE (Radek, 2026-10-27: the bordered box, the
 * red dot, "subtitles, like under every video" and "Words · 0" looked
 * cheap). The sentence floats big on the backdrop, the way the first
 * screen's lyrics do, and lights in word by word on arrival. The meaning
 * card rises under it; Save turns it into a saved-word chip with a burst.
 */
export function TapWordStep({ next, isCurrent }: { next: () => void; isCurrent: boolean }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<'tap' | 'sheet' | 'saved'>('tap');
  /** A non-target word whose meaning is showing. */
  const [peek, setPeek] = useState<number | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
  }, []);

  /** The line lighting in, word by word, once on arrival. */
  const enter = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!isCurrent || reduced) return;
    enter.value = withDelay(250, withTiming(1, { duration: 900, easing: Easing.linear }));
  }, [isCurrent, reduced, enter]);

  /** The glow on the target, breathing while it waits to be tapped. */
  const glow = useSharedValue(0);
  useEffect(() => {
    if (!isCurrent || phase !== 'tap' || reduced) {
      glow.value = withTiming(0, { duration: 200 });
      return;
    }
    glow.value = withDelay(
      1100,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 850, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.2, { duration: 850, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      )
    );
  }, [isCurrent, phase, reduced, glow]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + glow.value * 0.75,
    transform: [{ scale: 1 + glow.value * 0.06 }],
  }));

  const tapWord = (i: number) => {
    if (TAP_LINE[i].target) {
      if (phase !== 'tap') return;
      setPeek(null);
      setPhase('sheet');
      return;
    }
    setPeek(i);
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(null), 1600);
  };

  const save = () => {
    if (phase !== 'sheet') return;
    setPhase('saved');
    track('lesson_word_saved', { word: LESSON_WORD.text });
  };

  const n = TAP_LINE.length;
  return (
    <LessonFrame
      footer={<PrimaryButton label={phase === 'saved' ? LESSON.tapCta : LESSON.tapWaiting} onPress={next} disabled={phase !== 'saved'} />}
    >
      <Stepper at={phase === 'saved' ? 1 : 0} />
      <Text style={styles.title}>{LESSON.tapTitle}</Text>

      <Quote />
      <View style={styles.line}>
        {TAP_LINE.map((w, i) => (
          <Pressable key={i} onPress={() => tapWord(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={w.text}>
            <LessonWord
              text={w.text}
              enter={enter}
              from={(i / n) * 0.8}
              to={((i + 1) / n) * 0.8}
              pill={w.target ? (phase === 'tap' ? 'glow' : 'solid') : null}
              glowStyle={glowStyle}
            />
            {peek === i && (
              <Animated.Text entering={FadeIn.duration(140)} exiting={FadeOut.duration(140)} style={styles.peek} numberOfLines={1}>
                {w.gloss}
              </Animated.Text>
            )}
          </Pressable>
        ))}
      </View>
      <Text style={styles.under}>{phase === 'tap' ? LESSON.tapHint : TAP_ENGLISH}</Text>

      {/* The meaning card, then the chip it becomes. */}
      {phase === 'sheet' && (
        <Animated.View entering={FadeInDown.duration(320)} exiting={FadeOut.duration(160)} style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetWord}>{LESSON_WORD.text}</Text>
            <Text style={styles.sheetGloss}>{LESSON_WORD.gloss}</Text>
          </View>
          <Pressable onPress={save} accessibilityRole="button" style={({ pressed }) => [styles.saveButton, pressed && { opacity: 0.85 }]}>
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path d={BOOKMARK} fill={ON_ACCENT} />
            </Svg>
            <Text style={styles.saveText}>{LESSON.save}</Text>
          </Pressable>
        </Animated.View>
      )}
      {phase === 'saved' && <SavedChip />}
    </LessonFrame>
  );
}

/**
 * THE SAVED MOMENT, QUIETLY (Radek, 2026-10-27: the chip springing in with
 * confetti "seems super cheap"). The card is gone; the chip rises a few
 * points into place on one ease-out curve, the bookmark fills, and a single
 * soft ring of mint widens behind it and fades. No bounce, no confetti.
 */
function SavedChip() {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);
  const ring = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    t.value = withDelay(120, withTiming(1, { duration: 420, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
    ring.value = withDelay(260, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [reduced, t, ring]);
  const chip = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * 10 }] }));
  const fill = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0.5, 1], [0, 1], Extrapolation.CLAMP) }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value > 0 && ring.value < 1 ? interpolate(ring.value, [0, 0.15, 1], [0, 0.5, 0]) : 0,
    transform: [{ scaleX: 1 + ring.value * 0.12 }, { scaleY: 1 + ring.value * 0.45 }],
  }));
  const after = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0.6, 1], [0, 1], Extrapolation.CLAMP) }));
  return (
    <View style={styles.savedSeat}>
      <View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.savedRing, ringStyle]} />
        <Animated.View style={[styles.savedChip, chip]}>
          <View>
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path d={BOOKMARK} fill="none" stroke={ACCENT} strokeWidth={2} />
            </Svg>
            <Animated.View style={[StyleSheet.absoluteFill, fill]}>
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Path d={BOOKMARK} fill={ACCENT} />
              </Svg>
            </Animated.View>
          </View>
          <Text style={styles.savedWord}>{LESSON_WORD.text}</Text>
          <Text style={styles.savedGloss}>{LESSON_WORD.gloss}</Text>
          <View style={styles.savedTag}>
            <Text style={styles.savedTagText}>{LESSON.saved}</Text>
          </View>
        </Animated.View>
      </View>
      <Animated.Text style={[styles.after, after]}>{LESSON.savedBody}</Animated.Text>
    </View>
  );
}

/** One word of a lesson line: lights in on the line's entrance; the target
    can wear a breathing mint glow (waiting) or a solid mint pill (saved). */
function LessonWord({
  text,
  enter,
  from,
  to,
  pill,
  glowStyle,
}: {
  text: string;
  enter: SharedValue<number>;
  from: number;
  to: number;
  pill: 'glow' | 'solid' | null;
  glowStyle?: object;
}) {
  const ink = useAnimatedStyle(() => ({
    opacity: interpolate(enter.value, [from, to], [0.2, 1], Extrapolation.CLAMP),
  }));
  return (
    <View>
      {pill === 'glow' && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.targetGlow, glowStyle]} />}
      {pill === 'solid' && <Animated.View entering={FadeIn.duration(200)} pointerEvents="none" style={[StyleSheet.absoluteFill, styles.targetSolid]} />}
      <Animated.Text style={[styles.lineWord, pill === 'glow' && styles.lineWordTarget, pill === 'solid' && styles.lineWordOnPill, ink]}>
        {text}
      </Animated.Text>
    </View>
  );
}

// -------------------------------------------------------- 2. it comes back

export function WordBackStep({ next, isCurrent }: { next: () => void; isCurrent: boolean }) {
  const reduced = useReducedMotion();
  const input = useRef<TextInput>(null);
  const [typed, setTyped] = useState('');
  const [tries, setTries] = useState(0);
  const [won, setWon] = useState<null | { revealed: boolean }>(null);
  const answer = LESSON_WORD.text;

  /** The keyboard comes up once the slide has landed, never mid-slide. */
  useEffect(() => {
    if (!isCurrent || won) {
      if (!isCurrent) input.current?.blur();
      return;
    }
    const t = setTimeout(() => input.current?.focus(), 480);
    return () => clearTimeout(t);
  }, [isCurrent, won]);

  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const wrong = useSharedValue(0);
  /** The win, in order: the letters turn mint in a wave, the gap becomes
      a solid pill, one ring widens behind it, then Loro answers. */
  const wave = useSharedValue(0);
  const pill = useSharedValue(0);
  const ring = useSharedValue(0);
  const cheer = useSharedValue(0);
  const pillStyle = useAnimatedStyle(() => ({ opacity: pill.value, transform: [{ scale: 0.92 + pill.value * 0.08 }] }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value > 0 && ring.value < 1 ? interpolate(ring.value, [0, 0.15, 1], [0, 0.6, 0]) : 0,
    transform: [{ scaleX: 1 + ring.value * 0.25 }, { scaleY: 1 + ring.value * 0.6 }],
  }));
  const cheerStyle = useAnimatedStyle(() => ({
    opacity: cheer.value,
    transform: [{ translateY: (1 - cheer.value) * 14 }],
  }));

  const win = (revealed: boolean) => {
    Keyboard.dismiss();
    setTyped(answer);
    setWon({ revealed });
    track('lesson_word_back', { correct: !revealed, tries: tries + 1, revealed });
    if (reduced) {
      wave.value = 1;
      pill.value = 1;
      cheer.value = 1;
      return;
    }
    wave.value = withTiming(1, { duration: 600, easing: Easing.linear });
    pill.value = withDelay(560, withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
    ring.value = withDelay(700, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
    cheer.value = withDelay(850, withTiming(1, { duration: 420, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
  };

  const submit = () => {
    if (won || !typed.trim()) return;
    if (norm(typed) === answer) {
      win(false);
      return;
    }
    setTries((n) => n + 1);
    wrong.value = 1;
    wrong.value = withTiming(0, { duration: 700 });
    if (!reduced) {
      shake.value = withSequence(
        withTiming(-8, { duration: 50 }),
        withTiming(8, { duration: 60 }),
        withTiming(-5, { duration: 60 }),
        withTiming(0, { duration: 60 })
      );
    }
  };

  const letters = answer.split('');
  const shown = won ? answer : typed;
  return (
    <LessonFrame
      footer={<PrimaryButton label={won ? LESSON.backCta : LESSON.backWaiting} onPress={next} disabled={!won} />}
    >
      <Stepper at={won ? 3 : 1} />
      <Text style={styles.title}>{won ? LESSON.wonTitle : LESSON.backTitle}</Text>

      <View>
        <Quote />
        <View style={styles.line}>
          {BACK_BEFORE.map((w, i) => (
            <Text key={i} style={styles.lineWord}>{w}</Text>
          ))}
          <Pressable onPress={() => input.current?.focus()} style={styles.gap}>
            <Text style={[styles.gapGloss, won && styles.gapGlossWon]}>{LESSON_WORD.gloss}</Text>
            <View>
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.gapRing, ringStyle]} />
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.gapPill, pillStyle]} />
              <View style={styles.cells}>
                {letters.map((_, i) => (
                  <Cell key={i} index={i} total={letters.length} letter={shown[i] ?? ''} wave={wave} pill={pill} wrong={wrong} />
                ))}
              </View>
            </View>
          </Pressable>
          <Text style={[styles.lineWord, styles.lineTail]}>{BACK_AFTER}</Text>
        </View>
        <Text style={styles.under}>{BACK_ENGLISH}</Text>

        {!won && (
          <Animated.View style={[styles.answerBar, shakeStyle]}>
            <TextInput
              ref={input}
              value={typed}
              onChangeText={(t) => setTyped(t.slice(0, 14))}
              onSubmitEditing={submit}
              placeholder={LESSON.placeholder}
              placeholderTextColor="rgba(242,245,243,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
              returnKeyType="done"
              blurOnSubmit={false}
              style={styles.answerInput}
              selectionColor={ACCENT}
            />
            <Pressable onPress={submit} style={[styles.answerGo, !typed.trim() && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Check">
              <Text style={styles.answerGoText}>→</Text>
            </Pressable>
          </Animated.View>
        )}
        {!won && tries > 0 && (
          <View style={styles.helpRow}>
            <Text style={styles.helpText}>
              {LESSON.hintPrefix} <Text style={styles.helpStrong}>{answer[0]}</Text>
              {tries >= 2 ? LESSON.hintTail2 : LESSON.hintTail1}
            </Text>
            {tries >= 2 && <TextButton label={LESSON.reveal} onPress={() => win(true)} />}
          </View>
        )}

        {won && (
          <Animated.View style={[styles.cheer, cheerStyle]}>
            <LoroSays line={won.revealed ? LESSON.wonLoroRevealed : LESSON.wonLoro} active={isCurrent} />
            <View style={styles.badge}>
              <View style={styles.badgeDisc}>
                <Text style={styles.badgeTick}>✓</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.badgeHead}>{LESSON.badgeHead}</Text>
                <Text style={styles.badgeSub}>
                  <Text style={styles.badgeWord}>{LESSON_WORD.text}</Text> · {LESSON_WORD.gloss}
                </Text>
              </View>
            </View>
          </Animated.View>
        )}
      </View>
    </LessonFrame>
  );
}

/** One letter cell of the gap: the letter typed so far over a dash. On a
    win, the letters lift and turn mint one after another (`wave`), then sit
    dark on the solid pill (`pill`) as the dashes go. */
function Cell({
  index,
  total,
  letter,
  wave,
  pill,
  wrong,
}: {
  index: number;
  total: number;
  letter: string;
  wave: SharedValue<number>;
  pill: SharedValue<number>;
  wrong: SharedValue<number>;
}) {
  const ink = useAnimatedStyle(() => {
    const local = Math.min(1, Math.max(0, wave.value * total - index));
    const lit = local > 0 ? 1 : 0;
    return {
      color: pill.value > 0.5 ? ON_ACCENT : lit ? ACCENT : TEXT,
      transform: [{ translateY: -Math.sin(local * Math.PI) * 8 }],
    };
  });
  const dash = useAnimatedStyle(() => ({
    backgroundColor: wave.value > 0 ? ACCENT : wrong.value > 0.01 ? TINTS.rose : 'rgba(94,230,168,0.55)',
    opacity: 1 - pill.value,
  }));
  return (
    <View style={styles.cell}>
      <Animated.Text style={[styles.cellLetter, ink]}>{letter}</Animated.Text>
      <Animated.View style={[styles.cellDash, dash]} />
    </View>
  );
}

const styles = StyleSheet.create({
  introTitle: { color: TEXT, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34 },
  timeline: { marginTop: 26 },
  rail: { backgroundColor: 'rgba(94,230,168,0.25)', bottom: 30, left: 17, position: 'absolute', top: 30, width: 2 },
  introRow: { alignItems: 'center', flexDirection: 'row', gap: 16, paddingVertical: 12 },
  introNum: {
    alignItems: 'center',
    backgroundColor: '#10231b',
    borderColor: ACCENT,
    borderRadius: 999,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  introNumText: { color: ACCENT, fontSize: 16, fontWeight: '900' },
  introHead: { color: TEXT, fontSize: 18, fontWeight: '800' },
  introBody: { color: MUTED, fontSize: 14, lineHeight: 19, marginTop: 2 },

  frame: { flex: 1 },
  frameScroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 8 },
  footer: { paddingHorizontal: 24, paddingTop: 8 },

  kicker: { color: ACCENT, fontSize: 12, fontWeight: '900', letterSpacing: 1.4, marginBottom: 8 },
  quote: {
    color: 'rgba(94,230,168,0.55)',
    fontSize: 64,
    fontWeight: '900',
    height: 40,
    lineHeight: 72,
    marginTop: 26,
    textAlign: 'center',
  },

  /** The instruction: a notch quieter than a screen title, so the Spanish
      line below is the loudest thing on screen and never mistaken for it. */
  title: {
    color: 'rgba(242,245,243,0.82)',
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 27,
  },
  line: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginTop: 4,
    rowGap: 18,
  },
  lineWord: { color: TEXT, fontSize: 32, fontWeight: '800', letterSpacing: -0.5, lineHeight: 42, paddingHorizontal: 5 },
  lineWordTarget: { color: ACCENT },
  lineWordOnPill: { color: ON_ACCENT },
  lineTail: { marginLeft: -6 },
  targetGlow: {
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderColor: 'rgba(94,230,168,0.75)',
    borderRadius: 12,
    borderWidth: 1.5,
  },
  targetSolid: { backgroundColor: ACCENT, borderRadius: 12 },
  peek: {
    alignSelf: 'center',
    color: ACCENT,
    fontSize: 14,
    fontWeight: '800',
    position: 'absolute',
    top: -20,
  },
  under: { color: MUTED, fontSize: 16, fontWeight: '500', marginTop: 16, textAlign: 'center' },

  sheet: {
    backgroundColor: 'rgba(242,245,243,0.06)',
    borderRadius: 26,
    marginTop: 30,
    padding: 18,
  },
  sheetHead: { alignItems: 'baseline', flexDirection: 'row', gap: 12 },
  sheetWord: { color: TEXT, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  sheetGloss: { color: ACCENT, fontSize: 19, fontWeight: '700' },
  saveButton: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 14,
  },
  saveText: { color: ON_ACCENT, fontSize: 16, fontWeight: '800' },

  savedSeat: { alignItems: 'center', marginTop: 30 },
  savedChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.12)',
    borderColor: 'rgba(94,230,168,0.4)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
  },
  savedRing: { borderColor: ACCENT, borderRadius: 999, borderWidth: 1.5 },
  savedWord: { color: TEXT, fontSize: 18, fontWeight: '800' },
  savedGloss: { color: MUTED, fontSize: 15, fontWeight: '600' },
  savedTag: { backgroundColor: ACCENT, borderRadius: 999, marginLeft: 6, paddingHorizontal: 10, paddingVertical: 5 },
  savedTagText: { color: ON_ACCENT, fontSize: 13, fontWeight: '800' },
  after: { color: MUTED, fontSize: 15, lineHeight: 22, marginTop: 16, textAlign: 'center' },

  gap: { alignItems: 'center', marginHorizontal: 2 },
  gapGloss: { color: 'rgba(94,230,168,0.65)', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  gapGlossWon: { color: ACCENT },
  cells: { flexDirection: 'row', gap: 3 },
  cell: { alignItems: 'center', width: 20 },
  cellLetter: { color: TEXT, fontSize: 27, fontWeight: '800', lineHeight: 32, minHeight: 32 },
  cellDash: { borderRadius: 2, height: 3, width: 16 },

  answerBar: {
    alignItems: 'center',
    backgroundColor: CARD,
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 14,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
  },
  answerInput: { color: TEXT, flex: 1, fontSize: 19, fontWeight: '700', paddingVertical: 8 },
  answerGo: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 44,
  },
  answerGoText: { color: ON_ACCENT, fontSize: 20, fontWeight: '800' },
  helpRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  helpText: { color: MUTED, flex: 1, fontSize: 14 },
  helpStrong: { color: ACCENT, fontWeight: '800' },

  gapPill: { backgroundColor: ACCENT, borderRadius: 12, bottom: -2, left: -6, right: -6, top: 0 },
  gapRing: { borderColor: ACCENT, borderRadius: 14, borderWidth: 1.5, bottom: -2, left: -6, right: -6, top: 0 },
  badge: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.1)',
    borderRadius: 20,
    flexDirection: 'row',
    gap: 12,
    marginTop: 2,
    padding: 14,
  },
  badgeDisc: { alignItems: 'center', backgroundColor: ACCENT, borderRadius: 999, height: 34, justifyContent: 'center', width: 34 },
  badgeTick: { color: ON_ACCENT, fontSize: 17, fontWeight: '900' },
  badgeHead: { color: TEXT, fontSize: 16, fontWeight: '800' },
  badgeSub: { color: MUTED, fontSize: 14, marginTop: 1 },
  badgeWord: { color: ACCENT, fontWeight: '800' },
  cheer: { marginTop: 26 },

});
