import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { ACCENT, ON_ACCENT, TEXT } from './chrome';

/**
 * THE QUESTION SCREENS IN THE NEW VIBE (Radek, 2026-10-27: "the screens
 * where you choose what you like and why you want to learn Spanish need a
 * design improvement … put the picking pages in the similar vibe as the new
 * stuff", meaning the lyrics hero, the lesson and the boarding pass).
 *
 * Spanish first, big and bold, English small under it, mint for the
 * chosen. No coloured icon tiles (the squares were what Radek disliked on
 * the old plan screen).
 *
 *   MotiveTile — a reason to learn as a square tile with an icon, English
 *     first (Radek: some people don't know the Spanish yet), the Spanish
 *     small under it, the icon faded big in the background.
 *   TopicPill — a topic as its Spanish word in a pill; the pills wrap into
 *     a cloud of different widths, like a genre picker.
 *
 * Selection only touches paint and a tiny press scale, never layout, so a
 * tap never shifts anything around it (the WordChip rule, steps.tsx).
 */

function useSelection(on: boolean) {
  const reduced = useReducedMotion();
  const sel = useSharedValue(on ? 1 : 0);
  const press = useSharedValue(0);
  useEffect(() => {
    sel.value = withTiming(on ? 1 : 0, { duration: reduced ? 0 : 240, easing: Easing.out(Easing.cubic) });
  }, [on, reduced, sel]);
  const pressIn = () => {
    press.value = withTiming(1, { duration: reduced ? 0 : 90 });
  };
  const pressOut = () => {
    press.value = withTiming(0, { duration: reduced ? 0 : 160 });
  };
  return { sel, press, pressIn, pressOut };
}

// ------------------------------------------------------------- motive tile

/**
 * Icon paths: Material Icons (Apache 2.0), 24-unit viewBox, drawn filled.
 * Keyed on the stored motivation ids.
 */
export const MOTIVE_ICONS: Record<string, string> = {
  travel:
    'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z',
  people:
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  work:
    'M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z',
  culture: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
};

/**
 * A reason to learn as a square tile (Radek, 2026-10-27: "cool simplicity,
 * too much text, it needs some icons … firstly in English … something in
 * the background of the card"). The icon in a mint disc, the English word
 * big, the Spanish small under it, and the same icon huge and faded in the
 * card's corner as its background, which warms to mint when chosen.
 */
export function MotiveTile({
  id,
  en,
  es,
  on,
  onPress,
}: {
  id: string;
  en: string;
  es: string;
  on: boolean;
  onPress: () => void;
}) {
  const { sel, press, pressIn, pressOut } = useSelection(on);
  const path = MOTIVE_ICONS[id] ?? MOTIVE_ICONS.travel;
  const tile = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], ['rgba(20,26,23,0.92)', 'rgba(94,230,168,0.12)']),
    borderColor: interpolateColor(sel.value, [0, 1], ['rgba(242,245,243,0.07)', 'rgba(94,230,168,0.6)']),
    transform: [{ scale: 1 - press.value * 0.02 }],
  }));
  const mark = useAnimatedStyle(() => ({ opacity: 0.07 + sel.value * 0.13 }));
  const disc = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], ['rgba(94,230,168,0.14)', ACCENT]),
  }));
  const onIcon = useAnimatedStyle(() => ({ opacity: sel.value }));
  const label = useAnimatedStyle(() => ({ color: interpolateColor(sel.value, [0, 1], [TEXT, ACCENT]) }));
  const tick = useAnimatedStyle(() => ({ opacity: sel.value, transform: [{ scale: 0.6 + sel.value * 0.4 }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={styles.motiveCell}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={en}
    >
      <Animated.View style={[styles.motive, tile]}>
        <Animated.View style={[styles.motiveMark, mark]} pointerEvents="none">
          <Svg width={120} height={120} viewBox="0 0 24 24">
            <Path d={path} fill={ACCENT} />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.motiveDisc, disc]}>
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path d={path} fill={ACCENT} />
          </Svg>
          <Animated.View style={[StyleSheet.absoluteFill, styles.motiveDiscOn, onIcon]}>
            <Svg width={24} height={24} viewBox="0 0 24 24">
              <Path d={path} fill={ON_ACCENT} />
            </Svg>
          </Animated.View>
        </Animated.View>
        <Animated.View style={[styles.motiveTick, tick]}>
          <Text style={styles.motiveTickMark}>✓</Text>
        </Animated.View>
        <View>
          <Animated.Text style={[styles.motiveEn, label]}>{en}</Animated.Text>
          <Text style={styles.motiveEs}>{es}</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export function MotiveGrid({ children }: { children: ReactNode }) {
  return <View style={styles.motiveGrid}>{children}</View>;
}

// --------------------------------------------------------------- topic pill

export function TopicPill({
  es,
  en,
  glyph,
  on,
  onPress,
}: {
  es: string;
  en: string;
  glyph: string;
  on: boolean;
  onPress: () => void;
}) {
  const { sel, press, pressIn, pressOut } = useSelection(on);
  const pill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], ['rgba(20,26,23,0.92)', ACCENT]),
    borderColor: interpolateColor(sel.value, [0, 1], ['rgba(242,245,243,0.09)', ACCENT]),
    transform: [{ scale: 1 - press.value * 0.03 }],
  }));
  const ink = useAnimatedStyle(() => ({ color: interpolateColor(sel.value, [0, 1], [TEXT, ON_ACCENT]) }));
  const soft = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], ['rgba(94,230,168,0.75)', 'rgba(6,19,13,0.65)']),
  }));
  const glyphStyle = useAnimatedStyle(() => ({ color: interpolateColor(sel.value, [0, 1], [ACCENT, ON_ACCENT]) }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${en}, ${es}`}
    >
      <Animated.View style={[styles.pill, pill]}>
        <Animated.Text style={[styles.pillGlyph, glyphStyle]}>{glyph}</Animated.Text>
        {/* English big, Spanish under it (Radek, 2026-10-27): the word
            they know first, the word they will learn second. */}
        <View>
          <Animated.Text style={[styles.pillBig, ink]}>{en}</Animated.Text>
          <Animated.Text style={[styles.pillSmall, soft]}>{es}</Animated.Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export function PillCloud({ children }: { children: ReactNode }) {
  return <View style={styles.cloud}>{children}</View>;
}

const styles = StyleSheet.create({
  motiveGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 20 },
  motiveCell: { width: '47.8%' },
  motive: {
    aspectRatio: 1,
    borderRadius: 24,
    borderWidth: 1.5,
    justifyContent: 'space-between',
    overflow: 'hidden',
    padding: 16,
  },
  motiveMark: { bottom: -26, position: 'absolute', right: -24, transform: [{ rotate: '-12deg' }] },
  motiveDisc: {
    alignItems: 'center',
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  motiveDiscOn: { alignItems: 'center', justifyContent: 'center' },
  motiveTick: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    top: 12,
    width: 24,
  },
  motiveTickMark: { color: ON_ACCENT, fontSize: 13, fontWeight: '900' },
  motiveEn: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  motiveEs: { color: 'rgba(94,230,168,0.75)', fontSize: 14, fontStyle: 'italic', fontWeight: '600', marginTop: 1 },

  /** One pill per row (Radek, 2026-10-27: "all the pills under each other"). */
  cloud: { gap: 10, marginTop: 20 },
  pill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 20,
    paddingVertical: 11,
  },
  pillGlyph: { fontSize: 20, fontWeight: '700', textAlign: 'center', width: 26 },
  pillBig: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  pillSmall: { fontSize: 13, fontStyle: 'italic', fontWeight: '600', marginTop: -1 },
});
