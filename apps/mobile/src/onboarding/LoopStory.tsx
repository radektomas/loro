import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

/**
 * THE LOOP, PLAYED — the onboarding's "how it works" as three scenes that
 * play in order once, one line of copy lit under each (Radek, 2026-09-26: "we should
 * update the onboarding so it shows this in some nice animation"):
 *
 *   1. Tap a word you don't know in a video — it lights, it is saved.
 *   2. Train it in Words — the coin on the path flips to learned.
 *   3. It comes back in your videos — a gap in the subtitle, typed, green.
 *
 * Plain RN Animated on purpose: the onboarding has already met the
 * Reanimated worklet trap once (a JS colour helper called on the UI thread),
 * and nothing here needs the UI thread.
 */

const MINT = '#5ee6a8';
const INK = '#f2f5f3';
const SCENE_MS = 3200;

export const LOOP_LINES = [
  'Tap a word you don’t know in a video.',
  'Train it in Words. A few quick exercises and it’s learned.',
  'It pops back up in your videos so it sticks.',
];

function useProgress(active: boolean, ms: number, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    if (!active) return;
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [active, v, ms, delay]);
  return v;
}

function Pop({ active, delay, children, style }: { active: boolean; delay: number; children: React.ReactNode; style?: object }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    if (!active) return;
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.spring(v, { toValue: 1, friction: 5, tension: 110, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [active, v, delay]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  return <Animated.View style={[style, { opacity: v, transform: [{ scale }] }]}>{children}</Animated.View>;
}

/** Scene 1: the subtitle, a tap on "esta", and the saved tag. */
function TapScene({ active }: { active: boolean }) {
  const lit = useProgress(active, 250, 600);
  const ripple = useProgress(active, 700, 450);
  const rippleScale = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.8] });
  const rippleOpacity = ripple.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.6, 0] });
  return (
    <View style={styles.scene}>
      <View style={styles.video}>
        <View style={styles.line}>
          <Text style={styles.word}>Vivo</Text>
          <Text style={styles.word}>en</Text>
          <View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.litBg, { opacity: lit }]} />
            <Text style={[styles.word, styles.litWord]}>esta</Text>
            <Animated.View
              pointerEvents="none"
              style={[styles.ripple, { opacity: rippleOpacity, transform: [{ scale: rippleScale }] }]}
            />
          </View>
          <Text style={styles.word}>ciudad</Text>
        </View>
      </View>
      <Pop active={active} delay={1100} style={styles.tag}>
        <Text style={styles.tagText}>✓ Saved · this</Text>
      </Pop>
    </View>
  );
}

/** Scene 2: a slice of the path; the white coin flips to a mint check. */
function TrainScene({ active }: { active: boolean }) {
  const flip = useProgress(active, 350, 1000);
  const white = flip.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return (
    <View style={styles.scene}>
      <View style={styles.pathSlice}>
        <View style={[styles.coin, styles.coinDone, { marginLeft: -70 }]}>
          <Text style={styles.check}>✓</Text>
        </View>
        <View style={styles.coinRow}>
          <View>
            <View style={[styles.coin, styles.coinDone]}>
              <Text style={styles.check}>✓</Text>
            </View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.coin, styles.coinHere, { opacity: white }]}>
              <View style={styles.play} />
            </Animated.View>
          </View>
          <Pop active={active} delay={1150} style={styles.aprendida}>
            <Text style={styles.aprendidaText}>¡Aprendida!</Text>
            <Text style={styles.aprendidaWord}>esta · this</Text>
          </Pop>
        </View>
        <View style={[styles.coin, styles.coinLocked, { marginLeft: 60 }]}>
          <View style={styles.lockBody} />
        </View>
      </View>
    </View>
  );
}

/** Scene 3: the gap in the subtitle, typed a letter at a time, then green. */
function ReturnScene({ active }: { active: boolean }) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    setTyped('');
    if (!active) return;
    const timers = ['e', 'es', 'est', 'esta'].map((t, i) => setTimeout(() => setTyped(t), 650 + i * 230));
    return () => timers.forEach(clearTimeout);
  }, [active]);
  const done = typed === 'esta';
  return (
    <View style={styles.scene}>
      <View style={styles.video}>
        <View style={styles.line}>
          <Text style={styles.word}>Vivo</Text>
          <Text style={styles.word}>en</Text>
          <View style={[styles.slot, done && styles.slotDone]}>
            <Text style={[styles.word, styles.slotText, done && { color: MINT }]}>{typed || ' '}</Text>
          </View>
          <Text style={styles.word}>ciudad</Text>
        </View>
      </View>
      <Pop active={active && done} delay={150} style={styles.tag}>
        <Text style={styles.tagText}>¡Eso es!</Text>
      </Pop>
    </View>
  );
}

/**
 * PLAYED ONCE, EASED (Radek: "make the animation smoother and dont repeat
 * it"). The three scenes run in order and the last one stays: the screen
 * ends on the word coming back, which is the promise. Between scenes the
 * stage dips out and back in (fade + a small rise) instead of cutting, and
 * the lines light up one after another and STAY lit, each finished one
 * turning into a check — a sequence completing, not a carousel.
 */
