import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND } from '../onboarding/brand';
import { usePlayerApi } from '../player/PlayerHost';
import { nextThreshold, subscribeToLevelUp, type LevelUpRaise } from './levelUp';

/**
 * THE LEVEL-UP CARD. Same shell as DayDoneCard — a card over the dimmed
 * feed, the player paused and yielded underneath — raised by RecallHost
 * after the celebration for the answer that climbed the ladder
 * (levelUp.ts). It says the new tier, in Spanish with its meaning, how
 * many words got you here and what the next rung costs, and one button.
 */
export function LevelUpCard({
  onObscurePlayer,
  onGoToProgress,
}: {
  onObscurePlayer: (obscured: boolean) => void;
  onGoToProgress?: () => void;
}) {
  const api = usePlayerApi();
  const [raise, setRaise] = useState<LevelUpRaise | null>(null);
  useEffect(() => subscribeToLevelUp(setRaise), []);

  const open = raise !== null;
  useEffect(() => {
    onObscurePlayer(open);
    if (open) api.pause();
    return () => onObscurePlayer(false);
  }, [open, onObscurePlayer, api]);

  if (!raise) return null;
  const next = nextThreshold(raise);

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Image
          source={BRAND.parrotWaving}
          style={styles.art}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Loro the parrot, waving"
        />
        <Text style={styles.eyebrow}>¡Subiste de nivel!</Text>
        <Text style={styles.gloss}>level up</Text>
        <Text style={styles.tier}>{raise.tier.name}</Text>
        <Text style={styles.meaning}>“{raise.tier.meaning}”</Text>
        <Text style={styles.body}>
          {raise.have} words learned.
          {next !== null
            ? ` ${raise.next?.name ?? ''} at ${next}.`
            : ' Top of the ladder.'}
        </Text>

        <Pressable
          onPress={() => {
            setRaise(null);
            api.play();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>Keep going</Text>
        </Pressable>
        {onGoToProgress && (
          <Pressable
            onPress={() => {
              setRaise(null);
              onGoToProgress();
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.later, pressed && styles.pressed]}
          >
            <Text style={styles.laterText}>See the ladder</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,13,11,0.86)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  card: {
    alignItems: 'center',
    backgroundColor: '#141a17',
    borderColor: 'rgba(87,179,242,0.4)',
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    width: '100%',
  },
  art: { height: 96, marginBottom: 10, width: 86 },
  eyebrow: { color: '#57b3f2', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  gloss: { color: 'rgba(242,245,243,0.45)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  tier: {
    color: '#f2f5f3',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 14,
    textAlign: 'center',
  },
  meaning: { color: 'rgba(242,245,243,0.6)', fontSize: 14, marginTop: 2 },
  body: {
    color: 'rgba(242,245,243,0.8)',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 14,
    textAlign: 'center',
  },
  cta: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#57b3f2',
    borderRadius: 14,
    marginTop: 20,
    paddingVertical: 13,
  },
  ctaText: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  later: { alignItems: 'center', marginTop: 4, paddingVertical: 12 },
  laterText: { color: 'rgba(242,245,243,0.55)', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
