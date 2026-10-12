import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { BRAND } from '../onboarding/brand';
import { ACCENT, MUTED, ON_ACCENT, TEXT } from '../onboarding/chrome';
import { skipTour, type TourStep } from './tour';

/**
 * The Words half of the walkthrough (tour.ts): a spotlight that dims the page
 * except one rounded hole, and Loro under it with one line and one button.
 *
 * THE HOLE MOVES, IT DOES NOT JUMP. Four dim panes are laid around a rect held
 * in shared values; a new target animates them there (and the screen behind
 * scrolls to it at the same time), so city → word → map reads as one camera
 * move rather than three popups. Nothing here covers a video: Words has none.
 *
 * VocabScreen owns the geometry (it knows the scroll and where the path sits)
 * and hands over a rect in this overlay's own coordinates, or null while it is
 * still measuring — the dim fades in first and the hole opens when it lands.
 */

export type TourRect = { x: number; y: number; width: number; height: number };

const COPY: Record<'wordsHere' | 'wordsTrain' | 'map', { title: string; body: string; cta: string }> = {
  wordsHere: {
    title: 'Your words live here',
    body: 'Every word you save lands in your city. The blue ones are gaps you filled right.',
    cta: 'Next',
  },
  wordsTrain: {
    title: 'Tap a word to train it',
    body: 'A few quick rounds and it’s learned. Then it comes back as a gap in your videos.',
    cta: 'Next',
  },
  map: {
    title: 'This is your trip',
    body: 'Learn the words in a city and you fly to the next one, all the way across the Spanish-speaking world.',
    cta: '¡Vamos!',
  },
};

const DIM = 'rgba(4,6,5,0.78)';
const MOVE = { duration: 420, easing: Easing.inOut(Easing.cubic) };
const PAD = 8;
const RADIUS = 18;

export function WordsTour({
  step,
  rect,
  onNext,
}: {
  step: 'wordsHere' | 'wordsTrain' | 'map';
  rect: TourRect | null;
  onNext: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const x = useSharedValue(width / 2);
  const y = useSharedValue(height / 2);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const [shown, setShown] = useState<TourRect | null>(null);
  /** This overlay's own height (the Words tab ends above the tab bar, so the
      window height overshoots it) and the card's, for placing the card. */
  const [boxH, setBoxH] = useState(0);
  const [cardH, setCardH] = useState(0);

  useEffect(() => {
    if (!rect) return;
    const r = {
      x: rect.x - PAD,
      y: rect.y - PAD,
      width: rect.width + PAD * 2,
      height: rect.height + PAD * 2,
    };
    x.value = withTiming(r.x, MOVE);
    y.value = withTiming(r.y, MOVE);
    w.value = withTiming(r.width, MOVE);
    h.value = withTiming(r.height, MOVE);
    setShown(r);
  }, [rect, x, y, w, h]);

  const top = useAnimatedStyle(() => ({ height: Math.max(0, y.value) }));
  const bottom = useAnimatedStyle(() => ({ top: y.value + h.value }));
  const left = useAnimatedStyle(() => ({ top: y.value, height: h.value, width: Math.max(0, x.value) }));
  const right = useAnimatedStyle(() => ({ top: y.value, height: h.value, left: x.value + w.value }));
  const ring = useAnimatedStyle(() => ({ top: y.value, left: x.value, width: w.value, height: h.value }));

  // The card goes where there is room — under the hole, else over it, else
  // pinned to the bottom of the screen — and never off either edge.
  const roomH = boxH || height;
  const minTop = insets.top + 8;
  const maxTop = Math.max(minTop, roomH - cardH - 12);
  let cardTop = maxTop;
  if (shown && cardH > 0) {
    const under = shown.y + shown.height + 14;
    const over = shown.y - 14 - cardH;
    cardTop = under <= maxTop ? under : over >= minTop ? over : maxTop;
  }
  const cardPos = { top: Math.min(Math.max(cardTop, minTop), maxTop), opacity: cardH > 0 ? 1 : 0 };
  const copy = COPY[step];

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      entering={FadeIn.duration(260)}
      exiting={FadeOut.duration(200)}
      onLayout={(e) => setBoxH(e.nativeEvent.layout.height)}
    >
      <Animated.View style={[styles.pane, { left: 0, right: 0, top: 0 }, top]} />
      <Animated.View style={[styles.pane, { left: 0, right: 0, bottom: 0 }, bottom]} />
      <Animated.View style={[styles.pane, { left: 0 }, left]} />
      <Animated.View style={[styles.pane, { right: 0 }, right]} />
      <Animated.View pointerEvents="none" style={[styles.ring, ring]} />

      <Animated.View
        key={step}
        entering={FadeIn.duration(300).delay(180)}
        style={[styles.card, cardPos]}
        onLayout={(e) => setCardH(e.nativeEvent.layout.height)}
      >
        <Image source={BRAND.parrot} style={styles.parrot} resizeMode="contain" />
        <View style={styles.cardText}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <View style={styles.actions}>
            <Pressable onPress={skipTour} hitSlop={10} accessibilityRole="button">
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
            <Pressable
              onPress={onNext}
              accessibilityRole="button"
              style={({ pressed }) => [styles.next, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.nextText}>{copy.cta}</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pane: { backgroundColor: DIM, position: 'absolute' },
  ring: {
    borderColor: ACCENT,
    borderRadius: RADIUS,
    borderWidth: 2,
    position: 'absolute',
    shadowColor: ACCENT,
    shadowOpacity: 0.6,
    shadowRadius: 14,
  },
  card: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(20,26,23,0.98)',
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    left: 16,
    padding: 14,
    position: 'absolute',
    right: 16,
  },
  parrot: { height: 78, width: 52 },
  cardText: { flex: 1 },
  title: { color: TEXT, fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  body: { color: MUTED, fontSize: 14.5, lineHeight: 20, marginTop: 4 },
  actions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  skip: { color: 'rgba(242,245,243,0.5)', fontSize: 13.5, fontWeight: '700' },
  next: { backgroundColor: ACCENT, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  nextText: { color: ON_ACCENT, fontSize: 15, fontWeight: '800' },
});
