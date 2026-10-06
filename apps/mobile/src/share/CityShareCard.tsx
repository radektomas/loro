import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, RadialGradient, Rect, Stop } from 'react-native-svg';
import { TRIP, tripStop } from '@loro/core/roadmap';
import { BRAND } from '../onboarding/brand';
import { COUNTRIES, Flag, flagColours } from '../vocab/countries';

/**
 * THE CITY CARD FOR STORIES (Radek, 2026-10-06: "this would be a cool
 * feature, but it needs to be fucking pretty and vibes smooth").
 *
 * A 9:16 poster, drawn at `width` and laid out in units of width/360 so it
 * renders identically at preview size and at export size (1080 wide).
 * Night-green ground with a mint glow and a glow in the flag's colour; the
 * arrival set big; the Words page's postcard (airmail edge in the flag's
 * colours, flag stamp, dated postmark) carrying the words that got you
 * there; the route so far as a line of stops; Loro waving at the foot.
 *
 * Nothing here is invented: the city, the date, the words and the route are
 * the user's own trip. No emoji.
 */
export type CityCardWord = { word: string; meaning: string };

const NIGHT = '#07110d';
const MINT = '#5ee6a8';
const CREAM = '#f1e8d4';
const INK = '#1f1a12';

export function CityShareCard({
  stage,
  words,
  arrivedAt,
  learnedTotal,
  width,
}: {
  /** The city just reached (TRIP index). */
  stage: number;
  /** Learned in the city before it — what got you here. Up to six are shown. */
  words: CityCardWord[];
  arrivedAt: number;
  learnedTotal: number;
  width: number;
}) {
  const u = width / 360;
  const height = Math.round((width * 16) / 9);
  const stop = tripStop(stage);
  const next = tripStop(stage + 1);
  const info = COUNTRIES[stop.country];
  const [a, b] = flagColours(stop.country);
  const date = new Date(arrivedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).toUpperCase();
  const route = TRIP.slice(Math.max(0, stage - 3), stage + 1).map((t) => t.city);
  const shown = words.slice(0, 6);
  const px = (n: number) => Math.round(n * u * 10) / 10;

  return (
    <View style={{ backgroundColor: NIGHT, borderRadius: px(18), height, overflow: 'hidden', width }}>
      {/* The ground: two soft glows, a faint dotted grid like a map sheet. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="mint" cx="18%" cy="12%" r="65%">
            <Stop offset="0" stopColor={MINT} stopOpacity={0.28} />
            <Stop offset="1" stopColor={MINT} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="flag" cx="92%" cy="78%" r="70%">
            <Stop offset="0" stopColor={a} stopOpacity={0.3} />
            <Stop offset="1" stopColor={a} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#mint)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#flag)" />
        {Array.from({ length: 15 }, (_, row) =>
          Array.from({ length: 9 }, (_, col) => (
            <Circle
              key={`${row}-${col}`}
              cx={px(20 + col * 40)}
              cy={px(20 + row * 42)}
              r={px(1)}
              fill="#f2f5f3"
              opacity={0.07}
            />
          ))
        )}
      </Svg>

      {/* Eyebrow */}
      <View style={[styles.row, { left: px(28), position: 'absolute', top: px(34), gap: px(8) }]}>
        <View style={{ backgroundColor: MINT, borderRadius: 99, height: px(6), width: px(6) }} />
        <Text style={[styles.eyebrow, { fontSize: px(10.5), letterSpacing: px(2) }]}>MY SPANISH TRIP</Text>
      </View>

      {/* The arrival, set big */}
      <View style={{ left: px(28), position: 'absolute', right: px(28), top: px(70) }}>
        <Text style={[styles.hello, { fontSize: px(26) }]}>¡Llegué a</Text>
        <Text style={[styles.city, { fontSize: px(64), letterSpacing: px(-2), lineHeight: px(70) }]} numberOfLines={1} adjustsFontSizeToFit>
          {stop.city}!
        </Text>
        <View style={[styles.row, { gap: px(10), marginTop: px(8) }]}>
          {info && <Flag spec={info.flag} height={px(16)} />}
          <Text style={[styles.country, { fontSize: px(12), letterSpacing: px(3) }]}>{stop.country.toUpperCase()}</Text>
        </View>
      </View>

      {/* The postcard, with the words that got you here */}
      <View
        style={[
          styles.postcard,
          {
            borderRadius: px(8),
            left: px(30),
            position: 'absolute',
            right: px(30),
            top: px(232),
            transform: [{ rotate: '-3deg' }],
          },
        ]}
      >
        <Airmail a={a} b={b} h={px(8)} />
        <View style={{ paddingHorizontal: px(20), paddingVertical: px(18) }}>
          <View style={[styles.stamp, { borderWidth: px(2), height: px(46), right: px(14), top: px(14), width: px(40) }]}>
            {info && <Flag spec={info.flag} height={px(20)} />}
          </View>
          <View
            style={[
              styles.postmark,
              { borderWidth: px(1.5), height: px(58), right: px(40), top: px(28), width: px(58), transform: [{ rotate: '-14deg' }] },
            ]}
          >
            <Text style={[styles.postmarkText, { fontSize: px(7.5) }]} numberOfLines={1}>
              {stop.city.toUpperCase()}
            </Text>
            <Text style={[styles.postmarkDate, { fontSize: px(8.5) }]}>{date}</Text>
          </View>
          <Text style={[styles.cardLabel, { fontSize: px(10), letterSpacing: px(1.6) }]}>THE WORDS THAT GOT ME HERE</Text>
          <View style={{ gap: px(7), marginTop: px(14), paddingRight: px(70) }}>
            {shown.map((w) => (
              <Text key={w.word} style={[styles.word, { fontSize: px(19) }]} numberOfLines={1}>
                {w.word}
                <Text style={[styles.meaning, { fontSize: px(12.5) }]}>{`  ${w.meaning}`}</Text>
              </Text>
            ))}
          </View>
        </View>
        <Airmail a={a} b={b} h={px(8)} />
      </View>

      {/* The route so far */}
      <View style={{ bottom: px(150), left: px(28), position: 'absolute', right: px(28) }}>
        <Svg width={width - px(56)} height={px(14)}>
          <Line x1={px(6)} y1={px(7)} x2={width - px(62)} y2={px(7)} stroke="#f2f5f3" strokeOpacity={0.25} strokeWidth={px(1.5)} strokeDasharray={`${px(4)} ${px(5)}`} />
          {[...route, next.city].map((_, i, all) => {
            const x = px(6) + (i * (width - px(68))) / Math.max(1, all.length - 1);
            const isHere = i === all.length - 2;
            const isNext = i === all.length - 1;
            return (
              <Circle
                key={i}
                cx={x}
                cy={px(7)}
                r={isHere ? px(6) : px(4)}
                fill={isNext ? NIGHT : MINT}
                stroke={isNext ? '#f2f5f3' : MINT}
                strokeOpacity={isNext ? 0.4 : 1}
                strokeWidth={px(1.5)}
              />
            );
          })}
        </Svg>
        <View style={[styles.row, { justifyContent: 'space-between', marginTop: px(8) }]}>
          {[...route, next.city].map((c, i, all) => (
            <Text
              key={c + i}
              style={[
                styles.routeCity,
                { fontSize: px(10.5) },
                i === all.length - 2 && styles.routeHere,
                i === all.length - 1 && styles.routeNext,
              ]}
              numberOfLines={1}
            >
              {c}
            </Text>
          ))}
        </View>
      </View>

      {/* Foot: what Loro is, and Loro */}
      <View style={{ bottom: px(36), left: px(28), position: 'absolute', right: px(130) }}>
        <Text style={[styles.footBig, { fontSize: px(17), lineHeight: px(22) }]}>
          {learnedTotal} words learned from real people speaking.
        </Text>
        <Text style={[styles.footBrand, { fontSize: px(13), letterSpacing: px(0.4), marginTop: px(8) }]}>
          loro <Text style={styles.footDim}>· Spanish from real videos</Text>
        </Text>
      </View>
      <Image
        source={BRAND.parrotWaving}
        resizeMode="contain"
        style={{ bottom: px(18), height: px(128), position: 'absolute', right: px(14), width: px(114) }}
      />
    </View>
  );
}

