import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { TIERS, TIER_LEARNED, type LearnedTier } from '@loro/core/levels';

/**
 * THE LADDER, FROM THE CHIP (Radek, 2026-09-30: "when a user clicks the
 * guiri he needs to see the levels somehow like a banner"). Drops under the
 * Words title: all six tiers as steps, the one you hold lit, how many words
 * learned reach the next. The same numbers as Progress (tierForLearned over
 * learnedTotal) — the caller hands over the ladder it already shows.
 *
 * Inline, never a Modal — VocabScreen owns exactly one native window.
 */

const MINT = '#5ee6a8';
const INK = '#f2f5f3';
const MUTED = 'rgba(242,245,243,0.6)';
const FAINT = 'rgba(242,245,243,0.35)';

export function LevelBanner({ ladder, onClose }: { ladder: LearnedTier; onClose: () => void }) {
  const drop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(drop, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [drop]);

  const { tier, next, have, need, meter } = ladder;
  const left = Math.max(0, need - have);

  return (
    <Animated.View
      style={[
        styles.banner,
        { opacity: drop, transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] },
      ]}
    >
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close levels">
        <View style={styles.head}>
          <Text style={styles.kicker}>YOUR LEVEL</Text>
          <Text style={styles.close}>Close</Text>
        </View>
        <Text style={styles.name}>
          {tier.name}
          <Text style={styles.meaning}>  {tier.meaning}</Text>
        </Text>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.max(3, meter)}%` }]} />
        </View>
        <Text style={styles.toNext}>
          {next
            ? `${have} words learned · ${left} more to ${next.name}`
            : `${have} words learned · the top of the ladder`}
        </Text>

        <View style={styles.steps}>
          {/* One track behind all six (a link per step painted over the
              previous step's number), mint up to yours and on toward the next. */}
          <View pointerEvents="none" style={[styles.track2, { left: `${50 / TIERS.length}%`, right: `${50 / TIERS.length}%` }]} />
          <View
            pointerEvents="none"
            style={[
              styles.track2On,
              {
                left: `${50 / TIERS.length}%`,
                width: `${((tier.level - 1 + (next ? meter / 100 : 0)) * 100) / TIERS.length}%`,
              },
            ]}
          />
          {TIERS.map((t, i) => {
            const held = t.level < tier.level;
            const here = t.level === tier.level;
            return (
              <View key={t.level} style={styles.step}>
                <View style={[styles.dot, held && styles.dotHeld, here && styles.dotHere]}>
                  <Text style={[styles.dotNum, (held || here) && styles.dotNumOn]}>{t.level}</Text>
                </View>
                <Text style={[styles.stepName, here && styles.stepNameHere]} numberOfLines={2}>
                  {t.name}
                </Text>
                <Text style={styles.stepNeed}>{TIER_LEARNED[i]}</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.foot}>Words learned to hold each level. Every word you train here counts.</Text>
      </Pressable>
    </Animated.View>
  );
}

const DOT = 26;

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#121815',
    borderColor: 'rgba(94,230,168,0.18)',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 10,
    padding: 14,
  },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { color: MINT, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  close: { color: FAINT, fontSize: 12, fontWeight: '800' },
  name: { color: INK, fontSize: 22, fontWeight: '900', marginTop: 2 },
  meaning: { color: MUTED, fontSize: 13, fontWeight: '700' },
  track: {
    backgroundColor: 'rgba(242,245,243,0.1)',
    borderRadius: 999,
    height: 6,
    marginTop: 10,
    overflow: 'hidden',
  },
  fill: { backgroundColor: MINT, borderRadius: 999, height: 6 },
  toNext: { color: MUTED, fontSize: 13, fontWeight: '700', marginTop: 6 },
  steps: { flexDirection: 'row', marginTop: 14 },
  step: { alignItems: 'center', flex: 1 },
  track2: {
    backgroundColor: 'rgba(242,245,243,0.12)',
    borderRadius: 2,
    height: 3,
    position: 'absolute',
    top: DOT / 2 - 1.5,
  },
  track2On: { backgroundColor: MINT, borderRadius: 2, height: 3, position: 'absolute', top: DOT / 2 - 1.5 },
  dot: {
    alignItems: 'center',
    backgroundColor: '#1b2320',
    borderColor: 'rgba(242,245,243,0.18)',
    borderRadius: 999,
    borderWidth: 2,
    height: DOT,
    justifyContent: 'center',
    width: DOT,
  },
  dotHeld: { backgroundColor: MINT, borderColor: MINT },
  dotHere: { backgroundColor: MINT, borderColor: INK, transform: [{ scale: 1.15 }] },
  dotNum: { color: FAINT, fontSize: 12, fontWeight: '900' },
  dotNumOn: { color: '#06130d' },
  stepName: { color: FAINT, fontSize: 11, fontWeight: '800', lineHeight: 13, marginTop: 6, textAlign: 'center' },
  stepNameHere: { color: INK },
  stepNeed: { color: FAINT, fontSize: 10, fontWeight: '700', marginTop: 2 },
  foot: { color: FAINT, fontSize: 11, lineHeight: 15, marginTop: 12 },
});
