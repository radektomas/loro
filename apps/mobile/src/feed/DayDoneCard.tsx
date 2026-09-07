import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { splitFunctionWords } from '@loro/core/progress';
import { BRAND } from '../onboarding/brand';
import { usePlayerApi } from '../player/PlayerHost';
import { subscribeToDayDone, type DayDoneRaise } from './dayDone';

/**
 * THE DAY-DONE CARD — the app's first ending.
 *
 * Raised by RecallHost through dayDone.ts after the celebration for the
 * answer that completed today's goal. It says three things and stops: the
 * day is done, what today added up to (answers, streak), and the words that
 * did it. Then one button to carry on and one to go and look.
 *
 * PRESENTATION IS NotificationPrompt's SHELL — a card over a dimmed backdrop,
 * onObscurePlayer while up (the embed-terms rule: nothing floats over a
 * visible player). The player is PAUSED on the way in, not merely hidden:
 * the video resumed 600ms after the grade, and a win that plays over
 * someone else's sentence is not a moment. "Keep going" resumes it.
 *
 * THE CHIPS NAME CONTENT WORDS ONLY. "de" and "que" were real answers and
 * counted toward the goal, but on a card they read as padding; they are
 * summed into one line instead (splitFunctionWords), the same treatment the
 * Progress page gives the week.
 */
const MAX_CHIPS = 8;

export function DayDoneCard({
  onObscurePlayer,
  onGoToProgress,
}: {
  /** Raised while the card is up, so the WebView fades and the slide's poster
      carries the frame underneath — same contract as NotificationPrompt. */
  onObscurePlayer: (obscured: boolean) => void;
  onGoToProgress?: () => void;
}) {
  const api = usePlayerApi();
  const [raise, setRaise] = useState<DayDoneRaise | null>(null);

  useEffect(() => subscribeToDayDone(setRaise), []);

  const open = raise !== null;
  useEffect(() => {
    onObscurePlayer(open);
    if (open) api.pause();
    // Lower it on unmount too — a tab switch must not leave the player hidden.
    return () => onObscurePlayer(false);
  }, [open, onObscurePlayer, api]);

  if (!raise) return null;

  const { content, small } = splitFunctionWords(raise.words);
  const chips = content.slice(0, MAX_CHIPS);
  const moreContent = content.length - chips.length;
  const streakLine =
    raise.streak >= 2
      ? `${raise.streak} days in a row 🔥`
      : 'Day one of a streak. Tomorrow makes two.';

  const keepGoing = () => {
    setRaise(null);
    api.play();
  };
  const seeProgress = () => {
    setRaise(null);
    onGoToProgress?.();
  };

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
        <Text style={styles.title}>¡Día hecho!</Text>
        <Text style={styles.gloss}>day done</Text>
        <Text style={styles.body}>
          {raise.count} {raise.count === 1 ? 'word' : 'words'} right today.{' '}
          {streakLine}
        </Text>

        {(chips.length > 0 || small.length > 0) && (
          <View style={styles.chips} accessibilityLabel="Today's words">
            {chips.map((word) => (
              <View key={`${word.videoId}:${word.text}`} style={styles.chip}>
                <Text style={styles.chipText}>{word.text}</Text>
              </View>
            ))}
            {moreContent > 0 && (
              <View style={[styles.chip, styles.chipQuiet]}>
                <Text style={[styles.chipText, styles.chipTextQuiet]}>
                  +{moreContent} more
                </Text>
              </View>
            )}
            {small.length > 0 && (
              <View style={[styles.chip, styles.chipQuiet]}>
                <Text style={[styles.chipText, styles.chipTextQuiet]}>
                  +{small.length} small {small.length === 1 ? 'word' : 'words'}
                </Text>
              </View>
            )}
          </View>
        )}

        <Pressable
          onPress={keepGoing}
          accessibilityRole="button"
          accessibilityLabel="Keep going"
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>Keep going</Text>
        </Pressable>

        {onGoToProgress && (
          <Pressable
            onPress={seeProgress}
            accessibilityRole="button"
            accessibilityLabel="See my progress"
            style={({ pressed }) => [styles.later, pressed && styles.pressed]}
          >
            <Text style={styles.laterText}>See my progress</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** NotificationPrompt's backdrop verbatim: fills the feed area above the
      tab bar, opaque enough to read against the paused frame. */
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
    backgroundColor: '#141a17',
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    width: '100%',
  },
  /** The waving art is 375x420; 96pt tall keeps its ratio at ~86 wide. */
  art: { alignSelf: 'center', height: 96, marginBottom: 10, width: 86 },
  title: {
    color: '#5ee6a8',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 32,
    textAlign: 'center',
  },
  /** The gloss under the Spanish, the way a subtitle sits under a line — the
      title is doing double duty as copy and as vocabulary. */
  gloss: {
    color: 'rgba(242,245,243,0.45)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
  body: {
    color: 'rgba(242,245,243,0.8)',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 12,
    textAlign: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginTop: 14,
  },
  chip: {
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipQuiet: { backgroundColor: 'rgba(242,245,243,0.08)' },
  chipText: { color: '#5ee6a8', fontSize: 14, fontWeight: '700' },
  chipTextQuiet: { color: 'rgba(242,245,243,0.6)', fontWeight: '600' },
  cta: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 14,
    marginTop: 20,
    paddingVertical: 13,
  },
  ctaText: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  later: { alignItems: 'center', marginTop: 4, paddingVertical: 12 },
  laterText: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: { opacity: 0.7 },
});