function Airmail({ a, b, h }: { a: string; b: string; h: number }) {
  return (
    <View style={[styles.row, { height: h, overflow: 'hidden' }]}>
      {Array.from({ length: 22 }, (_, i) => (
        <View key={i} style={{ backgroundColor: i % 2 === 0 ? a : b, flex: 1, transform: [{ skewX: '-30deg' }] }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
  eyebrow: { color: 'rgba(242,245,243,0.7)', fontWeight: '900' },
  hello: { color: 'rgba(242,245,243,0.75)', fontStyle: 'italic', fontWeight: '600' },
  city: { color: '#f2f5f3', fontWeight: '900' },
  country: { color: 'rgba(242,245,243,0.6)', fontWeight: '900' },
  postcard: {
    backgroundColor: CREAM,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
  },
  stamp: {
    alignItems: 'center',
    backgroundColor: '#fffaf0',
    borderColor: 'rgba(60,45,20,0.35)',
    borderStyle: 'dotted',
    justifyContent: 'center',
    position: 'absolute',
  },
  postmark: {
    alignItems: 'center',
    borderColor: 'rgba(40,30,80,0.42)',
    borderRadius: 999,
    justifyContent: 'center',
    position: 'absolute',
  },
  postmarkText: { color: 'rgba(40,30,80,0.55)', fontWeight: '900', letterSpacing: 0.6 },
  postmarkDate: { color: 'rgba(40,30,80,0.55)', fontWeight: '800', marginTop: 1 },
  cardLabel: { color: '#8a7755', fontWeight: '900' },
  word: { color: INK, fontStyle: 'italic', fontWeight: '800' },
  meaning: { color: '#8a7755', fontStyle: 'normal', fontWeight: '700' },
  routeCity: { color: 'rgba(242,245,243,0.55)', fontWeight: '800' },
  routeHere: { color: MINT },
  routeNext: { color: 'rgba(242,245,243,0.35)' },
  footBig: { color: '#f2f5f3', fontWeight: '800' },
  footBrand: { color: MINT, fontWeight: '900' },
  footDim: { color: 'rgba(242,245,243,0.5)', fontWeight: '700' },
});
