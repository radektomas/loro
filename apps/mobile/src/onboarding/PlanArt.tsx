import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { ACCENT, MUTED, ON_ACCENT, TEXT } from './chrome';
import { BRAND } from './brand';

/**
 * THE PLAN SCREENS' PICTURES (Radek, 2026-10-27).
 *
 * PlanBuild: "good page, but the visual is bad, a lot of text". The wobbly
 * A→B line, the three-row sheet and the verdict paragraph became one ring
 * that fills to 100%, four short lines that tick as it passes them, and one
 * number at the end. Every line is still the user's own answer or shipped
 * behaviour; the ring paces the reveal, it does not claim computation.
 *
 * PlanReady: "the colourful squares don't make any sense". The plan is a
 * BOARDING PASS for the trip the app already is (Madrid first, thirty
 * cities on): from their level today to fluent by their month, with pace,
 * focus, why and the first stop as the pass's fields, stamped ready.
 */

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ------------------------------------------------------------- plan ring

export function PlanRing({ progress, size = 168 }: { progress: SharedValue<number>; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const [pct, setPct] = useState(0);
  useAnimatedReaction(
    () => Math.round(progress.value * 100),
    (now, before) => {
      if (now !== before) runOnJS(setPct)(now);
    }
  );
  const arc = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.value) }));
  return (
    <View style={{ height: size, width: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(242,245,243,0.08)" strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ACCENT}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${length} ${length}`}
          animatedProps={arc}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.ringCentre]}>
        <Text style={styles.ringPct}>
          {pct}
          <Text style={styles.ringPctUnit}>%</Text>
        </Text>
      </View>
    </View>
  );
}

/** One line of the checklist: dim until the ring passes `at`, then ticked. */
export function PlanCheck({ progress, at, text }: { progress: SharedValue<number>; at: number; text: string }) {
  const tick = useAnimatedStyle(() => {
    const t = interpolate(progress.value, [at - 0.04, at], [0, 1], Extrapolation.CLAMP);
    return { opacity: t, transform: [{ scale: 0.6 + t * 0.4 }] };
  });
  const row = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [at - 0.12, at], [0.3, 1], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View style={[styles.check, row]}>
      <View style={styles.checkDot}>
        <Animated.View style={[styles.checkFill, tick]}>
          <Text style={styles.checkMark}>✓</Text>
        </Animated.View>
      </View>
      <Text style={styles.checkText}>{text}</Text>
    </Animated.View>
  );
}

// --------------------------------------------------------- boarding pass

export type PassFields = {
  from: string;
  to: string;
  toDate: string;
  pace: string;
  focus: string;
  why: string;
  firstStop: string;
};

/** Bar widths for the pass's "barcode": fixed, so it is the same drawing
    every time and nobody reads it as an encoded anything. */
/** The sheen's strips, edge to centre to edge. */
const SHEEN = [0.04, 0.1, 0.18, 0.26, 0.18, 0.1, 0.04];

const BARS = [3, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 3, 1, 2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 3, 1];

