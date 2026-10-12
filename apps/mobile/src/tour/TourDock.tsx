import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { BRAND } from '../onboarding/brand';
import { ACCENT, MUTED, ON_ACCENT, TEXT } from '../onboarding/chrome';
import { TOUR_STAGE, skipTour, useTourLine, type TourLine, type TourStep } from './tour';

/**
 * LORO'S DOCK — where the whole walkthrough talks from (Radek, 2026-10-12:
 * the floating card "appears where the English subtitles are … make up the
 * most smooth walkthrough").
 *
 * Part of the tab bar, not over anything: the feed above simply measures a
 * little shorter for the length of the tour, so no line of the video, the
 * subtitles or the translation is ever covered, on any beat. One place, one
 * voice: feed beats and Words beats alike. Each new line springs in where the
 * old one fades — inside a FIXED height, so a longer sentence never nudges
 * the layout above it.
 *
 * The Words beats carry a button (Next / ¡Vamos!) because there the user is
 * being shown, not asked to act; on the feed beats the action IS the next
 * step, so there is no button to press — only Skip, always.
 */

export const WORDS_LINES: Record<'wordsHere' | 'wordsTrain' | 'map', TourLine & { cta: string }> = {
  wordsHere: {
    key: 'wordsHere',
    title: 'Your words live here',
    body: 'Everything you save lands in your city. Blue ones are gaps you filled right.',
    cta: 'Next',
  },
  wordsTrain: {
    key: 'wordsTrain',
    title: 'Tap a word to train it',
    body: 'A few quick rounds and it’s learned. Then it pops up as a gap in videos.',
    cta: 'Next',
  },
  map: {
    key: 'map',
    title: 'This is your trip',
    body: 'Learn a city’s words and you fly to the next one.',
    cta: '¡Vamos!',
  },
};

const CONTENT_H = 62;

export function TourDock({ step, onNext }: { step: TourStep; onNext: () => void }) {
  const feedLine = useTourLine();
  const words = step === 'wordsHere' || step === 'wordsTrain' || step === 'map' ? WORDS_LINES[step] : null;
  const line = words ?? (step === 'blank' || step === 'save' || step === 'words' ? feedLine : null);
  const stage = TOUR_STAGE[step];

  return (
    <View style={styles.dock}>
      <View style={styles.top}>
        <View style={styles.dots}>
          {[1, 2, 3, 4].map((n) => (
            <View key={n} style={[styles.dot, n < stage && styles.dotDone, n === stage && styles.dotOn]} />
          ))}
        </View>
        <Pressable onPress={skipTour} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip the tour">
          <Text style={styles.skip}>Skip tour</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Image source={BRAND.parrot} style={styles.parrot} resizeMode="contain" />
        <View style={styles.textBox}>
          {line && (
            <Animated.View
              key={line.key}
              entering={FadeInDown.springify().damping(17).stiffness(200)}
              exiting={FadeOut.duration(120)}
              style={StyleSheet.absoluteFill}
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.title} numberOfLines={1}>
                {line.title}
              </Text>
              <Text style={styles.body} numberOfLines={2}>
                {line.body}
              </Text>
            </Animated.View>
          )}
        </View>
        {words && (
          <Animated.View key={`cta-${words.key}`} entering={FadeInDown.springify().damping(17).delay(80)}>
            <Pressable
              onPress={onNext}
              accessibilityRole="button"
              style={({ pressed }) => [styles.next, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.nextText}>{words.cta}</Text>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    borderBottomColor: 'rgba(242,245,243,0.08)',
    borderBottomWidth: 1,
    marginBottom: 4,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  top: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { backgroundColor: 'rgba(242,245,243,0.16)', borderRadius: 3, height: 5, width: 5 },
  dotOn: { backgroundColor: ACCENT, width: 16 },
  dotDone: { backgroundColor: 'rgba(94,230,168,0.5)' },
  skip: { color: 'rgba(242,245,243,0.45)', fontSize: 12, fontWeight: '700' },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, height: CONTENT_H },
  parrot: { height: CONTENT_H, width: 42 },
  textBox: { flex: 1, height: CONTENT_H, justifyContent: 'center' },
  title: { color: TEXT, fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2, marginTop: 6 },
  body: { color: MUTED, fontSize: 13.5, lineHeight: 18, marginTop: 2 },
  next: { backgroundColor: ACCENT, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  nextText: { color: ON_ACCENT, fontSize: 15, fontWeight: '800' },
});
