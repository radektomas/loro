import { useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { BRAND } from './brand';
import { ACCENT, TEXT } from './chrome';

/**
 * LORO, IN THE CONVERSATION (Radek, 2026-10-27: after the hands-on lesson
 * "the picking screens seem super boring").
 *
 * The question screens get a host: Loro at the top with a speech bubble in
 * Spanish and its English under it. He opens with a line, and every pick
 * gets a reaction ("¡Qué rico!" for food), with a little hop. It is the
 * lesson's idea carried into the questions: even answering teaches a
 * phrase, and the screen answers back instead of just recording.
 *
 * `line` is the whole state: change it and the bubble crossfades and Loro
 * hops. Bobs gently while on stage; still under Reduce Motion.
 */

export type LoroLine = { es: string; en: string };

export function LoroSays({ line, active }: { line: LoroLine; active: boolean }) {
  const reduced = useReducedMotion();
  const bob = useSharedValue(0);
  const hop = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) {
      bob.value = 0;
      return;
    }
    bob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [active, reduced, bob]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced) return;
    hop.value = withSequence(
      withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 260, easing: Easing.bounce })
    );
  }, [line.es, reduced, hop]);

  const parrot = useAnimatedStyle(() => ({
    transform: [
      { translateY: bob.value * -4 - hop.value * 12 },
      { rotate: `${(bob.value - 0.5) * 4 + hop.value * -6}deg` },
    ],
  }));

  return (
    <View style={styles.row}>
      <Animated.View style={parrot}>
        <Image source={BRAND.parrot} style={styles.parrot} resizeMode="contain" accessibilityLabel="Loro the parrot" />
      </Animated.View>
      <View style={styles.bubble}>
        <View style={styles.tail} />
        <Animated.View key={line.es} entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)}>
          <Text style={styles.es}>{line.es}</Text>
          <Text style={styles.en}>{line.en}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-end', flexDirection: 'row', gap: 12, marginBottom: 18 },
  parrot: { height: 78, width: 52 },
  bubble: {
    backgroundColor: 'rgba(20,26,23,0.95)',
    borderColor: 'rgba(94,230,168,0.3)',
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    marginBottom: 14,
    minHeight: 62,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tail: {
    backgroundColor: 'rgba(20,26,23,0.95)',
    borderBottomColor: 'rgba(94,230,168,0.3)',
    borderBottomWidth: 1,
    borderLeftColor: 'rgba(94,230,168,0.3)',
    borderLeftWidth: 1,
    bottom: 14,
    height: 12,
    left: -7,
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
    width: 12,
  },
  es: { color: TEXT, fontSize: 18, fontWeight: '800' },
  en: { color: ACCENT, fontSize: 13, fontWeight: '600', marginTop: 2, opacity: 0.85 },
});
