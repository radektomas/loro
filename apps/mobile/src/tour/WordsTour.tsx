import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ACCENT } from '../onboarding/chrome';

/**
 * The Words half of the walkthrough (tour.ts): a spotlight that dims the page
 * except one rounded hole. Loro's words and the Next button live in the tour
 * dock under the page (TourDock), the same place as on the feed.
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

const DIM = 'rgba(4,6,5,0.78)';
const MOVE = { duration: 420, easing: Easing.inOut(Easing.cubic) };
const PAD = 8;
const RADIUS = 18;

export function WordsTour({ rect }: { rect: TourRect | null }) {
  const { width, height } = useWindowDimensions();
  const x = useSharedValue(width / 2);
  const y = useSharedValue(height / 2);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
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
  }, [rect, x, y, w, h]);

  const top = useAnimatedStyle(() => ({ height: Math.max(0, y.value) }));
  const bottom = useAnimatedStyle(() => ({ top: y.value + h.value }));
  const left = useAnimatedStyle(() => ({ top: y.value, height: h.value, width: Math.max(0, x.value) }));
  const right = useAnimatedStyle(() => ({ top: y.value, height: h.value, left: x.value + w.value }));
  const ring = useAnimatedStyle(() => ({ top: y.value, left: x.value, width: w.value, height: h.value }));

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      entering={FadeIn.duration(260)}
      exiting={FadeOut.duration(200)}
    >
      <Animated.View style={[styles.pane, { left: 0, right: 0, top: 0 }, top]} />
      <Animated.View style={[styles.pane, { left: 0, right: 0, bottom: 0 }, bottom]} />
      <Animated.View style={[styles.pane, { left: 0 }, left]} />
      <Animated.View style={[styles.pane, { right: 0 }, right]} />
      <Animated.View pointerEvents="none" style={[styles.ring, ring]} />
      {/* Loro speaks from the dock under the page (TourDock): the overlay
          only frames what he is talking about. */}
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
});
