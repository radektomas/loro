import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polyline, RadialGradient, Rect, Stop } from 'react-native-svg';
import { TRIP, tripStop } from '@loro/core/roadmap';
import { BRAND } from '../onboarding/brand';
import { COUNTRIES, Flag, flagColours } from '../vocab/countries';
import { CITY_XY, LANDS, MAP_H } from '../vocab/tripMapData';

/**
 * THE CITY CARD FOR STORIES (Radek, 2026-10-06: "it needs to be fucking
 * pretty and vibes smooth"; then, on the first draft: "doesn't look bad but
 * I want a more smooth aesthetic look so people want to share it").
 *
 * Second draft, quieter and more editorial — the Strava-route idea:
 *   - a smooth gradient tinted by the country's flag, one soft glow, nothing
 *     else on the ground (the dotted grid and the paper postcard are gone);
 *   - the city set in Didot, the iOS display serif, "¡Llegué a" in Georgia
 *     italic — real typography at zero cost, both ship with iOS;
 *   - the COUNTRY'S REAL OUTLINE (the trip map's Natural Earth shapes) with
 *     your route through it glowing mint, the city you reached haloed;
 *   - the words that got you there on one frosted panel;
 *   - a postmark with the date, the Loro logo at the head, and the trip in
 *     two labelled numbers at the foot (third draft: the unlabelled "10 words
 *     · 2 cities" beside four words read as a contradiction).
 *
 * Laid out in units of width/360, so the preview and the 1080-wide export are
 * the same picture. Everything on it is the user's own trip. No emoji.
 */
export type CityCardWord = { word: string; meaning: string };

const MINT = '#5ee6a8';
const WHITE = '#f6f3ec';
const DISPLAY = 'Didot';
const SERIF = 'Georgia';
const SANS = 'Avenir Next';

/** Mix a hex colour toward a base, for a flag-tinted but calm ground. */
function mix(hex: string, base: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(base)];
  return `#${a.map((v, i) => Math.round(b[i] + (v - b[i]) * t).toString(16).padStart(2, '0')).join('')}`;
}

