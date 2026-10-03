import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tripStop } from '@loro/core/roadmap';
import { BRAND } from '../onboarding/brand';
import { COUNTRIES, Flag, localFor } from './countries';

/**
 * ARRIVING IN A NEW CITY (Radek, 2026-09-30: the next city is closed "and
 * then the animation to the next city open"). Played once per city, the
 * first time the Words tab sees the trip past it (VocabScreen keeps the
 * last city it celebrated in loro.mobile.tripSeen).
 *
 * The beat: the route from the city you finished to the new one, the leg
 * filling as Loro flies along it; then the new city pops with its flag and
 * hands over ITS local word (every city has one — countries.CITIES). A city
 * with no words yet says how to fill it: save, then train. One tap on.
 * It plays even when the new city is empty (Radek, 2026-09-30: after ten
 * words "it needs to do the animation even when a user doesnt have more
 * words in the next city").
 *
 * An absolute layer inside the Words screen, never a Modal — that screen
 * owns exactly one native window (see VocabScreen), and the caller only
 * shows this with that window down.
 */

const MINT = '#5ee6a8';
const INK = '#f2f5f3';

export function CityArrival({
  from,
  to,
  empty,
  onDone,
}: {
  from: number;
  to: number;
  /** Nothing saved and waiting to train in the new city. */
  empty: boolean;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const prev = tripStop(from);
  const next = tripStop(to);
  const newCountry = prev.country !== next.country;
  const info = COUNTRIES[next.country];
  const local = localFor(next.city);
  const after = tripStop(to + 1).city;

  const scrim = useRef(new Animated.Value(0)).current;
  const fly = useRef(new Animated.Value(0)).current;
  const land = useRef(new Animated.Value(0)).current;
  const gift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(scrim, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(fly, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.spring(land, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
      Animated.timing(gift, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [scrim, fly, land, gift]);

  const routeW = Math.min(width - 80, 300);
  const loroX = fly.interpolate({ inputRange: [0, 1], outputRange: [0, routeW] });
  const loroY = fly.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -26, 0] });
  const legW = fly.interpolate({ inputRange: [0, 1], outputRange: [0, routeW] });

  return (
    <Animated.View style={[styles.layer, { opacity: scrim, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      {/* The route: where you were, where you are going. */}
      <View style={[styles.route, { width: routeW + 44 }]}>
        <View style={[styles.leg, { width: routeW }]} />
        <Animated.View style={[styles.legFill, { width: legW }]} />
        <View style={[styles.pin, styles.pinFrom]} />
        <Animated.View
          style={[
            styles.pin,
            styles.pinTo,
            { left: routeW + 11, transform: [{ scale: land.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }] },
          ]}
        />
        <Animated.Image
          source={BRAND.parrotWaving}
          resizeMode="contain"
          style={[styles.loro, { transform: [{ translateX: loroX }, { translateY: loroY }] }]}
        />
        <Text style={[styles.pinName, { left: -20 }]} numberOfLines={1}>
          {prev.city}
        </Text>
        <Text style={[styles.pinName, styles.pinNameTo, { left: routeW - 20 }]} numberOfLines={1}>
          {next.city}
        </Text>
      </View>

      <Animated.View
        style={[
          styles.arrive,
          { opacity: land, transform: [{ scale: land.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
        ]}
      >
        {info && <Flag spec={info.flag} height={34} />}
        <Text style={styles.kicker}>¡LLEGASTE A</Text>
        <Text style={styles.city} numberOfLines={1} adjustsFontSizeToFit>
          {next.label}!
        </Text>
        <Text style={styles.country}>{next.country}</Text>
      </Animated.View>

      <Animated.View
        style={[
          styles.giftWrap,
          { opacity: gift, transform: [{ translateY: gift.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
        ]}
      >
        {local && (
          <View style={styles.gift}>
            <Text style={styles.giftLabel}>
              {newCountry ? 'NEW COUNTRY · ' : ''}LOCAL WORD UNLOCKED
            </Text>
            <Text style={styles.giftWord}>
              {local.word.word}
              <Text style={styles.giftMeaning}>  {local.word.meaning}</Text>
            </Text>
            <Text style={styles.giftFact}>{local.fact}</Text>
          </View>
        )}
        <Text style={styles.sub}>
          {empty
            ? `You finished ${prev.city}! Save new words in your videos, then train them here to reach ${after}.`
            : `You finished ${prev.city}. Your next words are waiting here.`}
        </Text>
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.ctaText}>¡Vamos!</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,13,11,0.97)',
    bottom: 0,
    left: 0,
    paddingHorizontal: 24,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  route: { height: 110, justifyContent: 'center', marginBottom: 20 },
  leg: {
    backgroundColor: 'rgba(242,245,243,0.12)',
    borderRadius: 2,
    height: 4,
    left: 22,
    position: 'absolute',
    top: 70,
  },
  legFill: { backgroundColor: MINT, borderRadius: 2, height: 4, left: 22, position: 'absolute', top: 70 },
  pin: {
    backgroundColor: MINT,
    borderColor: '#0a0d0b',
    borderRadius: 999,
    borderWidth: 3,
    height: 24,
    position: 'absolute',
    top: 60,
    width: 24,
  },
  pinFrom: { left: 11 },
  pinTo: { backgroundColor: INK, borderColor: MINT },
  loro: { height: 58, left: 4, position: 'absolute', top: 2, width: 42 },
  pinName: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 12,
    fontWeight: '800',
    position: 'absolute',
    textAlign: 'center',
    top: 90,
    width: 84,
  },
  pinNameTo: { color: INK },
  arrive: { alignItems: 'center', marginTop: 10 },
  kicker: { color: MINT, fontSize: 13, fontWeight: '900', letterSpacing: 1.6, marginTop: 16 },
  city: { color: INK, fontSize: 46, fontWeight: '900', letterSpacing: -1, marginTop: 2 },
  country: { color: 'rgba(242,245,243,0.6)', fontSize: 16, fontWeight: '800' },
  giftWrap: { alignSelf: 'stretch', marginTop: 'auto' },
  gift: { backgroundColor: 'rgba(94,230,168,0.1)', borderRadius: 18, padding: 16 },
  giftLabel: { color: MINT, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  giftWord: { color: INK, fontSize: 26, fontWeight: '900', marginTop: 4 },
  giftMeaning: { color: 'rgba(242,245,243,0.6)', fontSize: 15, fontWeight: '700' },
  giftFact: { color: 'rgba(242,245,243,0.7)', fontSize: 14, lineHeight: 20, marginTop: 8 },
  sub: { color: 'rgba(242,245,243,0.7)', fontSize: 16, lineHeight: 23, marginTop: 14, textAlign: 'center' },
  cta: {
    alignItems: 'center',
    backgroundColor: MINT,
    borderRadius: 16,
    marginTop: 18,
    paddingVertical: 15,
  },
  ctaText: { color: '#06130d', fontSize: 17, fontWeight: '900' },
});
