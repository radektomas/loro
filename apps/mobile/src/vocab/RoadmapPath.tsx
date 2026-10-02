import { useEffect, useMemo, useRef, useState } from 'react';
import { cleanWord } from '@loro/core/dictionary';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import type { SavedWord } from '@loro/core/types';
import { BRAND } from '../onboarding/brand';
import { COUNTRIES, Flag, flagColours, localFor } from './countries';
import { CITY_XY, COUNTRY_LABEL, LANDS, MAP_H as GEO_H, MAP_W as GEO_W, OCEAN_X } from './tripMapData';
import { storageDriver } from '../platform/storage';
import { storage } from '@loro/core/storage';

/** The last city the Words tab celebrated arriving in (CityArrival). */
export const TRIP_SEEN_KEY = 'loro.mobile.tripSeen';
const PIN_TAPPED_KEY = 'loro.mobile.tripPinTapped';
const PATH_INTRO_KEY = 'loro.mobile.pathIntroSeen';
import { tierForLearned } from '@loro/core/levels';
import { learnedTotal } from '../feed/wordLearned';
import {
  buildRoadmap,
  OPEN_SLOTS,
  STAGE_SIZE,
  TRIP,
  tripStop,
  withLevelKnown,
  type RoadmapNode,
} from '@loro/core/roadmap';

/**
 * THE PATH — the Words tab as a road, in the order the words were saved
 * (Radek, 2026-09-26, branch words-roadmap: "a roadmap based of when did he
 * save the word, a bit like duolingo the levels but with words, and
 * everytime you learn a word you unlock a new [one]").
 *
 * Third pass, after seeing the second on device ("the design looks cool as
 * hell" but "still chaotic"). What calmed it:
 *   - ONE accent. Mint is learned; the current word is the only bright coin;
 *     open words are dark with mint pips; locked words are grey. The gold
 *     "done" colour and the per-word coloured chips are gone.
 *   - TWO LINES per word: the word, then "meaning · N writes left". The save
 *     date lives on the stage heading, where it is one line for ten words.
 *   - FOLDING. A finished stage is one line; the stages past the next one
 *     fold into a single "N more stages" line. Only the stage you are in and
 *     the next are drawn in full; any fold opens on a tap.
 *
 * The rule lives in core (roadmap.ts): OPEN_SLOTS words are open, learning
 * one opens the next saved word, the rest wait — and waiting words are not
 * asked in the feed or counted as ready. This file only draws it.
 */

const MINT = '#5ee6a8';
/** Known from a blue blank in the feed — the feed's own level blue. */
const BLUE = '#57b3f2';
const INK = '#f2f5f3';
const MUTED = 'rgba(242,245,243,0.5)';
const FAINT = 'rgba(242,245,243,0.3)';

/** Face + lip per coin: the lip is the coin's thickness, drawn under it. */
const COIN = {
  done: { face: MINT, lip: '#2a9e6d' },
  blue: { face: BLUE, lip: '#2b79ad' },
  // The word you are on is WHITE, never mint: mint means learned, and the
  // two must not be confused at a glance (Radek: "make the learned and
  // learning words more distinct").
  here: { face: INK, lip: '#aab4af' },
  open: { face: '#1d2b25', lip: '#121c18' },
  locked: { face: '#232a27', lip: '#171d1a' },
} as const;

const COIN_W = 70;
const COIN_H = 58;
const LIP = 6;
const ROW_H = 84;
/** The current coin carries a halo and a tag above it. */
const HERE_ROW_H = 132;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function savedRange(nodes: RoadmapNode[]): string {
  // Learned words are drawn in the order they were learned, so a stage's
  // save dates are its earliest and latest, not its first and last node.
  const times = nodes.map((n) => n.savedAt);
  const a = shortDate(Math.min(...times));
  const b = shortDate(Math.max(...times));
  return a === b ? `saved ${a}` : `saved ${a} – ${b}`;
}

/** A padlock from two shapes — the app does not use emoji. */
function Lock() {
  return (
    <View style={styles.lock}>
      <View style={styles.lockShackle} />
      <View style={styles.lockBody} />
    </View>
  );
}

/** "Tap to train": a play mark drawn from borders (no emoji, no font glyph). */
function Play({ onMint }: { onMint: boolean }) {
  return (
    <View
      style={[
        styles.play,
        { borderLeftColor: onMint ? '#06130d' : MINT },
      ]}
    />
  );
}

/**
 * LORO ON THE PATH, like Duo beside his. He stands in the empty half of the
 * road inside the stage you are on, bobbing, with one line about what to do
 * next. Two poses exist (standing, waving); the waving one closes the path.
 */
function Mascot({
  side,
  line,
  waving = false,
}: {
  side: 'left' | 'right';
  line: React.ReactNode;
  waving?: boolean;
}) {
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -7] });
  return (
    <View style={[styles.mascotRow, { flexDirection: side === 'left' ? 'row' : 'row-reverse' }]}>
      <Animated.Image
        source={waving ? BRAND.parrotWaving : BRAND.parrot}
        style={[waving ? styles.mascotWaving : styles.mascot, { transform: [{ translateY }, { scaleX: side === 'left' ? 1 : -1 }] }]}
        resizeMode="contain"
      />
      <View style={[styles.bubble, side === 'left' ? styles.bubbleLeft : styles.bubbleRight]}>
        <Text style={styles.bubbleText}>{line}</Text>
      </View>
    </View>
  );
}

function Coin({ node, here, blue }: { node: RoadmapNode; here: boolean; blue?: boolean }) {
  const c = COIN[here ? 'here' : blue ? 'blue' : node.status];
  return (
    <View style={{ width: COIN_W, height: COIN_H + LIP }}>
      <View style={[styles.coinLayer, { top: LIP, backgroundColor: c.lip }]} />
      <View
        style={[
          styles.coinLayer,
          styles.coinFace,
          { top: 0, backgroundColor: c.face },
          node.status === 'open' && !here && styles.coinOpenRing,
        ]}
      >
        {node.status === 'done' && <Text style={styles.check}>✓</Text>}
        {node.status === 'open' && <Play onMint={here} />}
        {node.status === 'locked' && <Lock />}
      </View>
    </View>
  );
}

/**
 * THE MAP (Radek, 2026-09-30: "make it like a little map", then "the shapes
 * and places of cities ... like on a real map", then — not the whole earth —
 * "swipe right and see one after another how the countries and cities in
 * them go"). The trip's countries side by side in trip order, each from its
 * real outline at its own scale with its cities at their real positions
 * (tripMapData.ts, generated by scripts/build-trip-map.mts from Natural
 * Earth). One SVG chart under the pins; pins, names and Loro are Views on
 * top so they stay crisp and tappable. It opens on your city.
 */
const PANEL_H = GEO_H;
/** Map ink: the sea, the land, the coast. */
const SEA_TOP = '#0f1b17';
const SEA_BOTTOM = '#08100d';
const LAND = '#1a2621';
const LAND_AHEAD = '#131c18';
const LAND_SHADOW = '#040806';
const SEA_INK = 'rgba(87,179,242,0.5)';
/** The pin's touch box; the pin sits in its middle. */
const PIN_BOX = 44;

type Pt = { x: number; y: number };
type Cubic = [Pt, Pt, Pt, Pt];

/**
 * A leg as a flight path: a gentle arc bowed to the left of the direction
 * of travel (the way right bows up). The Atlantic crossing bows hard.
 */
function flightCurve(a: Pt, b: Pt, ocean: boolean): Cubic {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = ocean ? len * 0.2 : Math.min(len * 0.12, 60);
  const nx = (dy / len) * bend;
  const ny = (-dx / len) * bend;
  return [
    a,
    { x: a.x + dx * 0.25 + nx, y: a.y + dy * 0.25 + ny },
    { x: a.x + dx * 0.75 + nx, y: a.y + dy * 0.75 + ny },
    b,
  ];
}