export function CityShareCard({
  stage,
  words,
  arrivedAt,
  learnedTotal,
  width,
}: {
  stage: number;
  words: CityCardWord[];
  arrivedAt: number;
  learnedTotal: number;
  width: number;
}) {
  const u = width / 360;
  const px = (n: number) => Math.round(n * u * 10) / 10;
  const height = Math.round((width * 16) / 9);
  const stop = tripStop(stage);
  const info = COUNTRIES[stop.country];
  const [a] = flagColours(stop.country);
  const top = mix(a, '#0a0f0d', 0.18);
  const bottom = mix(a, '#050807', 0.42);
  const d = new Date(arrivedAt);
  const day = d.toLocaleDateString('es-ES', { day: 'numeric' });
  const month = d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '').toUpperCase();
  // Every word of the city before, as pills — a city is 5 to 10 words.
  const shown = words.slice(0, 10);
  const prevCity = tripStop(Math.max(0, stage - 1)).city;

  // The country's outline, fitted into the map box, and your route through it.
  const land = LANDS.find((l) => l.country === stop.country);
  const mapW = px(304);
  const mapH = px(168);
  const here = TRIP.slice(0, stage + 1).filter((t) => t.country === stop.country).map((t) => CITY_XY[t.city]).filter(Boolean);
  const all = TRIP.filter((t) => t.country === stop.country).map((t) => CITY_XY[t.city]).filter(Boolean);
  const pad = 14;
  const vbX = land ? land.x0 - pad : 0;
  const vbW = land ? land.x1 - land.x0 + pad * 2 : 300;
  const scale = Math.min(mapW / vbW, mapH / MAP_H);
  const r = (n: number) => n / scale; // screen px -> map units

  return (
    <View style={{ borderRadius: px(22), height, overflow: 'hidden', width }}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={top} />
            <Stop offset="1" stopColor={bottom} />
          </LinearGradient>
          <RadialGradient id="glow" cx="50%" cy="46%" r="45%">
            <Stop offset="0" stopColor={MINT} stopOpacity={0.16} />
            <Stop offset="1" stopColor={MINT} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#ground)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#glow)" />
      </Svg>

      {/* Header: brand left, postmark right */}
      <View style={[styles.row, { justifyContent: 'space-between', left: px(26), position: 'absolute', right: px(26), top: px(28) }]}>
        <Image source={BRAND.logo} resizeMode="contain" style={{ height: px(34), width: px(69) }} accessibilityLabel="Loro" />
        <View style={[styles.postmark, { borderWidth: px(1), height: px(46), width: px(46) }]}>
          <Text style={[styles.postDay, { fontSize: px(15) }]}>{day}</Text>
          <Text style={[styles.postMonth, { fontSize: px(7.5), letterSpacing: px(1.2) }]}>{month}</Text>
        </View>
      </View>

      {/* The arrival */}
      <View style={{ left: px(26), position: 'absolute', right: px(26), top: px(76) }}>
        <Text style={[styles.hello, { fontSize: px(22) }]}>¡Llegué a</Text>
        <Text
          style={[styles.city, { fontSize: px(62), lineHeight: px(68), marginTop: px(-2) }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {stop.city}
        </Text>
        <View style={[styles.row, { gap: px(8), marginTop: px(6) }]}>
          {info && <Flag spec={info.flag} height={px(11)} />}
          <Text style={[styles.country, { fontSize: px(10.5), letterSpacing: px(2.6) }]}>{stop.country.toUpperCase()}</Text>
        </View>
      </View>

      {/* The country, and your route through it */}
      {land && (
        <View style={{ alignItems: 'center', left: 0, position: 'absolute', right: 0, top: px(206) }}>
          <Svg width={mapW} height={mapH} viewBox={`${vbX} 0 ${vbW} ${MAP_H}`}>
            <G>
              <Path d={land.d} fill={WHITE} fillOpacity={0.07} stroke={WHITE} strokeOpacity={0.35} strokeWidth={r(1)} />
              {all.map((c, i) => (
                <Circle key={`all${i}`} cx={c.x} cy={c.y} r={r(2.2)} fill={WHITE} opacity={0.3} />
              ))}
              {here.length > 1 && (
                <>
                  <Polyline
                    points={here.map((c) => `${c.x},${c.y}`).join(' ')}
                    fill="none"
                    stroke={MINT}
                    strokeOpacity={0.25}
                    strokeWidth={r(7)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <Polyline
                    points={here.map((c) => `${c.x},${c.y}`).join(' ')}
                    fill="none"
                    stroke={MINT}
                    strokeWidth={r(2)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              )}
              {here.map((c, i) => {
                const last = i === here.length - 1;
                return (
                  <G key={`here${i}`}>
                    {last && <Circle cx={c.x} cy={c.y} r={r(11)} fill={MINT} opacity={0.18} />}
                    <Circle cx={c.x} cy={c.y} r={last ? r(5) : r(3.2)} fill={last ? MINT : WHITE} />
                  </G>
                );
              })}
            </G>
          </Svg>
        </View>
      )}

      {/* What got you here, on one frosted panel */}
      <View
        style={[
          styles.panel,
          { borderRadius: px(18), borderWidth: px(1), left: px(22), paddingHorizontal: px(18), paddingVertical: px(14), position: 'absolute', right: px(22), top: px(388) },
        ]}
      >
        <Text style={[styles.panelLabel, { fontSize: px(9.5), letterSpacing: px(1.8) }]} numberOfLines={1}>
          {`${shown.length} ${shown.length === 1 ? 'WORD' : 'WORDS'} LEARNED IN ${prevCity.toUpperCase()}`}
        </Text>
        <View style={[styles.pills, { gap: px(7), marginTop: px(11) }]}>
          {shown.map((w) => (
            <View key={w.word} style={[styles.pill, { borderRadius: px(99), paddingHorizontal: px(12), paddingVertical: px(6) }]}>
              <Text style={[styles.pillText, { fontSize: px(14) }]} numberOfLines={1}>
                {w.word}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Foot: the trip in two honest numbers */}
      <View style={{ bottom: px(28), left: px(26), position: 'absolute', right: px(26) }}>
        <Text style={[styles.stat, { fontSize: px(14) }]}>
          {learnedTotal} words learned · stop {stage + 1} of {TRIP.length}
        </Text>
        <Text style={[styles.tag, { fontSize: px(11), marginTop: px(4) }]}>Spanish from real people, on Loro</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
  postmark: {
    alignItems: 'center',
    borderColor: 'rgba(246,243,236,0.4)',
    borderRadius: 999,
    justifyContent: 'center',
    transform: [{ rotate: '-10deg' }],
  },
  postDay: { color: WHITE, fontFamily: DISPLAY, fontWeight: '700' },
  postMonth: { color: 'rgba(246,243,236,0.7)', fontFamily: SANS, fontWeight: '700' },
  hello: { color: 'rgba(246,243,236,0.78)', fontFamily: SERIF, fontStyle: 'italic' },
  city: { color: WHITE, fontFamily: DISPLAY, fontWeight: '700' },
  country: { color: 'rgba(246,243,236,0.6)', fontFamily: SANS, fontWeight: '600' },
  panel: { backgroundColor: 'rgba(246,243,236,0.07)', borderColor: 'rgba(246,243,236,0.14)' },
  panelLabel: { color: 'rgba(246,243,236,0.5)', fontFamily: SANS, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { backgroundColor: 'rgba(246,243,236,0.1)', borderColor: 'rgba(94,230,168,0.35)', borderWidth: 1 },
  pillText: { color: WHITE, fontFamily: SANS, fontWeight: '600' },
  stat: { color: WHITE, fontFamily: SANS, fontWeight: '700' },
  tag: { color: MINT, fontFamily: SANS, fontWeight: '600' },
});
