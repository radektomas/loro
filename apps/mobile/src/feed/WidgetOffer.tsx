import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { usePlayerApi } from '../player/PlayerHost';
import { track } from '../platform/analytics';
import { subscribeToWidgetOffer, type WidgetOffer as Offer } from './widgetOfferBus';

/**
 * THE LOCK SCREEN WIDGET CARD, once, after the third save (widgetOfferBus.ts).
 *
 * It shows rather than tells: a small lock screen with today's date and the
 * time, and under the clock the widget itself carrying THEIR NEXT WORD (the
 * same word the real widget will show), which settles in a beat after the card. Then three short steps for
 * adding it, because iOS lets only the user put a widget there.
 *
 * Same contract as the feed's other cards (DayDoneCard): the player is
 * paused and yielded while it is up, "Got it" and "Not now" both resume.
 * Both close it for good; the decision was latched when it was raised.
 */
const STEPS = ['Press and hold your lock screen', 'Tap Customize, then the space under the clock', 'Pick Loro'];

const IN = Easing.out(Easing.cubic);

export function WidgetOffer({ onObscurePlayer }: { onObscurePlayer: (obscured: boolean) => void }) {
  const api = usePlayerApi();
  const [offer, setOffer] = useState<Offer | null>(null);
  useEffect(() => subscribeToWidgetOffer(setOffer), []);

  const open = offer !== null;
  useEffect(() => {
    onObscurePlayer(open);
    if (open) api.pause();
    return () => onObscurePlayer(false);
  }, [open, onObscurePlayer, api]);

  if (!offer) return null;

  const close = (action: 'got_it' | 'later') => {
    track('widget_offer_closed', { action });
    setOffer(null);
    api.play();
  };

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
  const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    // Its own window, above the feed's top strip (the shelf pill, the goal
    // dots and refresh were drawn over the phone when it lived in the feed).
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => close('later')}>
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={styles.backdrop}>
      <Animated.View entering={FadeInDown.duration(420).easing(IN)} style={styles.card}>
        {/* The lock screen, drawn: their phone, their word. */}
        <View style={styles.phone}>
          <View style={[styles.glow, styles.glowA]} />
          <View style={[styles.glow, styles.glowB]} />
          <Text style={styles.date}>{date}</Text>
          <Text style={styles.time}>{time}</Text>
          <Animated.View entering={FadeInDown.delay(520).duration(480).easing(IN)} style={styles.widget}>
            <Text style={styles.widgetTag}>LORO · NEXT WORD</Text>
            <Text style={styles.widgetWord} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {offer.word}
            </Text>
            <Text style={styles.widgetMeaning} numberOfLines={1}>
              {offer.meaning}
            </Text>
          </Animated.View>
          {/* The bottom of a lock screen: torch, camera, home bar. The whole
              phone, never a cropped top (Radek: "it's just cut up"). */}
          <View style={styles.phoneFoot}>
            <View style={styles.roundKey} />
            <View style={styles.roundKey} />
          </View>
          <View style={styles.homeBar} />
        </View>

        <Animated.Text entering={FadeIn.delay(160).duration(360)} style={styles.title}>
          Your words, on your lock screen
        </Animated.Text>
        <Animated.Text entering={FadeIn.delay(220).duration(360)} style={styles.body}>
          See <Text style={styles.bodyWord}>{offer.word}</Text> every time you pick up your phone.
        </Animated.Text>

        <View style={styles.steps}>
          {STEPS.map((step, n) => (
            <Animated.View key={step} entering={FadeIn.delay(700 + n * 110).duration(320)} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{n + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </Animated.View>
          ))}
        </View>

        <Pressable
          onPress={() => close('got_it')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>Got it</Text>
        </Pressable>
        <Pressable
          onPress={() => close('later')}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [styles.later, pressed && styles.pressed]}
        >
          <Text style={styles.laterText}>Not now</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
    </Modal>
  );
}

const MINT = '#5ee6a8';
const INK = '#f2f5f3';

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,11,9,0.9)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 22,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  card: {
    alignItems: 'center',
    backgroundColor: '#121815',
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 28,
    borderWidth: 1,
    paddingBottom: 12,
    paddingHorizontal: 22,
    paddingTop: 22,
    width: '100%',
  },

  /** A whole phone, ~1:2 like the real thing, small enough to leave room for the steps. */
  phone: {
    alignItems: 'center',
    backgroundColor: '#0e2219',
    borderColor: '#2a302d',
    borderRadius: 30,
    borderWidth: 5,
    height: 286,
    overflow: 'hidden',
    paddingTop: 22,
    width: 144,
  },
  /** Two soft pools of light, a wallpaper without an image. */
  glow: { borderRadius: 999, position: 'absolute' },
  glowA: { backgroundColor: 'rgba(94,230,168,0.22)', height: 170, left: -70, top: -50, width: 170 },
  glowB: { backgroundColor: 'rgba(87,179,242,0.16)', bottom: -60, height: 190, right: -80, width: 190 },
  date: { color: 'rgba(255,255,255,0.8)', fontSize: 9.5, fontWeight: '600' },
  time: { color: '#fff', fontSize: 46, fontWeight: '300', letterSpacing: -1.2, lineHeight: 52 },
  phoneFoot: {
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 16,
    position: 'absolute',
    right: 16,
  },
  roundKey: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, height: 24, width: 24 },
  homeBar: { backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 999, bottom: 7, height: 3.5, position: 'absolute', width: 48 },
  widget: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 10,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  widgetTag: { color: 'rgba(255,255,255,0.7)', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  widgetWord: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 1 },
  widgetMeaning: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },

  title: { color: INK, fontSize: 22, fontWeight: '900', letterSpacing: -0.4, marginTop: 22, textAlign: 'center' },
  body: { color: 'rgba(242,245,243,0.65)', fontSize: 15, lineHeight: 21, marginTop: 6, textAlign: 'center' },
  bodyWord: { color: MINT, fontWeight: '800' },

  steps: { alignSelf: 'stretch', gap: 10, marginTop: 20 },
  step: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  stepNum: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderRadius: 999,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  stepNumText: { color: MINT, fontSize: 13, fontWeight: '900' },
  stepText: { color: INK, flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 19 },

  cta: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: MINT, borderRadius: 16, marginTop: 22, paddingVertical: 14 },
  ctaText: { color: '#06130d', fontSize: 16, fontWeight: '800' },
  later: { alignItems: 'center', paddingVertical: 12 },
  laterText: { color: 'rgba(242,245,243,0.5)', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