function curveD([a, c1, c2, b]: Cubic): string {
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** Length of a cubic, by sampling — for filling the current leg part-way. */
function curveLength([a, c1, c2, b]: Cubic): number {
  let len = 0;
  let prev = a;
  for (let k = 1; k <= 24; k++) {
    const t = k / 24;
    const u = 1 - t;
    const p = {
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    };
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

/** The compass rose, fixed in the panel's corner: north in mint. */
function Compass() {
  const x = 30;
  const y = 34;
  const r = 16;
  return (
    <Svg width={60} height={66} style={styles.compass} pointerEvents="none">
      <Circle cx={x} cy={y} r={r + 5} fill="rgba(8,16,13,0.6)" stroke="rgba(242,245,243,0.1)" strokeWidth={1} />
      <Circle cx={x} cy={y} r={r} fill="none" stroke="rgba(242,245,243,0.14)" strokeWidth={1} strokeDasharray="1 3" />
      <Path d={`M${x} ${y - r} L${x + 4} ${y} L${x} ${y + r} L${x - 4} ${y} Z`} fill="rgba(242,245,243,0.2)" />
      <Path d={`M${x - r} ${y} L${x} ${y - 4} L${x + r} ${y} L${x} ${y + 4} Z`} fill="rgba(242,245,243,0.12)" />
      <Path d={`M${x} ${y - r} L${x + 4} ${y} L${x - 4} ${y} Z`} fill={MINT} />
      <SvgText x={x} y={9} fill={MINT} fontSize={9} fontWeight="900" textAnchor="middle">
        N
      </SvgText>
    </Svg>
  );
}

type CityState = 'done' | 'here' | 'ahead';

function TripMap({
  current,
  leftHere,
  stageLen,
  stages,
  onPractise,
  blue,
}: {
  /** Blue stops (known from blue blanks) — their chips are drawn blue. */
  blue?: ReadonlySet<string>;
  /** The stages themselves, so a tapped city can list what was learned there. */
  stages: RoadmapNode[][];
  /** A learned word tapped in a city's panel: practise it. */
  onPractise: (word: SavedWord) => void;
  stops: number;
  current: number;
  leftHere: number;
  /** Words in the current stage — the last one can be short of STAGE_SIZE. */
  stageLen: number;
}) {
  const scroll = useRef<ScrollView>(null);
  const { width: screenW } = useWindowDimensions();
  const panelW = screenW - 24;
  const N = TRIP.length;
  const here = Math.max(0, current);
  /**
   * PAST CARACAS the trip starts again ("Madrid · round 2"): the map is the
   * same thirty cities, and a city behind you this round was already
   * finished in the last one.
   */
  const round = Math.floor(here / N);
  const hereCity = here % N;
  const stateOf = (j: number): CityState =>
    j < hereCity ? 'done' : j === hereCity ? 'here' : round > 0 ? 'done' : 'ahead';
  /** The stage whose words a city holds: this round's, or last round's. */
  const stageOf = (j: number) => (j <= hereCity ? round * N + j : round > 0 ? (round - 1) * N + j : j);
  const xy = (j: number) => CITY_XY[TRIP[j].city];
  const learnedHere = Math.max(0, stageLen - leftHere);

  const reachedCountries = useMemo(() => {
    const got = new Set<string>();
    TRIP.forEach((t, j) => {
      if (j <= hereCity || round > 0) got.add(t.country);
    });
    return got;
  }, [hereCity, round]);

  /**
   * OPEN ON YOUR CITY, a little below the middle so Loro above the pin fits.
   * Set as the initial contentOffset and re-applied once the content has a
   * size (an early scrollTo lands before it and the map sat at the corner).
   */
  const focus = useMemo(() => {
    const c = xy(hereCity);
    return { x: Math.max(0, Math.min(GEO_W - panelW, c.x - panelW / 2)), y: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hereCity, panelW]);
  const centre = (animated = false) => scroll.current?.scrollTo({ ...focus, animated });
  useEffect(() => {
    centre();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  /** Dragged away from your city: a pill brings the map back. */
  const [away, setAway] = useState(false);

  const ring = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    const hop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    pulse.start();
    hop.start();
    return () => {
      pulse.stop();
      hop.stop();
    };
  }, [ring, bob]);

  /**
   * THE COUNTRY CARD under the map: tap a country's name to open it. A
   * country is REACHED once the trip has arrived at its first city; before
   * that its local word is hidden, which is the point — something to get.
   */
  const [picked, setPicked] = useState<string | null>(null);
  /** A tapped city pin: its words. One panel at a time. */
  const [pickedCity, setPickedCity] = useState<number | null>(null);
  /** "Tap" on your city's pin until a pin has been opened once, ever. */
  const [nudge, setNudge] = useState(() => {
    try {
      return storageDriver.local.getItem(PIN_TAPPED_KEY) === null;
    } catch {
      return false;
    }
  });

  const legs = useMemo(
    () =>
      TRIP.slice(1).map((t, i) =>
        flightCurve(xy(i), xy(i + 1), TRIP[i].country === 'España' && t.country !== 'España')
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  /** Leg k flies into city k+1. */
  const flown = legs.filter((_, k) => round > 0 || k + 1 <= hereCity);
  const partial = round === 0 && hereCity + 1 < N && learnedHere > 0 ? legs[hereCity] : null;

  const pickedFirst = picked ? TRIP.findIndex((t) => t.country === picked) : -1;

  return (
    <View style={styles.trip}>
      <View style={[styles.mapPanel, { height: PANEL_H }]}>
        <ScrollView
          ref={scroll}
          horizontal
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{ width: GEO_W, height: GEO_H }}
          contentOffset={focus}
          onContentSizeChange={() => centre()}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={200}
          onScroll={(e) => {
            const off = Math.abs(e.nativeEvent.contentOffset.x - focus.x) > panelW * 0.75;
            if (off !== away) setAway(off);
          }}
        >
          <View style={{ width: GEO_W, height: GEO_H }}>
            {/* THE CHART: sea, grid, the printed lines, the land (tinted with
                the flag once you have been there), and the route. */}
            <Svg width={GEO_W} height={GEO_H} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Defs>
                <LinearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={SEA_TOP} />
                  <Stop offset="1" stopColor={SEA_BOTTOM} />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={GEO_W} height={GEO_H} fill="url(#sea)" />
              {Array.from({ length: Math.ceil(GEO_W / 160) }, (_, k) => (
                <Line key={`m${k}`} x1={80 + k * 160} y1={0} x2={80 + k * 160} y2={GEO_H} stroke="rgba(242,245,243,0.035)" strokeWidth={1} />
              ))}
              {[GEO_H / 4, GEO_H / 2, (GEO_H * 3) / 4].map((y) => (
                <Line key={`p${y}`} x1={0} y1={y} x2={GEO_W} y2={y} stroke="rgba(242,245,243,0.035)" strokeWidth={1} />
              ))}
              {Array.from({ length: Math.floor(GEO_W / 70) }, (_, k) => {
                const x = 20 + k * 70 + ((k * 37) % 23);
                const y = 20 + ((k * 97) % (GEO_H - 40));
                return (
                  <Path
                    key={`w${k}`}
                    d={`M${x} ${y} q4 -3.5 8 0 q4 3.5 8 0`}
                    stroke="rgba(87,179,242,0.2)"
                    strokeWidth={1.2}
                    strokeLinecap="round"
                    fill="none"
                  />
                );
              })}

              {LANDS.map((land, k) => {
                const got = reachedCountries.has(land.country);
                const on = picked === land.country;
                const [a] = flagColours(land.country);
                return (
                  <G key={`land${k}`}>
                    <Path d={land.d} fill="none" stroke="rgba(87,179,242,0.06)" strokeWidth={8} strokeLinejoin="round" />
                    <Path d={land.d} fill={LAND_SHADOW} translateY={3} />
                    <Path d={land.d} fill={got ? LAND : LAND_AHEAD} />
                    {got && <Path d={land.d} fill={a} fillOpacity={0.16} />}
                    <Path
                      d={land.d}
                      fill="none"
                      stroke={on ? MINT : got ? a : 'rgba(242,245,243,0.16)'}
                      strokeOpacity={on ? 0.95 : got ? 0.6 : 1}
                      strokeWidth={on ? 2 : 1}
                      strokeLinejoin="round"
                    />
                  </G>
                );
              })}

              <SvgText
                x={OCEAN_X}
                y={GEO_H / 2 + 40}
                fill={SEA_INK}
                fontSize={11}
                fontStyle="italic"
                fontWeight="700"
                letterSpacing={3}
                textAnchor="middle"
              >
                OCÉANO ATLÁNTICO
              </SvgText>

              {legs.map((leg, k) => (
                <Path
                  key={`ahead${k}`}
                  d={curveD(leg)}
                  fill="none"
                  stroke="rgba(242,245,243,0.3)"
                  strokeWidth={2}
                  strokeDasharray="0.1 7"
                  strokeLinecap="round"
                />
              ))}
              {flown.map((leg, k) => (
                <G key={`flown${k}`}>
                  <Path d={curveD(leg)} fill="none" stroke={MINT} strokeOpacity={0.16} strokeWidth={9} strokeLinecap="round" />
                  <Path d={curveD(leg)} fill="none" stroke={MINT} strokeWidth={3} strokeLinecap="round" />
                </G>
              ))}
              {partial &&
                (() => {
                  const len = curveLength(partial);
                  const dash = `${(len * Math.min(1, learnedHere / Math.max(1, stageLen))).toFixed(1)} ${len.toFixed(1)}`;
                  return (
                    <G>
                      <Path d={curveD(partial)} fill="none" stroke={MINT} strokeOpacity={0.16} strokeWidth={9} strokeLinecap="round" strokeDasharray={dash} />
                      <Path d={curveD(partial)} fill="none" stroke={MINT} strokeWidth={3} strokeLinecap="round" strokeDasharray={dash} />
                    </G>
                  );
                })()}
            </Svg>

            {/* Country names, printed-map style; tap one for its card. */}
            {Object.entries(COUNTRY_LABEL).map(([country, [x, y]]) => {
              const got = reachedCountries.has(country);
              const info = COUNTRIES[country];
              return (
                <Pressable
                  key={country}
                  hitSlop={6}
                  onPress={() => {
                    setPickedCity(null);
                    setPicked((p) => (p === country ? null : country));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${country}${got ? '' : ', not reached yet'}`}
                  style={[styles.countryLabel, { left: x - 90, top: y - 9 }]}
                >
                  {info && got && <Flag spec={info.flag} height={9} />}
                  <Text style={[styles.landName, got && styles.landNameGot]} numberOfLines={1}>
                    {country.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}

            {TRIP.map((t, j) => {
              const c = xy(j);
              const state = stateOf(j);
              const stage = stages[stageOf(j)];
              const learned = state === 'ahead' ? 0 : (stage?.filter((n) => n.status === 'done').length ?? 0);
              const label = round > 0 && j <= hereCity ? tripStop(round * N + j).label : t.city;
              return (
                <Pressable
                  key={t.city}
                  hitSlop={4}
                  onPress={() => {
                    setPicked(null);
                    setPickedCity((q) => (q === j ? null : j));
                    if (nudge) {
                      setNudge(false);
                      try {
                        storageDriver.local.setItem(PIN_TAPPED_KEY, '1');
                      } catch {}
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.city}${state === 'ahead' ? ', closed' : ''}`}
                  style={[styles.pinBox, { left: c.x - PIN_BOX / 2, top: c.y - PIN_BOX / 2 }]}
                >
                  {state === 'here' && (
                    <>
                      <Animated.View
                        style={[
                          styles.pulse,
                          {
                            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
                          },
                        ]}
                      />
                      <Animated.Image
                        source={BRAND.parrot}
                        resizeMode="contain"
                        style={[
                          styles.mapLoro,
                          { transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] },
                        ]}
                      />
                    </>
                  )}
                  <View style={[styles.pin, state === 'done' && styles.pinDone, state === 'here' && styles.pinHere]}>
                    {state === 'done' && <Text style={styles.pinCheck}>✓</Text>}
                    {state === 'ahead' && <View style={styles.pinLock} />}
                  </View>
                  {/* What is inside: the words learned there, as a badge. */}
                  {learned > 0 && (
                    <View style={styles.pinCount}>
                      <Text style={styles.pinCountText}>{learned}</Text>
                    </View>
                  )}
                  {state === 'here' && nudge && (
                    <View style={styles.tapNudge}>
                      <Text style={styles.tapNudgeText}>TAP</Text>
                    </View>
                  )}
                  <View
                    pointerEvents="none"
                    style={[
                      styles.cityLabel,
                      c.side === 'left' && styles.cityLabelLeft,
                      c.side === 'right' && styles.cityLabelRight,
                      c.side === 'above' && styles.cityLabelAbove,
                      c.side === 'below' && styles.cityLabelBelow,
                    ]}
                  >
                    <View style={[styles.cityTag, state === 'here' && styles.cityTagHere]}>
                      <Text
                        style={[
                          styles.cityName,
                          state === 'done' && styles.cityNameDone,
                          state === 'here' && styles.cityNameHere,
                          state === 'ahead' && styles.cityNameAhead,
                        ]}
                        numberOfLines={1}
                      >
                        {label}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <Compass />
        {away && (
          <Pressable
            onPress={() => {
              centre(true);
              setAway(false);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.recenter, pressed && styles.pressed]}
          >
            <Text style={styles.recenterText}>Back to {TRIP[hereCity].city}</Text>
          </Pressable>
        )}
      </View>
      {pickedCity !== null && (
        <CityWords
          stopIndex={stageOf(pickedCity)}
          nodes={stateOf(pickedCity) === 'ahead' ? [] : (stages[stageOf(pickedCity)] ?? [])}
          open={stateOf(pickedCity) !== 'ahead'}
          here={stateOf(pickedCity) === 'here'}
          blocker={TRIP[hereCity].city}
          onPractise={onPractise}
          blue={blue}
        />
      )}
      {picked && pickedFirst >= 0 && COUNTRIES[picked] && (
        <CountryCard country={picked} reached={reachedCountries.has(picked)} firstCity={TRIP[pickedFirst].city} />
      )}
      <Text style={styles.tripHow}>Swipe to see the whole trip. Tap a city to see its words.</Text>
    </View>
  );
}

/**
 * A CITY'S WORDS, opened from its pin: what was learned there, as chips.
 * A city ahead is closed until the one you are in is finished.
 */
function CityWords({
  stopIndex,
  nodes,
  open,
  here,
  blocker,
  onPractise,
  blue,
}: {
  onPractise: (word: SavedWord) => void;
  blue?: ReadonlySet<string>;
  stopIndex: number;
  nodes: RoadmapNode[];
  open: boolean;
  here: boolean;
  blocker: string;
}) {
  const stop = tripStop(stopIndex);
  const info = COUNTRIES[stop.country];
  const learned = nodes.filter((n) => n.status === 'done');
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 120, useNativeDriver: true }).start();
  }, [stopIndex, pop]);
  return (
    <Animated.View
      style={[
        styles.countryCard,
        { opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
      ]}
    >
      <View style={styles.countryHead}>
        {info && <Flag spec={info.flag} height={22} muted={!open} />}
        <View style={styles.countryHeadText}>
          <Text style={styles.countryName}>{stop.label}</Text>
          <Text style={styles.countryStatus}>
            {!open
              ? `Closed · finish ${blocker} to open`
              : here
                ? `You're here · ${learned.length} of ${nodes.length} learned`
                : `${learned.length} words learned here`}
          </Text>
        </View>
      </View>
      {open && learned.length > 0 && (
        <>
          <Text style={styles.chipsHint}>Tap a word to practise it again.</Text>
          <View style={styles.chips}>
            {learned.map((n) => (
              <Pressable
                key={n.key}
                onPress={() => onPractise(n.word)}
                accessibilityRole="button"
                accessibilityLabel={`Practise ${cleanWord(n.word.text)}, ${n.word.translation}`}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              >
                <View style={styles.chipTop}>
                  <Text style={[styles.chipWord, blue?.has(n.key) && styles.chipWordBlue]}>{cleanWord(n.word.text)}</Text>
                  <View style={styles.chipPlay} />
                </View>
                <Text style={styles.chipMeaning} numberOfLines={1}>{n.word.translation}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {open && learned.length === 0 && <Text style={styles.countryFact}>Nothing learned here yet.</Text>}
    </Animated.View>
  );
}

/** What a country gives you: its flag, a local word, one fact — or the promise of them. */
function CountryCard({ country, reached, firstCity }: { country: string; reached: boolean; firstCity: string }) {
  const info = COUNTRIES[country];
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 120, useNativeDriver: true }).start();
  }, [country, pop]);
  return (
    <Animated.View
      style={[
        styles.countryCard,
        {
          opacity: pop,
          transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      <View style={styles.countryHead}>
        <Flag spec={info.flag} height={26} muted={!reached} />
        <View style={styles.countryHeadText}>
          <Text style={styles.countryName}>{country}</Text>
          <Text style={styles.countryStatus}>{reached ? 'Unlocked' : `Reach ${firstCity} to unlock`}</Text>
        </View>
      </View>
      <View style={styles.localWord}>
        <Text style={styles.localLabel}>LOCAL WORD</Text>
        {reached ? (
          <Text style={styles.localWordText}>
            {info.word}
            <Text style={styles.localMeaning}>  {info.meaning}</Text>
          </Text>
        ) : (
          <Text style={[styles.localWordText, styles.localHidden]}>{'?'.repeat(Math.max(4, info.word.length))}</Text>
        )}
      </View>
      {reached && <Text style={styles.countryFact}>{info.fact}</Text>}
    </Animated.View>
  );
}

/** Two main colours of a country's flag, skipping white. */

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * The page's mood: a wash of the flag's colours from the top, fading to the
 * ground in stacked bands (no gradient module in this app), with two soft
 * pools of light — the onboarding's Glow technique, in the country's hues.
 */
function CityWash({ country }: { country: string }) {
  const { width } = useWindowDimensions();
  const [a, b] = flagColours(country);
  const BANDS = 28;
  const H = 440;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [country, fade]);
  const pool = (colour: string, size: number, x: number, y: number) =>
    [1, 0.78, 0.58, 0.4, 0.25].map((r, i) => (
      <View
        key={`${colour}${x}${i}`}
        style={{
          backgroundColor: hexA(colour, 0.05),
          borderRadius: 999,
          height: size * r,
          left: x + (size * (1 - r)) / 2,
          position: 'absolute',
          top: y + (size * (1 - r)) / 2,
          width: size * r,
        }}
      />
    ));
  return (
    <Animated.View pointerEvents="none" style={[styles.wash, { width, height: H, opacity: fade }]}>
      {Array.from({ length: BANDS }, (_, i) => (
        <View
          key={i}
          style={{ backgroundColor: hexA(a, 0.14 * Math.pow(1 - i / BANDS, 2)), height: H / BANDS }}
        />
      ))}
      {pool(a, width * 0.9, -width * 0.25, -width * 0.3)}
      {pool(b, width * 0.8, width * 0.45, -width * 0.15)}
    </Animated.View>
  );
}

/**
 * A POSTCARD FROM THE CITY, standing in the empty half of the road like
 * Loro does: a welcome sign with the flag, or the country's local word and
 * its fact (the same COUNTRIES the map unlocks — you are here, so it is
 * yours). Tilted a few degrees, so the path reads as a trip, not a list.
 */
function Postcard({
  kind,
  stop,
  side,
}: {
  kind: 'welcome' | 'word';
  stop: { city: string; country: string };
  side: 'left' | 'right';
}) {
  const info = COUNTRIES[stop.country];
  if (!info) return null;
  const tilt = side === 'left' ? '-4deg' : '3deg';
  const [a, b] = flagColours(stop.country);
  const row = [styles.postRow, { justifyContent: side === 'left' ? 'flex-start' : 'flex-end' } as const];

  if (kind === 'welcome') {
    // A REAL POSTCARD: paper, an airmail edge in the flag's colours, a
    // stamp with the flag and a postmark over it.
    const edge = (
      <View style={styles.airmail}>
        {Array.from({ length: 14 }, (_, i) => (
          <View key={i} style={[styles.airmailStripe, { backgroundColor: i % 2 === 0 ? a : b }]} />
        ))}
      </View>
    );
    return (
      <View style={row}>
        <View style={[styles.postcard, { transform: [{ rotate: tilt }] }]}>
          {edge}
          <View style={styles.postcardBody}>
            <View style={styles.stamp}>
              <Flag spec={info.flag} height={16} />
            </View>
            <View style={styles.postmark}>
              <Text style={styles.postmarkText} numberOfLines={1}>
                {stop.city.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.postHello}>¡Bienvenido a</Text>
            <Text style={styles.postCity} numberOfLines={1} adjustsFontSizeToFit>
              {stop.city}!
            </Text>
            <Text style={styles.postCountry}>{stop.country.toUpperCase()}</Text>
          </View>
          {edge}
        </View>
      </View>
    );
  }

  // A TAPED NOTE: a band in the country's colour, the CITY's word and fact
  // (every city has its own — CITIES — so no two stops read the same).
  const local = localFor(stop.city, stop.country) ?? info;
  return (
    <View style={row}>
      <View style={[styles.note, { transform: [{ rotate: tilt }] }]}>
        <View style={styles.tape} />
        <View style={[styles.noteBand, { backgroundColor: a }]}>
          <Flag spec={info.flag} height={12} />
          <Text style={styles.noteBandText}>LOCAL WORD</Text>
        </View>
        <View style={styles.noteBody}>
          <Text style={styles.noteWord}>{local.word}</Text>
          <Text style={styles.noteMeaning}>{local.meaning}</Text>
          <Text style={styles.noteFact} numberOfLines={4}>
            {local.fact}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * THE TRIP BEFORE THE FIRST WORD (Radek, 2026-09-30: "how a user with zero
 * words will see it"). Not an empty list: the map with Madrid waiting, the
 * same city sign the path uses, Loro, and the one thing to do.
 */
export function TripPreview({ onGoToFeed }: { onGoToFeed: () => void }) {
  const info = COUNTRIES['España'];
  return (
    <View style={styles.preview}>
      <TripMap stages={[[]]} stops={1} current={0} leftHere={STAGE_SIZE} stageLen={STAGE_SIZE} onPractise={() => {}} />
      <View style={styles.sign}>
        <View style={styles.signTop}>
          {info && <Flag spec={info.flag} height={26} />}
          <View style={styles.signName}>
            <Text style={styles.signCity}>Madrid</Text>
            <Text style={styles.signCountry}>España · your first stop</Text>
          </View>
          <Text style={styles.signCount}>
            0<Text style={styles.signCountOf}>/{STAGE_SIZE}</Text>
          </Text>
        </View>
        <View style={styles.signTrack} />
        <Text style={styles.signNext}>10 words to Sevilla</Text>
      </View>
      <Postcard kind="welcome" stop={tripStop(0)} side="right" />
      <Mascot side="left" line="¡Hola! Tap a word you don’t know in any video. It lands here, and our trip begins!" />
      <Pressable
        onPress={onGoToFeed}
        accessibilityRole="button"
        style={({ pressed }) => [styles.previewCta, pressed && styles.pressed]}
      >
        <Text style={styles.previewCtaText}>Find my first word</Text>
      </Pressable>
    </View>
  );
}

function Row({
  node,
  index,
  here,
  width,
  onOpen,
  onLongPress,
  onHereLayout,
  blue,
  disabled,
}: {
  /** A word in a closed city: drawn, not pressable. */
  disabled?: boolean;
  node: RoadmapNode;
  index: number;
  here: boolean;
  /** Known from a blue blank in the feed, not trained here. */
  blue?: boolean;
  width: number;
  onOpen: () => void;
  onLongPress: () => void;
  onHereLayout?: (y: number) => void;
}) {
  const swing = Math.min(70, width * 0.18);
  const offset = Math.sin(index * 0.9) * swing;
  const coinLeft = width / 2 + offset - COIN_W / 2;
  const height = here ? HERE_ROW_H : ROW_H;
  const coinTop = here ? 52 : 10;
  // The words take the wider side of the road.
  const labelLeft = offset >= 0;
  const gap = here ? 26 : 16;
  const labelBox = labelLeft
    ? { left: 0, width: Math.max(90, coinLeft - gap) }
    : { left: coinLeft + COIN_W + gap, right: 0 };
  const align = labelLeft ? ('right' as const) : ('left' as const);

  const { word, status } = node;
  const detail =
    status === 'done'
      ? `${word.translation} · ${blue ? '✓ knew it' : '✓ learned'}`
      : status === 'open'
        ? `${word.translation} · ${word.state === 'lapsed' ? 'train again' : 'tap to train'}`
        : null;
  const a11y =
    status === 'locked'
      ? `${cleanWord(word.text)}. Waiting.`
      : `${cleanWord(word.text)}, ${detail}. Saved ${shortDate(node.savedAt)}.`;

  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint='Train this word. Long press for its card.'
      style={({ pressed }) => [{ height }, pressed && styles.pressed]}
      onLayout={here && onHereLayout ? (e) => onHereLayout(e.nativeEvent.layout.y) : undefined}
    >
      {here && (
        <View style={[styles.hereTag, { left: coinLeft + COIN_W / 2 - 48 }]}>
          <Text style={styles.hereText}>YOU'RE HERE</Text>
          <View style={styles.hereTail} />
        </View>
      )}
      <View style={{ position: 'absolute', top: coinTop, left: coinLeft }}>
        {here && <View style={styles.halo} />}
        <Coin node={node} here={here} blue={blue} />
      </View>
      <View style={[styles.label, labelBox, { top: coinTop + 10 }]}>
        <Text
          style={[
            styles.labelWord,
            status === 'locked' && styles.labelWordLocked,
            status === 'done' && (blue ? styles.labelWordBlue : styles.labelWordDone),
            { textAlign: align },
          ]}
          numberOfLines={1}
        >
          {cleanWord(word.text)}
        </Text>
        {detail !== null && (
          <Text style={[styles.labelDetail, { textAlign: align }]} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/** A folded stage (finished) or a folded run of stages (far ahead): one line. */
function Fold({
  title,
  body,
  done,
  onPress,
}: {
  title: string;
  body: string;
  done: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Shows these words"
      style={({ pressed }) => [styles.fold, pressed && styles.pressed]}
    >
      <View style={[styles.foldMark, done ? styles.foldMarkDone : styles.foldMarkLocked]}>
        {done ? <Text style={styles.foldCheck}>✓</Text> : <Lock />}
      </View>
      <View style={styles.foldText}>
        <Text style={[styles.foldTitle, !done && styles.foldTitleLocked]}>{title}</Text>
        <Text style={styles.foldBody}>{body}</Text>
      </View>
      <Text style={styles.foldChevron}>›</Text>
    </Pressable>
  );
}

export function RoadmapPath({
  words,
  onOpen,
  onLongPress,
  onAnchor,
  onArrive,
}: {
  /** The trip has reached a city the user has not been welcomed to yet. */
  onArrive?: (from: number, to: number, empty: boolean) => void;
  words: readonly SavedWord[];
  /** Tap: train the word (the practice set). */
  onOpen: (word: SavedWord) => void;
  /** Long press: the word card: hear it, see it explained, remove it. */
  onLongPress: (word: SavedWord) => void;
  /** Y of "You're here" inside this component, once it has laid out. */
  /** The city sign's y and, when there is one, the current word's — both inside this component. */
  onAnchor: (signY: number, wordY: number | null) => void;
}) {
  const { width: screenW } = useWindowDimensions();
  // VocabScreen's scroll pads 16 each side.
  const width = screenW - 32;
  /**
   * The path includes the BLUE stops: words typed right in the feed's blue
   * blanks fill the city you are in as learned (roadmap.withLevelKnown —
   * path only; the ladder and the feed never see them). Re-read with the
   * words: a blue answer emits words-changed, which hands a new list here.
   */
  const trip = useMemo(() => withLevelKnown(words, storage.getLevelKnownWords()), [words]);
  const path = useMemo(() => buildRoadmap(trip.words), [trip]);
  const counts = useMemo(() => {
    let done = 0;
    let open = 0;
    let locked = 0;
    for (const n of path) {
      if (n.status === 'done') done++;
      else if (n.status === 'open') open++;
      else locked++;
    }
    return { done, open, locked };
  }, [path]);
  const hereNode = path.find((n) => n.status === 'open') ?? null;
  const hereKey = hereNode?.key ?? null;
  const hereWord = hereNode ? cleanWord(hereNode.word.text) : null;
  const stages = useMemo(() => {
    const out: RoadmapNode[][] = [];
    for (let i = 0; i < path.length; i += STAGE_SIZE) out.push(path.slice(i, i + STAGE_SIZE));
    return out;
  }, [path]);

  /**
   * THE CITY YOU ARE IN. The first with a word still to train; when every
   * word is learned, a FULL last city means you have arrived in the next one
   * (empty, waiting for words) and a part-filled one means you are still in
   * it. Never "the trip is over" — learning the tenth word always moves you
   * on (Radek, 2026-09-30: after ten words "the screen was super empty").
   */
  const firstOpen = stages.findIndex((nodes) => nodes.some((n) => n.status !== 'done'));
  const current =
    firstOpen >= 0
      ? firstOpen
      : stages.length === 0
        ? 0
        : stages[stages.length - 1].length >= STAGE_SIZE
          ? stages.length
          : stages.length - 1;
  /** The stages the map draws: an empty city you have just arrived in counts. */
  const mapStages = current >= stages.length ? [...stages, []] : stages;
  const cityNodes = mapStages[current] ?? [];
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  /**
   * ARRIVALS. The furthest city reached is compared with the last one the
   * Words tab celebrated; moving past it raises CityArrival once. A first
   * look (nothing stored) records where the user already is without a
   * celebration, and a trip that moved BACK (words removed) just resets.
   */
  /** The first-visit explainer: shown until "Got it", once per install. */
  const [showIntro, setShowIntro] = useState(() => {
    try {
      return storageDriver.local.getItem(PATH_INTRO_KEY) === null;
    } catch {
      return false;
    }
  });
  const dismissIntro = () => {
    setShowIntro(false);
    try {
      storageDriver.local.setItem(PATH_INTRO_KEY, '1');
    } catch {}
  };
  const reachedStage = current;
  useEffect(() => {
    if (stages.length === 0) return;
    let seen: number | null = null;
    try {
      const raw = storageDriver.local.getItem(TRIP_SEEN_KEY);
      seen = raw === null ? null : Number(raw);
    } catch {
      seen = null;
    }
    if (seen === null || Number.isNaN(seen) || reachedStage < seen) {
      try {
        storageDriver.local.setItem(TRIP_SEEN_KEY, String(reachedStage));
      } catch {}
      return;
    }
    if (reachedStage > seen) onArrive?.(seen, current, hereWord === null);
  }, [reachedStage, current, stages.length, onArrive, hereWord]);
  const [showAhead, setShowAhead] = useState(false);
  const [showVisited, setShowVisited] = useState(false);
  /** Leading stages that are fully learned — they fold into one line. */
  const visitedRun = current;
  const visitedWords = stages.slice(0, visitedRun).reduce((n, st) => n + st.length, 0);
  const expand = (s: number) => setOpened((prev) => new Set(prev).add(s));
  const lastFull = current + 1;
  const ahead = stages.slice(lastFull + 1);
  const aheadWords = ahead.reduce((n, st) => n + st.length, 0);

  // "You're here" is nested: row y inside its stage, stage y inside the path.
  const stageY = useRef(new Map<number, number>());
  const hereAt = useRef<{ stage: number; y: number } | null>(null);
  const report = () => {
    const h = hereAt.current;
    if (!h) return;
    const s = stageY.current.get(h.stage);
    // The CITY SIGN is where the tab opens (the sign and the ten words under
    // it are the view); the word's own y is passed too, for a caller that
    // asked to land on it (wordsView.requestWordFocus).
    if (s !== undefined) onAnchor(s + 150, s + h.y + HERE_ROW_H / 2);
  };

  const renderStage = (nodes: RoadmapNode[], s: number) => {
    const done = nodes.filter((n) => n.status === 'done').length;
    const allDone = done === nodes.length;
    if (allDone && nodes.length > 0 && s !== current && !opened.has(s)) {
      return (
        <Fold
          key={nodes[0].key}
          done
          title={tripStop(s).label}
          body={`All ${nodes.length} learned · ${savedRange(nodes)}`}
          onPress={() => expand(s)}
        />
      );
    }
    const isCurrent = s === current;
    const share = done / nodes.length;
    /**
     * A stage opened from a fold closes the same way (Radek: "after popping
     * up the previous stage it needs to be able to close again") — a done
     * stage folds back to its line, a stage ahead folds the whole run.
     */
    const isAhead = s > lastFull;
    const canFold = (allDone && opened.has(s)) || isAhead;
    const fold = () => {
      if (isAhead) setShowAhead(false);
      else
        setOpened((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(s);
          return nextSet;
        });
    };
    /**
     * THE CITY SIGN — the ONE place the city is named on the page (Radek,
     * 2026-09-30: "there are 2 madrid signs, make it unified ... one big
     * madrid sign"). Flag, city, country, and the honest count: a city is
     * always TEN words, however many happen to be saved in it so far.
     */
    const learned = done;
    const toNext = Math.max(0, STAGE_SIZE - learned);
    const stop = tripStop(s);
    const info = COUNTRIES[stop.country];
    return (
      <View
        key={`city-${s}`}
        style={styles.stageBlock}
        onLayout={(e) => {
          stageY.current.set(s, e.nativeEvent.layout.y);
          report();
        }}
      >
        <View style={styles.sign}>
          <View style={styles.signTop}>
            {info && <Flag spec={info.flag} height={26} />}
            <View style={styles.signName}>
              <Text style={styles.signCity} numberOfLines={1} adjustsFontSizeToFit>
                {stop.label}
              </Text>
              <Text style={styles.signCountry}>{stop.country}</Text>
            </View>
            <Text style={styles.signCount}>
              {learned}
              <Text style={styles.signCountOf}>/{STAGE_SIZE}</Text>
            </Text>
          </View>
          <View style={styles.signTrack}>
            <View style={[styles.signFill, { width: `${Math.max(3, (learned / STAGE_SIZE) * 100)}%` }]} />
          </View>
          <Text style={styles.signNext}>
            {toNext === 0
              ? `${stop.city} done!`
              : `${toNext} more ${toNext === 1 ? 'word' : 'words'} to ${tripStop(s + 1).city}`}
          </Text>
        </View>
        {nodes.map((node, i) => [
          // THE LOCAL CARDS (Radek, 2026-09-30: "I loved those local cards...
          // keep them there"): a welcome postcard early in the road.
          isCurrent && i === 1 ? (
            <Postcard
              key="welcome"
              kind="welcome"
              stop={stop}
              side={Math.sin((s * STAGE_SIZE + i + 0.5) * 0.9) >= 0 ? 'left' : 'right'}
            />
          ) : null,
          isCurrent && hereWord && i === Math.min(3, nodes.length - 1) ? (
            <Mascot
              key="loro"
              side={Math.sin((s * STAGE_SIZE + i + 0.5) * 0.9) >= 0 ? 'left' : 'right'}
              line={
                hereWord ? (
                  <>
                    Tap <Text style={styles.bubbleWord}>{hereWord}</Text> to train it!
                  </>
                ) : (
                  `${toNext} more to ${tripStop(s + 1).city}!`
                )
              }
            />
          ) : null,
          <Row
            key={node.key}
            node={node}
            index={s * STAGE_SIZE + i}
            here={node.key === hereKey}
            blue={trip.blue.has(node.key)}
            width={width}
            onOpen={() => onOpen(node.word)}
            // A blue stop is not a saved word: no card to remove it from.
            onLongPress={() => (trip.blue.has(node.key) ? onOpen : onLongPress)(node.word)}
            onHereLayout={(y) => {
              hereAt.current = { stage: s, y };
              report();
            }}
          />,
          // ...and the country's local word further down — after the 7th
          // word, or after the last one while the city is still filling up.
          isCurrent && i === Math.min(6, nodes.length - 1) ? (
            <Postcard
              key="word"
              kind="word"
              stop={stop}
              side={Math.sin((s * STAGE_SIZE + i + 1.5) * 0.9) >= 0 ? 'left' : 'right'}
            />
          ) : null,
        ])}
        {/* A CITY WITH NOTHING TO TRAIN (just arrived, or everything saved
            here is learned): the postcards and Loro still greet you, and he
            says what to do next — save more words, then train them here. */}
        {isCurrent && !hereWord && nodes.length < 2 && (
          <Postcard key="welcome-empty" kind="welcome" stop={stop} side="right" />
        )}
        {isCurrent && !hereWord && (
          <Mascot
            key="loro-empty"
            side="left"
            line={`Save new words in your videos, then train them here. ${toNext} more ${toNext === 1 ? 'word' : 'words'} and you reach ${tripStop(s + 1).city}!`}
          />
        )}
        {isCurrent && nodes.length === 0 && (
          <Postcard key="word-empty" kind="word" stop={stop} side="left" />
        )}
        {nodes.length < STAGE_SIZE && hereWord && (
          <Text style={styles.saveMore}>
            Save {STAGE_SIZE - nodes.length} more {STAGE_SIZE - nodes.length === 1 ? 'word' : 'words'} in your videos to fill {stop.city}.
          </Text>
        )}
      </View>
    );
  };

  // YOUR LEVEL IS WORDS LEARNED — the Progress page's ladder, the same
  // count (tierForLearned over learnedTotal), so the two tabs can never
  // disagree. The feed's own blank-difficulty level (storage.getLevelState)
  // shares the tier NAMES but is a different number and stays off-screen;
  // showing it here said "Nativo" beside Progress's "Se Defiende".
  const ladder = useMemo(() => tierForLearned(learnedTotal(words)), [words]);
  const tier = ladder.tier;
  const nextTier = ladder.next;
  const levelNumber = tier.level;
  const heroStop = tripStop(current);
  const heroLeft = cityNodes.filter((n) => n.status !== 'done').length;

  const learnedNow = cityNodes.filter((n) => n.status === 'done').length;
  const nextStop = tripStop(current + 1);
  const nextInfo = COUNTRIES[nextStop.country];
  const nextNodes = mapStages[current + 1] ?? [];
  const toOpen = Math.max(0, STAGE_SIZE - learnedNow);

  /**
   * THE PAGE, SIMPLE (Radek, 2026-09-30: "look at it with the eye of a new
   * user and make it super simple and fun"): the map on top, then the one
   * city sign and its words, then the next city, closed. The level lives as
   * a chip beside the tab's title (VocabScreen); the page opens on the words.
   */
  return (
    <View>
      {path.length > 0 && (
        <TripMap
          onPractise={onOpen}
          blue={trip.blue}
          stages={mapStages}
          stops={mapStages.length}
          current={current}
          leftHere={STAGE_SIZE - learnedNow}
          stageLen={STAGE_SIZE}
        />
      )}

      {renderStage(cityNodes, current)}
      {/* THE NEXT CITY, CLOSED BUT VISIBLE (Radek, 2026-09-30: "not so closed
          like that ... show also the closed words, like a closed path there,
          for the user to want to get there"). Its sign, dimmed, with a lock,
          and the user's own words waiting on a road they cannot walk yet. */}
      <View style={styles.closedCity}>
        <View style={[styles.sign, styles.signClosed]}>
          <View style={styles.signTop}>
            {nextInfo && (
              <View style={styles.closedFlag}>
                <Flag spec={nextInfo.flag} height={26} />
              </View>
            )}
            <View style={styles.signName}>
              <Text style={[styles.signCity, styles.signCityClosed]} numberOfLines={1} adjustsFontSizeToFit>
                {nextStop.label}
              </Text>
              <Text style={styles.signCountry}>{nextStop.country}</Text>
            </View>
            <View style={[styles.foldMark, styles.foldMarkLocked]}>
              <Lock />
            </View>
          </View>
          <Text style={styles.closedLine}>
            Closed · learn {toOpen} more {toOpen === 1 ? 'word' : 'words'} in {heroStop.city} to open it
          </Text>
          {nextNodes.length > 0 && (
            <Text style={styles.closedWaiting}>
              {nextNodes.length} of your {nextNodes.length === 1 ? 'word is' : 'words are'} waiting here
            </Text>
          )}
        </View>
        {nextNodes.map((node, i) => (
          <Row
            key={node.key}
            node={{ ...node, status: 'locked' }}
            index={(current + 1) * STAGE_SIZE + i}
            here={false}
            width={width}
            disabled
            onOpen={() => {}}
            onLongPress={() => {}}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  level: {
    alignItems: 'center',
    backgroundColor: '#121815',
    borderRadius: 20,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 20,
    padding: 16,
  },
  wash: { left: -16, position: 'absolute', top: -16 },
  levelLine: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 18, marginTop: 2 },
  hero: { marginBottom: 12 },
  heroLine: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  heroCity: { color: INK, flexShrink: 1, fontSize: 18, fontWeight: '900' },
  heroNext: { color: MINT, flexShrink: 1, fontSize: 13, fontWeight: '800' },
  levelBadge: {
    alignItems: 'center',
    backgroundColor: MINT,
    borderBottomColor: '#2a9e6d',
    borderBottomWidth: 4,
    borderRadius: 16,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  levelBadgeNum: { color: '#06130d', fontSize: 18, fontWeight: '900' },
  levelText: { flex: 1 },
  levelRow: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
  levelName: { color: INK, fontSize: 18, fontWeight: '900' },
  levelMeaning: { color: MUTED, flexShrink: 1, fontSize: 12 },
  levelTrack: {
    backgroundColor: 'rgba(94,230,168,0.15)',
    borderRadius: 999,
    height: 7,
    marginTop: 8,
    overflow: 'hidden',
  },
  levelFill: { backgroundColor: MINT, borderRadius: 999, height: '100%' },
  levelHint: { color: MUTED, fontSize: 11, marginTop: 6 },
  intro: {
    backgroundColor: '#121815',
    borderRadius: 20,
    marginBottom: 12,
    padding: 18,
  },
  introTitle: { color: INK, fontSize: 21, fontWeight: '900' },
  introBody: { color: 'rgba(242,245,243,0.65)', fontSize: 14, lineHeight: 20, marginTop: 4 },
  stats: { alignItems: 'baseline', flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { color: MUTED, fontSize: 13, fontWeight: '600' },
  statNum: { color: INK, fontSize: 16, fontVariant: ['tabular-nums'], fontWeight: '900' },
  statDot: { color: FAINT, fontSize: 13 },

  trip: { marginHorizontal: -16, marginTop: 8 },
  tripTitle: { color: MINT, fontSize: 11, fontWeight: '900', letterSpacing: 1.3, paddingHorizontal: 18 },
  tripYoureIn: { color: MUTED, fontSize: 15, fontWeight: '700', marginTop: 4, paddingHorizontal: 18 },
  tripCityBig: { color: INK, fontSize: 22, fontWeight: '900' },
  tripNext: { color: MINT, fontSize: 13, fontWeight: '800', marginTop: 2, paddingHorizontal: 18 },
  mapPanel: {
    backgroundColor: SEA_BOTTOM,
    borderColor: 'rgba(242,245,243,0.07)',
    borderRadius: 20,
    borderWidth: 1,
    marginHorizontal: 12,
    marginTop: 12,
    overflow: 'hidden',
  },
  compass: { left: 6, position: 'absolute', top: 4 },
  recenter: {
    backgroundColor: 'rgba(8,16,13,0.85)',
    borderColor: 'rgba(94,230,168,0.4)',
    borderRadius: 999,
    borderWidth: 1,
    bottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    position: 'absolute',
    right: 10,
  },
  recenterText: { color: MINT, fontSize: 12, fontWeight: '800' },
  countryLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    position: 'absolute',
    width: 180,
  },
  landName: {
    color: 'rgba(242,245,243,0.24)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2.4,
  },
  landNameGot: { color: 'rgba(242,245,243,0.6)' },
  countryCard: {
    backgroundColor: '#0b1210',
    borderRadius: 16,
    marginHorizontal: 12,
    marginTop: 10,
    padding: 14,
  },
  countryHead: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  countryHeadText: { flex: 1 },
  countryName: { color: INK, fontSize: 17, fontWeight: '900' },
  countryStatus: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 1 },
  localWord: { backgroundColor: 'rgba(94,230,168,0.08)', borderRadius: 12, marginTop: 12, padding: 10 },
  localLabel: { color: MINT, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  localWordText: { color: INK, fontSize: 20, fontWeight: '900', marginTop: 2 },
  localMeaning: { color: 'rgba(242,245,243,0.6)', fontSize: 14, fontWeight: '700' },
  localHidden: { color: 'rgba(242,245,243,0.25)', letterSpacing: 3 },
  countryFact: { color: 'rgba(242,245,243,0.7)', fontSize: 13, lineHeight: 19, marginTop: 10 },
  pinBox: { alignItems: 'center', height: PIN_BOX, justifyContent: 'center', position: 'absolute', width: PIN_BOX },
  cityLabel: { position: 'absolute', width: 150 },
  cityLabelLeft: { alignItems: 'flex-end', right: PIN_BOX - 8, top: PIN_BOX / 2 - 10 },
  cityLabelRight: { alignItems: 'flex-start', left: PIN_BOX - 8, top: PIN_BOX / 2 - 10 },
  cityLabelAbove: { alignItems: 'center', bottom: PIN_BOX - 8, left: PIN_BOX / 2 - 75 },
  cityLabelBelow: { alignItems: 'center', left: PIN_BOX / 2 - 75, top: PIN_BOX - 8 },
  pulse: {
    backgroundColor: MINT,
    borderRadius: 999,
    height: 24,
    left: PIN_BOX / 2 - 12,
    position: 'absolute',
    top: PIN_BOX / 2 - 12,
    width: 24,
  },
  mapLoro: { height: 44, left: PIN_BOX / 2 - 15, position: 'absolute', top: PIN_BOX / 2 - 11 - 44, width: 30 },
  pin: {
    alignItems: 'center',
    backgroundColor: '#2b3430',
    borderColor: '#0b1210',
    borderRadius: 999,
    borderWidth: 3,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  pinDone: { backgroundColor: MINT },
  pinHere: { backgroundColor: INK, borderColor: MINT, borderWidth: 3 },
  pinCheck: { color: '#06130d', fontSize: 10, fontWeight: '900' },
  pinCount: {
    backgroundColor: '#0b1210',
    borderColor: MINT,
    borderRadius: 999,
    borderWidth: 1,
    left: PIN_BOX / 2 + 6,
    minWidth: 18,
    paddingHorizontal: 4,
    position: 'absolute',
    top: PIN_BOX / 2 - 20,
  },
  pinCountText: { color: MINT, fontSize: 9, fontWeight: '900', textAlign: 'center' },
  pinLock: { backgroundColor: 'rgba(242,245,243,0.35)', borderRadius: 2, height: 7, marginTop: 2, width: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chipsHint: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 12 },
  chipTop: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  chipPlay: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 4,
    borderLeftColor: MINT,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderTopWidth: 4,
    height: 0,
    width: 0,
  },
  tapNudge: {
    backgroundColor: MINT,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    left: PIN_BOX / 2 + 6,
    position: 'absolute',
    top: PIN_BOX / 2 + 6,
    zIndex: 2,
  },
  tapNudgeText: { color: '#06130d', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  howCard: {
    backgroundColor: 'rgba(94,230,168,0.08)',
    borderColor: 'rgba(94,230,168,0.25)',
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 18,
    padding: 16,
  },
  howTitle: { color: INK, fontSize: 18, fontWeight: '900', marginBottom: 10 },
  howRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  howNum: {
    alignItems: 'center',
    backgroundColor: MINT,
    borderRadius: 999,
    height: 22,
    justifyContent: 'center',
    marginTop: 1,
    width: 22,
  },
  howNumText: { color: '#06130d', fontSize: 12, fontWeight: '900' },
  howText: { color: 'rgba(242,245,243,0.8)', flex: 1, fontSize: 14, lineHeight: 20 },
  howCta: { alignItems: 'center', backgroundColor: MINT, borderRadius: 14, marginTop: 4, paddingVertical: 11 },
  howCtaText: { color: '#06130d', fontSize: 15, fontWeight: '900' },
  chip: {
    backgroundColor: 'rgba(94,230,168,0.1)',
    borderRadius: 12,
    maxWidth: 150,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipWord: { color: MINT, fontSize: 14, fontWeight: '900' },
  chipWordBlue: { color: BLUE },
  chipMeaning: { color: 'rgba(242,245,243,0.55)', fontSize: 11, fontWeight: '600' },
  cityTag: { backgroundColor: 'rgba(8,16,13,0.72)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  cityTagHere: { backgroundColor: INK },
  cityName: { color: MUTED, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  cityNameDone: { color: 'rgba(94,230,168,0.8)' },
  cityNameHere: { color: '#06130d' },
  cityNameAhead: { color: FAINT },
  tripHow: { color: FAINT, fontSize: 11, marginTop: 10, paddingHorizontal: 18 },
  postRow: { flexDirection: 'row', marginVertical: 6, paddingHorizontal: 8 },
  postcard: {
    backgroundColor: '#f1e8d4',
    borderRadius: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    width: 196,
  },
  airmail: { flexDirection: 'row', height: 6 },
  airmailStripe: { flex: 1, transform: [{ skewX: '-30deg' }] },
  postcardBody: { paddingBottom: 12, paddingHorizontal: 14, paddingTop: 12 },
  stamp: {
    alignItems: 'center',
    backgroundColor: '#fffaf0',
    borderColor: 'rgba(60,45,20,0.35)',
    borderStyle: 'dotted',
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    right: 10,
    top: 10,
    width: 38,
  },
  postmark: {
    alignItems: 'center',
    borderColor: 'rgba(40,30,80,0.45)',
    borderRadius: 999,
    borderWidth: 1.5,
    height: 38,
    justifyContent: 'center',
    position: 'absolute',
    right: 30,
    top: 18,
    transform: [{ rotate: '-18deg' }],
    width: 38,
  },
  postmarkText: { color: 'rgba(40,30,80,0.55)', fontSize: 6, fontWeight: '900', letterSpacing: 0.4 },
  postHello: { color: '#6b5a3a', fontSize: 14, fontStyle: 'italic', fontWeight: '600', marginTop: 16 },
  postCity: { color: '#1f1a12', fontSize: 26, fontWeight: '900', letterSpacing: -0.4, marginRight: 30 },
  postCountry: { color: '#8a7755', fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 2 },
  note: {
    backgroundColor: '#1a2320',
    borderRadius: 14,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    width: 190,
  },
  tape: {
    alignSelf: 'center',
    backgroundColor: 'rgba(242,235,210,0.55)',
    height: 18,
    position: 'absolute',
    top: -9,
    transform: [{ rotate: '-4deg' }],
    width: 64,
    zIndex: 2,
  },
  noteBand: {
    alignItems: 'center',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noteBandText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 3 },
  noteBody: { paddingBottom: 12, paddingHorizontal: 12, paddingTop: 8 },
  noteWord: { color: INK, fontSize: 26, fontWeight: '900' },
  noteMeaning: { color: MINT, fontSize: 13, fontWeight: '800', marginTop: 1 },
  noteFact: { color: 'rgba(242,245,243,0.65)', fontSize: 11, lineHeight: 15, marginTop: 8 },
  closedCity: { marginBottom: 14, opacity: 0.85 },
  signClosed: { backgroundColor: 'rgba(242,245,243,0.03)', borderColor: 'rgba(242,245,243,0.1)', borderStyle: 'dashed', borderWidth: 1 },
  signCityClosed: { color: 'rgba(242,245,243,0.7)' },
  closedFlag: { opacity: 0.45 },
  closedLine: { color: MUTED, fontSize: 14, fontWeight: '800', marginTop: 10 },
  closedWaiting: { color: FAINT, fontSize: 13, fontWeight: '700', marginTop: 2 },
  lockedCity: {
    alignItems: 'center',
    borderColor: 'rgba(242,245,243,0.1)',
    borderRadius: 999,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  allDone: { color: MUTED, fontSize: 14, lineHeight: 20, marginVertical: 16, textAlign: 'center' },
  sign: {
    backgroundColor: 'rgba(242,245,243,0.05)',
    borderRadius: 24,
    marginBottom: 8,
    marginTop: 16,
    padding: 16,
  },
  signTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  signName: { flex: 1 },
  signCity: { color: INK, fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  signCountry: { color: MUTED, fontSize: 13, fontWeight: '700' },
  signCount: { color: MINT, fontSize: 26, fontVariant: ['tabular-nums'], fontWeight: '900' },
  signCountOf: { color: FAINT, fontSize: 16, fontWeight: '800' },
  signTrack: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 999,
    height: 8,
    marginTop: 12,
    overflow: 'hidden',
  },
  signFill: { backgroundColor: MINT, borderRadius: 999, height: '100%' },
  signNext: { color: MINT, fontSize: 14, fontWeight: '800', marginTop: 8 },
  saveMore: { color: FAINT, fontSize: 13, lineHeight: 19, marginVertical: 10, textAlign: 'center' },
  preview: { paddingTop: 4 },
  previewCta: { alignItems: 'center', backgroundColor: MINT, borderRadius: 16, marginTop: 22, paddingVertical: 15 },
  previewCtaText: { color: '#06130d', fontSize: 16, fontWeight: '900' },
  stageBlock: { marginBottom: 14 },
  banner: {
    backgroundColor: 'transparent',
    marginBottom: 6,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  bannerCurrent: {},
  foldAway: { color: FAINT, fontSize: 11, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  bannerRow: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  bannerTitle: { color: INK, fontSize: 22, fontWeight: '900' },
  bannerTitleCurrent: { color: MINT },
  bannerCount: { color: MUTED, fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '800' },
  bannerCountCurrent: { color: INK },
  bannerSub: { color: FAINT, fontSize: 12, marginTop: 2 },
  bannerSubCurrent: { color: MUTED },
  track: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 999,
    height: 6,
    marginTop: 12,
    overflow: 'hidden',
  },
  trackCurrent: {},
  fill: { backgroundColor: MINT, borderRadius: 999, height: '100%' },
  fillCurrent: {},

  fold: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.05)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  foldMark: { alignItems: 'center', borderRadius: 999, height: 34, justifyContent: 'center', width: 34 },
  foldMarkDone: { backgroundColor: MINT },
  foldMarkLocked: { backgroundColor: '#232a27' },
  foldCheck: { color: '#06130d', fontSize: 16, fontWeight: '900' },
  foldText: { flex: 1 },
  foldTitle: { color: INK, fontSize: 15, fontWeight: '800' },
  foldTitleLocked: { color: 'rgba(242,245,243,0.7)' },
  foldBody: { color: MUTED, fontSize: 12, marginTop: 1 },
  foldChevron: { color: FAINT, fontSize: 22, fontWeight: '600' },

  coinLayer: {
    borderRadius: COIN_H / 2,
    height: COIN_H,
    left: 0,
    position: 'absolute',
    width: COIN_W,
  },
  coinFace: { alignItems: 'center', justifyContent: 'center' },
  coinOpenRing: { borderColor: 'rgba(94,230,168,0.35)', borderWidth: 2 },
  halo: {
    borderColor: 'rgba(94,230,168,0.4)',
    borderRadius: (COIN_H + 30) / 2,
    borderWidth: 4,
    height: COIN_H + LIP + 18,
    left: -12,
    position: 'absolute',
    top: -9,
    width: COIN_W + 24,
  },
  check: { color: '#06130d', fontSize: 24, fontWeight: '900' },
  play: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 10,
    borderLeftWidth: 16,
    borderTopColor: 'transparent',
    borderTopWidth: 10,
    height: 0,
    marginLeft: 5,
    width: 0,
  },
  mascotRow: { alignItems: 'center', gap: 8, height: 150, marginVertical: 4, paddingHorizontal: 6 },
  mascot: { height: 128, width: 86 },
  mascotWaving: { height: 118, width: 105 },
  bubble: {
    backgroundColor: '#1a2420',
    borderRadius: 16,
    flexShrink: 1,
    maxWidth: 190,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  bubbleLeft: { borderBottomLeftRadius: 4 },
  bubbleRight: { borderBottomRightRadius: 4 },
  bubbleText: { color: INK, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  bubbleWord: { color: MINT, fontWeight: '900' },
  lock: { alignItems: 'center' },
  lockShackle: {
    borderBottomWidth: 0,
    borderColor: '#4a5550',
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderWidth: 2.5,
    height: 9,
    marginBottom: -1,
    width: 12,
  },
  lockBody: { backgroundColor: '#4a5550', borderRadius: 3, height: 11, width: 17 },

  label: { position: 'absolute' },
  labelWord: { color: INK, fontSize: 17, fontWeight: '900' },
  labelWordLocked: { color: FAINT, fontWeight: '700' },
  labelWordDone: { color: MINT },
  labelWordBlue: { color: BLUE },
  labelDetail: { color: MUTED, fontSize: 12, marginTop: 2 },

  hereTag: {
    alignItems: 'center',
    backgroundColor: INK,
    borderRadius: 10,
    paddingVertical: 5,
    position: 'absolute',
    top: 4,
    width: 96,
  },
  hereText: { color: '#06130d', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  hereTail: {
    borderLeftColor: 'transparent',
    borderLeftWidth: 7,
    borderRightColor: 'transparent',
    borderRightWidth: 7,
    borderTopColor: INK,
    borderTopWidth: 7,
    bottom: -7,
    height: 0,
    position: 'absolute',
    width: 0,
  },
});
