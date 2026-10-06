import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { TRIP, tripStop } from '@loro/core/roadmap';
import { BRAND } from '../onboarding/brand';
import { COUNTRIES, Flag, flagColours } from '../vocab/countries';
import { CITY_XY, LANDS, MAP_H, type LabelSide } from '../vocab/tripMapData';

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
  rounded = true,
}: {
  /** Off for the exported image: a story is full-bleed. */
  rounded?: boolean;
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

  /**
   * THE LEG YOU JUST TRAVELLED (Radek, 2026-10-06: "when they arrive to a
   * city, or country in my case, I want to see the arrival from the previous
   * one to the current"). Same country: that country, the earlier route
   * faint, the last leg bright. New country: both countries side by side as
   * on the trip map (LANDS sit in trip order), the leg arcing across. The
   * wrap from Caracas back to Madrid has no neighbour to pair, so it shows
   * Spain alone.
   */
  const from = tripStop(Math.max(0, stage - 1));
  const landAt = LANDS.findIndex((l) => l.country === stop.country);
  const land = LANDS[landAt];
  const prevLand = LANDS[landAt - 1];
  const crossing = from.country !== stop.country && prevLand?.country === from.country;
  const lands = crossing ? [prevLand, land] : land ? [land] : [];
  const mapW = px(304);
  const mapH = px(176);
  const pad = 40;
  const vbX = lands.length ? lands[0].x0 - pad : 0;
  const vbW = lands.length ? lands[lands.length - 1].x1 - lands[0].x0 + pad * 2 : 300;
  const scale = Math.min(mapW / vbW, mapH / MAP_H);
  const r = (n: number) => n / scale; // screen px -> map units
  const shownCountries = new Set(lands.map((l) => l.country));
  const dots = TRIP.filter((t) => shownCountries.has(t.country)).map((t) => CITY_XY[t.city]).filter(Boolean);
  // Earlier stops in this country, up to the one you left (same-country only).
  const before = crossing
    ? []
    : TRIP.slice(0, stage).filter((t) => t.country === stop.country).map((t) => CITY_XY[t.city]).filter(Boolean);
  const p = CITY_XY[from.city];
  const q = CITY_XY[stop.city];
  const leg = p && q && stage > 0 ? arc(p, q) : null;

  return (
    <View collapsable={false} style={{ backgroundColor: bottom, borderRadius: rounded ? px(22) : 0, height, overflow: 'hidden', width }}>
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

      {/* Header: the logo centred (Radek, 2026-10-06), the postmark right */}
      <View style={{ alignItems: 'center', left: 0, position: 'absolute', right: 0, top: px(30) }}>
        <Image source={BRAND.logo} resizeMode="contain" style={{ height: px(34), width: px(69) }} accessibilityLabel="Loro" />
      </View>
      <View style={{ position: 'absolute', right: px(26), top: px(24) }}>
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

      {/* The leg you just travelled */}
      {lands.length > 0 && (
        <View style={{ alignItems: 'center', left: 0, position: 'absolute', right: 0, top: px(202) }}>
          <Svg width={mapW} height={mapH} viewBox={`${vbX} 0 ${vbW} ${MAP_H}`}>
            <Defs>
              <LinearGradient id="leg" x1={p?.x ?? 0} y1={p?.y ?? 0} x2={q?.x ?? 1} y2={q?.y ?? 1} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={WHITE} stopOpacity={0.7} />
                <Stop offset="1" stopColor={MINT} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            {lands.map((l) => (
              <Path
                key={l.country}
                d={l.d}
                fill={WHITE}
                fillOpacity={l.country === stop.country ? 0.08 : 0.04}
                stroke={WHITE}
                strokeOpacity={l.country === stop.country ? 0.38 : 0.2}
                strokeWidth={r(1)}
              />
            ))}
            {dots.map((c, i) => (
              <Circle key={`d${i}`} cx={c.x} cy={c.y} r={r(2)} fill={WHITE} opacity={0.25} />
            ))}
            {before.length > 1 &&
              before.slice(1).map((c, i) => (
                <Path
                  key={`b${i}`}
                  d={arc(before[i], c)}
                  fill="none"
                  stroke={MINT}
                  strokeOpacity={0.3}
                  strokeWidth={r(1.4)}
                  strokeDasharray={`${r(3)} ${r(4)}`}
                  strokeLinecap="round"
                />
              ))}
            {leg && (
              <>
                <Path d={leg} fill="none" stroke={MINT} strokeOpacity={0.22} strokeWidth={r(8)} strokeLinecap="round" />
                <Path d={leg} fill="none" stroke="url(#leg)" strokeWidth={r(2.4)} strokeLinecap="round" />
              </>
            )}
            {p && stage > 0 && <Circle cx={p.x} cy={p.y} r={r(3.6)} fill={WHITE} />}
            {q && (
              <G>
                <Circle cx={q.x} cy={q.y} r={r(13)} fill={MINT} opacity={0.16} />
                <Circle cx={q.x} cy={q.y} r={r(5.5)} fill={MINT} />
              </G>
            )}
            {p && q && stage > 0 && <CityLabel at={{ ...p, side: awayFrom(p, q) }} name={from.city} size={r(10)} dim r={r} />}
            {q && <CityLabel at={p ? { ...q, side: awayFrom(q, p) } : q} name={stop.city} size={r(11)} r={r} />}
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
          {`${shown.length} ${shown.length === 1 ? 'WORD' : 'WORDS'} LEARNED ON THE WAY`}
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

/**
 * A travelled leg as a gentle arc, bowed to one side by a fifth of its
 * length, so a short hop and an ocean crossing read as the same kind of
 * journey. It bows upward when the leg runs sideways.
 */
function arc(p: { x: number; y: number }, q: { x: number; y: number }): string {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const bow = len * 0.2;
  const cx = (p.x + q.x) / 2 + nx * bow;
  const cy = (p.y + q.y) / 2 + ny * bow;
  return `M${p.x} ${p.y} Q${cx} ${cy} ${q.x} ${q.y}`;
}

/**
 * Which side of `a` its name goes so it never sits on the leg: the far side
 * from the other end, sideways for a sideways leg, above or below for a
 * north-south one.
 */
function awayFrom(a: { x: number; y: number }, b: { x: number; y: number }): LabelSide {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'left' : 'right';
  return dy > 0 ? 'above' : 'below';
}

/** A city's name beside its dot, on the side the trip map uses for it. */
function CityLabel({
  at,
  name,
  size,
  dim,
  r,
}: {
  at: { x: number; y: number; side: LabelSide };
  name: string;
  size: number;
  dim?: boolean;
  r: (n: number) => number;
}) {
  const gap = r(10);
  const place = {
    above: { x: at.x, y: at.y - gap, anchor: 'middle' as const },
    below: { x: at.x, y: at.y + gap + size * 0.8, anchor: 'middle' as const },
    left: { x: at.x - gap, y: at.y + size * 0.35, anchor: 'end' as const },
    right: { x: at.x + gap, y: at.y + size * 0.35, anchor: 'start' as const },
  }[at.side];
  return (
    <SvgText
      x={place.x}
      y={place.y}
      textAnchor={place.anchor}
      fontFamily={SANS}
      fontWeight="700"
      fontSize={size}
      fill={dim ? WHITE : MINT}
      fillOpacity={dim ? 0.6 : 1}
    >
      {name}
    </SvgText>
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
