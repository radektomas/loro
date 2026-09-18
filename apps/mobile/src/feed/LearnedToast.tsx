import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BRAND } from '../onboarding/brand';
import { usePlayerApi } from '../player/PlayerHost';
import { requestWordsView } from '../vocab/wordsView';
import { subscribeToWordLearned, type WordLearnedRaise } from './wordLearned';

/**
 * THE WORD-LEARNED MOMENT — Loro comes in from the side and says it.
 *
 * Radek, 2026-09-18: not in the subtitles; "somewhere like from the side of
 * the screen as Loro is saying it, we have the full screen above with the
 * video". So this is over the frame area: the parrot slides in from the
 * right edge at mid-height with a speech bubble — the word, its meaning,
 * the running count — holds for a couple of seconds and slides back out.
 *
 * Two hosts, one view. The FEED (LearnedToast) listens to the bus and
 * yields the player; the Words tab's FLASHCARD (WordVideoPanel) renders
 * LearnedMomentView directly on its graded face, where the frame is
 * already gone. "The Loro should pop up from the right side also when
 * you're on the Words page" — same animation, same bubble, same tap.
 *
 * THE FRAME IS NOT DRAWN OVER. Nothing may be painted on a playing YouTube
 * player (the embed's terms, see the layout note in PlayerHost), which is
 * why the cards pause and hide it while they are up. The feed host does the
 * same, for a shorter time and behind a lighter dim: onObscurePlayer hides
 * the player (the slide's poster shows through), the clip pauses, and play
 * resumes the instant the moment ends. A tap on the bubble opens the Words
 * tab on the Learned face; a tap anywhere else ends the moment early.
 */
export const LEARNED_MOMENT_MS = 2600;
const OUT_MS = 260;

type Leave = 'done' | 'words';

/** The moment itself: animation, hold, and the two taps. Host-agnostic. */
export function LearnedMomentView({
  raise,
  onDone,
  onWords,
}: {
  raise: WordLearnedRaise;
  /** The moment ended on its own or by a tap on the dim: carry on. */
  onDone: () => void;
  /** The bubble was tapped: show the learned words. Absent = same as done. */
  onWords?: () => void;
}) {
  const slide = useSharedValue(0); // 0 = off the right edge, 1 = in
  const bubble = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingRef = useRef<Leave | null>(null);

  const finish = useCallback(() => {
    const how = leavingRef.current ?? 'done';
    leavingRef.current = null;
    if (how === 'words' && onWords) onWords();
    else onDone();
  }, [onDone, onWords]);

  const leave = useCallback(
    (how: Leave) => {
      if (leavingRef.current) return;
      leavingRef.current = how;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      bubble.value = withTiming(0, { duration: OUT_MS * 0.6 });
      slide.value = withTiming(0, { duration: OUT_MS }, (done) => {
        if (done) runOnJS(finish)();
      });
    },
    [bubble, slide, finish]
  );

  useEffect(() => {
    leavingRef.current = null;
    slide.value = 0;
    bubble.value = 0;
    slide.value = withSpring(1, { damping: 16, stiffness: 170 });
    bubble.value = withDelay(120, withSpring(1, { damping: 14, stiffness: 200 }));
    timer.current = setTimeout(() => leave('done'), LEARNED_MOMENT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [raise, slide, bubble, leave]);

  const dimStyle = useAnimatedStyle(() => ({ opacity: slide.value * 0.55 }));
  const parrotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - slide.value) * 180 }, { rotate: `${(1 - slide.value) * -8}deg` }],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: bubble.value,
    transform: [{ scale: 0.85 + bubble.value * 0.15 }, { translateX: (1 - bubble.value) * 24 }],
  }));

  return (
    <View style={styles.layer}>
      {/* A tap anywhere ends the moment and whatever was happening carries on. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => leave('done')} accessibilityLabel="Continue">
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
      </Pressable>

      <View style={styles.stage} pointerEvents="box-none">
        <Animated.View style={[styles.bubbleWrap, bubbleStyle]}>
          <Pressable
            onPress={() => leave('words')}
            accessibilityRole="button"
            accessibilityLabel={`${raise.text} learned. ${raise.learned} words learned. Opens your learned words.`}
            style={({ pressed }) => [styles.bubble, pressed && styles.pressed]}
          >
            <Text style={styles.eyebrow}>¡Palabra aprendida!</Text>
            <Text style={styles.word}>{raise.text}</Text>
            <Text style={styles.meaning} numberOfLines={2}>
              {raise.translation}
            </Text>
            <Text style={styles.count}>
              {raise.learned} learned
              {raise.week > 1 ? ` · ${raise.week} this week` : ''} · tap to see them
            </Text>
          </Pressable>
          <View style={styles.tail} />
        </Animated.View>

        <Animated.View style={[styles.parrotWrap, parrotStyle]} pointerEvents="none">
          <Image
            source={BRAND.parrot}
            style={styles.parrot}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Loro the parrot"
          />
        </Animated.View>
      </View>
    </View>
  );
}

/** The feed's host: the bus, the tab gate, and the player yield. */
export function LearnedToast({
  active,
  onObscurePlayer,
  onGoToWords,
}: {
  /** Only the visible feed shows it — the Words tab's flashcard has its
      own host, and a raise from there must not pause and replay a hidden
      feed player. */
  active: boolean;
  onObscurePlayer: (obscured: boolean) => void;
  onGoToWords?: () => void;
}) {
  const api = usePlayerApi();
  const [raise, setRaise] = useState<WordLearnedRaise | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(
    () =>
      subscribeToWordLearned((next) => {
        if (activeRef.current) setRaise(next);
      }),
    []
  );

  const open = raise !== null;
  useEffect(() => {
    onObscurePlayer(open);
    if (open) api.pause();
    return () => onObscurePlayer(false);
  }, [open, onObscurePlayer, api]);

  const done = useCallback(() => {
    setRaise(null);
    api.play();
  }, [api]);
  const words = useCallback(() => {
    setRaise(null);
    if (onGoToWords) {
      requestWordsView('learned');
      onGoToWords();
    } else {
      api.play();
    }
  }, [api, onGoToWords]);

  if (!raise) return null;
  return <LearnedMomentView raise={raise} onDone={done} onWords={words} />;
}

const styles = StyleSheet.create({
  layer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  dim: { backgroundColor: '#0a0d0b' },
  /** Mid-height of the area, which is where the frame is. */
  stage: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: '34%',
  },
  bubbleWrap: { alignItems: 'flex-end', flexDirection: 'row', flexShrink: 1, marginLeft: 20 },
  bubble: {
    backgroundColor: '#f2f5f3',
    borderRadius: 20,
    maxWidth: 250,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.9 },
  /** The bubble's tail, pointing at the parrot. */
  tail: {
    backgroundColor: '#f2f5f3',
    height: 14,
    marginBottom: 26,
    marginLeft: -7,
    transform: [{ rotate: '45deg' }],
    width: 14,
  },
  eyebrow: {
    color: '#1d9a63',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  word: { color: '#06130d', fontSize: 24, fontWeight: '800', marginTop: 2 },
  meaning: { color: 'rgba(6,19,13,0.7)', fontSize: 15, marginTop: 1 },
  count: { color: 'rgba(6,19,13,0.55)', fontSize: 12, fontWeight: '600', marginTop: 8 },
  /** The parrot is 282x420; 150 tall keeps its ratio at ~100 wide. It
      starts past the right edge and settles with its back to it. */
  parrotWrap: { marginLeft: 6, marginRight: -18 },
  parrot: { height: 150, width: 100 },
});