export function LoopStory({ isCurrent }: { isCurrent: boolean }) {
  const [scene, setScene] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setScene(0);
    fade.setValue(0);
    if (!isCurrent) return;
    const ease = Easing.inOut(Easing.cubic);
    const show = () =>
      Animated.timing(fade, { toValue: 1, duration: 520, easing: ease, useNativeDriver: true });
    const hide = () =>
      Animated.timing(fade, { toValue: 0, duration: 380, easing: ease, useNativeDriver: true });
    show().start();
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let next = 1; next < 3; next++) {
      timers.push(
        setTimeout(() => {
          hide().start(({ finished }) => {
            if (!finished) return;
            setScene(next);
            show().start();
          });
        }, next * SCENE_MS)
      );
    }
    return () => {
      timers.forEach(clearTimeout);
      fade.stopAnimation();
    };
  }, [isCurrent, fade]);

  const rise = fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <View>
      <View style={styles.stage}>
        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>
          {scene === 0 && <TapScene active={isCurrent} />}
          {scene === 1 && <TrainScene active={isCurrent} />}
          {scene === 2 && <ReturnScene active={isCurrent} />}
        </Animated.View>
      </View>
      <View style={styles.lines}>
        {LOOP_LINES.map((line, i) => (
          <StoryLine key={line} index={i} line={line} state={i < scene ? 'done' : i === scene ? 'now' : 'next'} />
        ))}
      </View>
    </View>
  );
}

/** One numbered line: dim until its scene, lit while it plays, checked after. */
function StoryLine({ index, line, state }: { index: number; line: string; state: 'next' | 'now' | 'done' }) {
  const lit = useRef(new Animated.Value(state === 'next' ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(lit, {
      toValue: state === 'next' ? 0 : 1,
      duration: 450,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [state, lit]);
  const opacity = lit.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  return (
    <Animated.View style={[styles.lineRow, { opacity }]}>
      <View style={[styles.num, state !== 'next' && styles.numOn]}>
        <Text style={[styles.numText, state !== 'next' && styles.numTextOn]}>
          {state === 'done' ? '✓' : index + 1}
        </Text>
      </View>
      <Text style={styles.lineText}>{line}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    backgroundColor: 'rgba(242,245,243,0.05)',
    borderRadius: 22,
    height: 200,
    justifyContent: 'center',
    marginTop: 18,
    overflow: 'hidden',
  },
  scene: { alignItems: 'center', gap: 16 },
  video: {
    backgroundColor: '#050706',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  line: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  word: { color: INK, fontSize: 20, fontWeight: '800' },
  litBg: { backgroundColor: 'rgba(94,230,168,0.25)', borderRadius: 6, marginHorizontal: -4 },
  litWord: {},
  ripple: {
    borderColor: MINT,
    borderRadius: 999,
    borderWidth: 2,
    height: 36,
    left: 6,
    position: 'absolute',
    top: -4,
    width: 36,
  },
  tag: { backgroundColor: MINT, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  tagText: { color: '#06130d', fontSize: 14, fontWeight: '900' },
  pathSlice: { alignItems: 'center', gap: 10 },
  coinRow: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  coin: {
    alignItems: 'center',
    borderRadius: 26,
    height: 46,
    justifyContent: 'center',
    width: 56,
  },
  coinDone: { backgroundColor: MINT, borderBottomColor: '#2a9e6d', borderBottomWidth: 5 },
  coinHere: { backgroundColor: INK, borderBottomColor: '#aab4af', borderBottomWidth: 5 },
  coinLocked: { backgroundColor: '#232a27', borderBottomColor: '#171d1a', borderBottomWidth: 5 },
  check: { color: '#06130d', fontSize: 20, fontWeight: '900' },
  play: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 8,
    borderLeftColor: '#06130d',
    borderLeftWidth: 13,
    borderTopColor: 'transparent',
    borderTopWidth: 8,
    height: 0,
    marginLeft: 4,
    width: 0,
  },
  lockBody: { backgroundColor: '#4a5550', borderRadius: 3, height: 11, width: 16 },
  aprendida: { backgroundColor: 'rgba(94,230,168,0.14)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7 },
  aprendidaText: { color: MINT, fontSize: 15, fontWeight: '900' },
  aprendidaWord: { color: 'rgba(242,245,243,0.7)', fontSize: 12, fontWeight: '700', marginTop: 1 },
  slot: { borderBottomColor: MINT, borderBottomWidth: 2, minWidth: 56, paddingHorizontal: 4 },
  slotDone: { backgroundColor: 'rgba(94,230,168,0.12)', borderRadius: 4 },
  slotText: { textAlign: 'center' },
  lines: { gap: 12, marginTop: 20 },
  lineRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  num: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.1)',
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  numOn: { backgroundColor: MINT },
  numText: { color: INK, fontSize: 15, fontWeight: '900' },
  numTextOn: { color: '#06130d' },
  lineText: { color: INK, flex: 1, fontSize: 16, fontWeight: '700', lineHeight: 22 },
});