export function BoardingPass({ fields, active }: { fields: PassFields; active: boolean }) {
  const reduced = useReducedMotion();
  const enter = useSharedValue(reduced ? 1 : 0);
  const stamp = useSharedValue(reduced ? 1 : 0);
  const plane = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!active || reduced) return;
    enter.value = withTiming(1, { duration: 620, easing: Easing.bezier(0.22, 1, 0.36, 1) });
    plane.value = withDelay(250, withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) }));
    stamp.value = withDelay(900, withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) }));
  }, [active, reduced, enter, stamp, plane]);

  const card = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 40 }, { rotate: `${(1 - enter.value) * -4}deg` }],
  }));
  const [passW, setPassW] = useState(0);
  const sheenStyle = useAnimatedStyle(() => ({
    opacity: stamp.value > 0 && stamp.value < 1 ? 1 : 0,
    transform: [{ translateX: -140 + stamp.value * (passW + 220) }, { rotate: '18deg' }],
  }));
  const [routeW, setRouteW] = useState(0);
  const planeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: plane.value * Math.max(0, routeW - 18) }],
  }));
  const trail = useAnimatedStyle(() => ({ width: plane.value * routeW }));

  return (
    <Animated.View style={[styles.pass, card]} onLayout={(e) => setPassW(e.nativeEvent.layout.width)}>
      {/* THE AIRLINE IS LORO (Radek, 2026-10-27): the real logo, then
          "Air" in its green, on a white band with a mint stripe under it.
          White because the logo is green: on the mint band it vanished. */}
      <View style={styles.passHeader}>
        <View style={styles.passHeaderBrand}>
          <Image source={BRAND.logo} style={styles.passLogo} resizeMode="contain" accessibilityLabel="Loro" />
          <Text style={styles.passAir}>Air</Text>
        </View>
        <View style={styles.passKindBox}>
          <Text style={styles.passKind}>BOARDING</Text>
          <Text style={styles.passKind}>PASS</Text>
        </View>
      </View>
      <View style={styles.passStripe} />

      <View style={styles.route}>
        <View>
          <Text style={styles.label}>FROM</Text>
          <Text style={styles.code}>{fields.from}</Text>
          <Text style={styles.sub}>Today</Text>
        </View>
        <View style={styles.routeMid} onLayout={(e) => setRouteW(e.nativeEvent.layout.width)}>
          <View style={styles.routeLine}>
            {Array.from({ length: 14 }, (_, i) => (
              <View key={i} style={styles.routeDash} />
            ))}
          </View>
          <Animated.View style={[styles.routeTrail, trail]} />
          <Animated.Text style={[styles.plane, planeStyle]}>✈︎</Animated.Text>
        </View>
        <View style={styles.routeEnd}>
          <Text style={styles.label}>TO</Text>
          <Text style={styles.code}>{fields.to}</Text>
          <Text style={styles.sub}>{fields.toDate}</Text>
        </View>
      </View>

      <View style={styles.perforation}>
        {Array.from({ length: 22 }, (_, i) => (
          <View key={i} style={styles.perfDash} />
        ))}
      </View>

      <View style={styles.grid}>
        <Field label="PACE" value={fields.pace} />
        <Field label="FOCUS" value={fields.focus} />
        <Field label="WHY" value={fields.why} />
        <Field label="FIRST STOP" value={fields.firstStop} />
      </View>

      <View style={styles.barcode}>
        {BARS.map((w, i) => (
          <View key={i} style={[styles.bar, { width: w, opacity: i % 5 === 0 ? 0.5 : 0.85 }]} />
        ))}
      </View>

      {/* THE SHEEN (replaced the "¡LISTO!" rubber stamp, 2026-10-27:
          "super cheap"): one soft band of light crossing the pass once it
          has landed, the way a card arrives in Wallet. Soft-edged from
          stacked strips, since there is no gradient module. */}
      <Animated.View style={[styles.sheen, sheenStyle]} pointerEvents="none">
        {SHEEN.map((a, i) => (
          <View key={i} style={[styles.sheenStrip, { backgroundColor: `rgba(255,255,255,${a})` }]} />
        ))}
      </Animated.View>
    </Animated.View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const PASS_BG = '#f4f1e8';
const PASS_INK = '#10231b';
const PASS_MUTED = 'rgba(16,35,27,0.5)';

const styles = StyleSheet.create({
  ringCentre: { alignItems: 'center', justifyContent: 'center' },
  ringPct: { color: TEXT, fontSize: 44, fontVariant: ['tabular-nums'], fontWeight: '800', letterSpacing: -1.5 },
  ringPctUnit: { color: MUTED, fontSize: 22, fontWeight: '700' },

  check: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 6 },
  checkDot: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 999,
    height: 24,
    overflow: 'hidden',
    width: 24,
  },
  checkFill: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkMark: { color: ON_ACCENT, fontSize: 13, fontWeight: '900' },
  checkText: { color: TEXT, flex: 1, fontSize: 16, fontWeight: '700', lineHeight: 21 },

  pass: {
    backgroundColor: PASS_BG,
    borderRadius: 22,
    marginTop: 20,
    overflow: 'hidden',
    paddingBottom: 16,
    paddingHorizontal: 18,
  },
  passHeader: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: -18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  passHeaderBrand: { alignItems: 'flex-end', flexDirection: 'row', gap: 4 },
  /** The lockup is 660×327. */
  passLogo: { height: 40, width: 81 },
  passAir: { color: '#43a047', fontSize: 22, fontWeight: '900', letterSpacing: -0.3, marginBottom: 3 },
  passStripe: { backgroundColor: ACCENT, height: 4, marginHorizontal: -18 },
  passKindBox: { alignItems: 'flex-end' },
  passKind: { color: 'rgba(16,35,27,0.55)', fontSize: 10, fontWeight: '900', letterSpacing: 1.6, lineHeight: 12 },
  route: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 16 },
  routeMid: { flex: 1, height: 24, justifyContent: 'center' },
  routeLine: { flexDirection: 'row', justifyContent: 'space-between' },
  routeDash: { backgroundColor: 'rgba(16,35,27,0.22)', borderRadius: 1, height: 2, width: 5 },
  routeTrail: { backgroundColor: '#1b8a5e', borderRadius: 1, height: 2, left: 0, position: 'absolute' },
  plane: { color: '#1b8a5e', fontSize: 18, left: 0, position: 'absolute' },
  routeEnd: { alignItems: 'flex-end' },
  label: { color: PASS_MUTED, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  code: { color: PASS_INK, fontSize: 30, fontWeight: '900', letterSpacing: -0.8, marginTop: 1 },
  sub: { color: PASS_INK, fontSize: 13, fontWeight: '700', marginTop: 1 },

  perforation: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -4, marginVertical: 16 },
  perfDash: { backgroundColor: 'rgba(16,35,27,0.18)', borderRadius: 1, height: 2, width: 8 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  field: { width: '50%' },
  value: { color: PASS_INK, fontSize: 16, fontWeight: '800', lineHeight: 20, marginTop: 2, paddingRight: 8 },

  barcode: { flexDirection: 'row', gap: 2, height: 30, marginTop: 18 },
  bar: { backgroundColor: PASS_INK, borderRadius: 0.5, height: '100%' },

  sheen: { bottom: -60, flexDirection: 'row', left: 0, position: 'absolute', top: -60 },
  sheenStrip: { width: 12 },
});
