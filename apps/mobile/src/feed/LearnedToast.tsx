import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BRAND } from '../onboarding/brand';
import { requestWordsView } from '../vocab/wordsView';
import { subscribeToWordLearned, type WordLearnedRaise } from './wordLearned';

/**
 * THE WORD-LEARNED TOAST. Not a card: nothing dims, nothing pauses, the
 * clip carries on. A pill rises from the bottom of the feed for a few
 * seconds — the word, its meaning, how many are learned now — and a tap
 * opens the Words tab on the Learned face. Raised by RecallHost after the
 * celebration for the grade that crossed the word (wordLearned.ts), and
 * only when no card took that moment.
 *
 * WHERE IT SITS. The bottom of the feed area is the karaoke band's lower
 * edge and the author line — never the player, which is measured into a
 * box higher up. Loro's rule that nothing is drawn over the frame holds.
 */
const TOAST_MS = 3200;

export function LearnedToast({ onGoToWords }: { onGoToWords?: () => void }) {
  const [raise, setRaise] = useState<WordLearnedRaise | null>(null);
  const progress = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => setRaise(null), []);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    progress.value = withTiming(0, { duration: 220 }, (done) => {
      if (done) runOnJS(clear)();
    });
  }, [progress, clear]);

  useEffect(
    () =>
      subscribeToWordLearned((next) => {
        if (timer.current) clearTimeout(timer.current);
        setRaise(next);
      }),
    []
  );

  useEffect(() => {
    if (!raise) return;
    progress.value = withSpring(1, { damping: 18, stiffness: 190 });
    timer.current = setTimeout(hide, TOAST_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [raise, progress, hide]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 28 }],
  }));

  if (!raise) return null;

  return (
    <Animated.View style={[styles.wrap, style]} pointerEvents="box-none">
      <Pressable
        onPress={() => {
          hide();
          if (onGoToWords) {
            requestWordsView('learned');
            onGoToWords();
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={`${raise.text} learned. ${raise.learned} words learned. Opens your learned words.`}
        style={({ pressed }) => [styles.toast, pressed && styles.pressed]}
      >
        <Image source={BRAND.parrot} style={styles.art} resizeMode="contain" />
        <View style={styles.text}>
          <Text style={styles.eyebrow}>¡Palabra aprendida!</Text>
          <Text style={styles.word} numberOfLines={1}>
            <Text style={styles.wordStrong}>{raise.text}</Text>
            <Text style={styles.wordMeaning}> · {raise.translation}</Text>
          </Text>
          <Text style={styles.body} numberOfLines={1}>
            {raise.learned} {raise.learned === 1 ? 'word' : 'words'} learned · tap to see them
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { bottom: 14, left: 16, position: 'absolute', right: 16 },
  toast: {
    alignItems: 'center',
    backgroundColor: '#17201b',
    borderColor: 'rgba(94,230,168,0.45)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  pressed: { opacity: 0.85 },
  art: { height: 46, width: 32 },
  text: { flex: 1 },
  eyebrow: {
    color: '#5ee6a8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  word: { color: '#f2f5f3', fontSize: 16, marginTop: 1 },
  wordStrong: { fontWeight: '800' },
  wordMeaning: { color: 'rgba(242,245,243,0.7)', fontSize: 14 },
  body: { color: 'rgba(242,245,243,0.55)', fontSize: 12, marginTop: 2 },
});
