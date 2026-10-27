import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { ACCENT, CARD, MUTED, ON_ACCENT, TEXT } from './chrome';
import { FREQUENCY } from './copy';

/**
 * THE PACE QUESTION AS A WEEK (Radek, 2026-10-27: "keep the options but I
 * don't like the design"). Same three answers, same ids; what changed is
 * the picture. A week of seven days sits on top and fills in as you choose
 * (three days, every day, every day and then some), with the week's minutes
 * under it, and the answers are three big minute columns rather than three
 * rows of cards, so the screen stops looking like the motivation screen.
 *
 * The minutes-a-week line is the option's own copy multiplied out, the same
 * arithmetic as the plan screen's WEEKLY_MINUTES (steps.tsx), never a claim.
 */

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Which days each answer fills: Mon/Wed/Fri for a few times a week. */
const LIT: Record<string, number[]> = {
  light: [0, 2, 4],
  daily: [0, 1, 2, 3, 4, 5, 6],
  serious: [0, 1, 2, 3, 4, 5, 6],
};

export function FrequencyPicker({
  picked,
  onPick,
  weeklyMinutes,
}: {
  picked: string | null;
  onPick: (id: string) => void;
  /** Minutes a week per answer, from the plan's arithmetic. */
  weeklyMinutes: Record<string, number>;
}) {
  const lit = picked ? LIT[picked] ?? [] : [];
  const strong = picked === 'serious';
  const week = picked ? weeklyMinutes[picked] : null;
  return (
    <View>
      <View style={styles.weekCard}>
        <View style={styles.days}>
          {DAYS.map((d, i) => (
            <Day key={i} letter={d} on={lit.includes(i)} strong={strong} order={lit.indexOf(i)} />
          ))}
        </View>
        <Text style={styles.weekLine}>
          {week ? (
            <>
              About <Text style={styles.weekStrong}>{week} minutes</Text> of Spanish a week
            </>
          ) : (
            FREQUENCY.pickPrompt
          )}
        </Text>
      </View>

      <View style={styles.columns} accessibilityRole="radiogroup">
        {FREQUENCY.options.map((o) => (
          <Column key={o.id} minutes={o.minutes} label={o.label} es={o.es} on={picked === o.id} onPress={() => onPick(o.id)} />
        ))}
      </View>
    </View>
  );
}

function Day({ letter, on, strong, order }: { letter: string; on: boolean; strong: boolean; order: number }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(on ? 1 : 0);
  const s = useSharedValue(strong ? 1 : 0);
  useEffect(() => {
    // The days fill left to right, a beat apart, so a choice reads as a week
    // being planned rather than a switch being thrown.
    const delay = reduced ? 0 : Math.max(0, order) * 45;
    v.value = withDelay(on ? delay : 0, withTiming(on ? 1 : 0, { duration: reduced ? 0 : 260, easing: Easing.out(Easing.cubic) }));
    s.value = withDelay(delay, withTiming(strong && on ? 1 : 0, { duration: reduced ? 0 : 260 }));
  }, [on, strong, order, reduced, v, s]);
  const dot = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(v.value, [0, 1], ['rgba(242,245,243,0.05)', ACCENT]),
    borderColor: interpolateColor(v.value, [0, 1], ['rgba(242,245,243,0.14)', ACCENT]),
    transform: [{ scale: 0.92 + v.value * 0.08 }],
  }));
  const tick = useAnimatedStyle(() => ({ opacity: v.value }));
  /** "As much as I can": a second ring around every day. */
  const halo = useAnimatedStyle(() => ({ opacity: s.value * 0.9, transform: [{ scale: 1 + s.value * 0.18 }] }));
  return (
    <View style={styles.day}>
      <View style={styles.dotSeat}>
        <Animated.View style={[styles.halo, halo]} />
        <Animated.View style={[styles.dot, dot]}>
          <Animated.Text style={[styles.tick, tick]}>✓</Animated.Text>
        </Animated.View>
      </View>
      <Text style={[styles.dayLetter, on && styles.dayLetterOn]}>{letter}</Text>
    </View>
  );
}

function Column({ minutes, label, es, on, onPress }: { minutes: string; label: string; es: string; on: boolean; onPress: () => void }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(on ? 1 : 0, { duration: reduced ? 0 : 240, easing: Easing.out(Easing.cubic) });
  }, [on, reduced, v]);
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(v.value, [0, 1], [CARD, 'rgba(94,230,168,0.12)']),
    borderColor: interpolateColor(v.value, [0, 1], ['rgba(242,245,243,0.06)', 'rgba(94,230,168,0.6)']),
  }));
  const num = useAnimatedStyle(() => ({ color: interpolateColor(v.value, [0, 1], [TEXT, ACCENT]) }));
  return (
    <Pressable
      onPress={onPress}
      style={styles.columnCell}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}, ${minutes} minutes`}
    >
      <Animated.View style={[styles.column, box]}>
        <Animated.Text style={[styles.colNum, num]}>{minutes}</Animated.Text>
        <Text style={styles.colUnit}>min</Text>
        <Text style={styles.colLabel}>{label}</Text>
        <Text style={styles.colEs}>{es}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  weekCard: {
    backgroundColor: 'rgba(20,26,23,0.9)',
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  days: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { alignItems: 'center', gap: 8 },
  dotSeat: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  dot: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1.5,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  halo: {
    borderColor: 'rgba(94,230,168,0.45)',
    borderRadius: 999,
    borderWidth: 1.5,
    height: 34,
    position: 'absolute',
    width: 34,
  },
  tick: { color: ON_ACCENT, fontSize: 15, fontWeight: '900' },
  dayLetter: { color: 'rgba(242,245,243,0.4)', fontSize: 12, fontWeight: '800' },
  dayLetterOn: { color: TEXT },
  weekLine: { color: MUTED, fontSize: 15, marginTop: 16, textAlign: 'center' },
  weekStrong: { color: TEXT, fontWeight: '800' },

  columns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  columnCell: { flex: 1 },
  column: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    minHeight: 158,
    paddingHorizontal: 8,
    paddingVertical: 16,
  },
  colNum: { fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  colUnit: { color: MUTED, fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: -2, textTransform: 'uppercase' },
  colLabel: { color: TEXT, fontSize: 13, fontWeight: '700', lineHeight: 17, marginTop: 12, textAlign: 'center' },
  colEs: { color: 'rgba(94,230,168,0.7)', fontSize: 12, fontStyle: 'italic', fontWeight: '600', marginTop: 3 },
});
