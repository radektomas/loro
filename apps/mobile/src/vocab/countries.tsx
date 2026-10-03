import { StyleSheet, View } from 'react-native';

/**
 * THE COUNTRIES OF THE TRIP — what each one gives you for getting there
 * (Radek, 2026-09-30: "add to every country some little additions in the
 * word map, like a flag, animal or something interactive, so the user wants
 * to get to another country").
 *
 * Each country carries its FLAG, drawn from plain Views (the app uses no
 * emoji, and a bundled image set would be a rebuild), a LOCAL WORD — real
 * slang from that country, which is the reward a Spanish learner actually
 * wants — and one short fact. The word stays hidden until the trip reaches
 * the country. Keys match roadmap.ts TRIP's `country`.
 *
 * Flags are the civil versions, simplified to stripes and shapes: coats of
 * arms become a small disc, stars are left out. Recognisable at 24pt, and
 * never a wrong colour or a wrong stripe order.
 */

type Stripe = { color: string; weight?: number };
export type FlagSpec = {
  /** 'h' stripes run top to bottom, 'v' left to right. */
  dir?: 'h' | 'v';
  stripes?: Stripe[];
  /** A block in the top-left corner (Chile, Uruguay). */
  canton?: { color: string; w: number; h: number; dot?: string };
  /** A triangle from the hoist (Cuba, Puerto Rico). */
  triangle?: string;
  /** Four quarters, clockwise from top-left, with an optional cross between. */
  quarters?: [string, string, string, string];
  cross?: string;
  /** The coat of arms, reduced to a centred disc. */
  dot?: string;
};

export type CountryInfo = {
  flag: FlagSpec;
  word: string;
  meaning: string;
  fact: string;
};

const RED = '#CE1126';
const WHITE = '#FFFFFF';

export const COUNTRIES: Record<string, CountryInfo> = {
  España: {
    flag: { stripes: [{ color: '#AA151B' }, { color: '#F1BF00', weight: 2 }, { color: '#AA151B' }] },
    word: 'guay',
    meaning: 'cool',
    fact: 'At midnight on New Year’s Eve, Spaniards eat twelve grapes, one for each chime of the clock.',
  },
  México: {
    flag: { dir: 'v', stripes: [{ color: '#006847' }, { color: WHITE }, { color: RED }], dot: '#8A5A2B' },
    word: 'chido',
    meaning: 'cool',
    fact: 'Mexico City was built on an old lake bed, and parts of it sink a little every year.',
  },
  Cuba: {
    flag: {
      stripes: [
        { color: '#002A8F' },
        { color: WHITE },
        { color: '#002A8F' },
        { color: WHITE },
        { color: '#002A8F' },
      ],
      triangle: '#CF142B',
    },
    word: 'asere',
    meaning: 'buddy',
    fact: 'Classic 1950s American cars still work as taxis on the streets of Havana.',
  },
  'Puerto Rico': {
    flag: {
      stripes: [
        { color: '#ED0000' },
        { color: WHITE },
        { color: '#ED0000' },
        { color: WHITE },
        { color: '#ED0000' },
      ],
      triangle: '#0050F0',
    },
    word: 'boricua',
    meaning: 'Puerto Rican',
    fact: 'The tiny coquí frog is named after the “co-quí” it sings all night long.',
  },
  'República Dominicana': {
    flag: { quarters: ['#002D62', RED, '#002D62', RED], cross: WHITE },
    word: 'vaina',
    meaning: 'thing, stuff',
    fact: 'Santo Domingo is the oldest city founded by Europeans in the Americas.',
  },
  Guatemala: {
    flag: { dir: 'v', stripes: [{ color: '#4997D0' }, { color: WHITE }, { color: '#4997D0' }], dot: '#6A8D3A' },
    word: 'chapín',
    meaning: 'Guatemalan',
    fact: 'More than twenty Mayan languages are still spoken in Guatemala today.',
  },
  'Costa Rica': {
    flag: {
      stripes: [
        { color: '#002B7F' },
        { color: WHITE },
        { color: RED, weight: 2 },
        { color: WHITE },
        { color: '#002B7F' },
      ],
    },
    word: 'pura vida',
    meaning: 'all good, the good life',
    fact: 'Costa Rica has had no army since 1948.',
  },
  Panamá: {
    flag: { quarters: [WHITE, '#DA121A', WHITE, '#072357'] },
    word: '¡chuleta!',
    meaning: 'wow!',
    fact: 'Ships crossing the Panama Canal are lifted by locks about 26 metres above the sea.',
  },
  Colombia: {
    flag: { stripes: [{ color: '#FCD116', weight: 2 }, { color: '#003893' }, { color: RED }] },
    word: 'chévere',
    meaning: 'great, awesome',
    fact: 'Colombia is one of the biggest coffee growers in the world.',
  },
  Ecuador: {
    flag: { stripes: [{ color: '#FFDD00', weight: 2 }, { color: '#034EA2' }, { color: '#ED1C24' }], dot: '#8B6D3A' },
    word: '¡chuta!',
    meaning: 'darn!',
    fact: 'Ecuador is named after the equator, which runs right through it.',
  },
  Perú: {
    flag: { dir: 'v', stripes: [{ color: '#D91023' }, { color: WHITE }, { color: '#D91023' }] },
    word: 'causa',
    meaning: 'mate, buddy',
    fact: 'Potatoes come from the Andes, and Peru grows thousands of kinds.',
  },
  Bolivia: {
    flag: { stripes: [{ color: '#D52B1E' }, { color: '#F9E300' }, { color: '#007934' }] },
    word: 'yapa',
    meaning: 'a little extra, on the house',
    fact: 'La Paz is the highest seat of government in the world, at about 3,600 metres.',
  },
  Chile: {
    flag: { stripes: [{ color: WHITE }, { color: '#D52B1E' }], canton: { color: '#0039A6', w: 1 / 3, h: 1 / 2, dot: WHITE } },
    word: 'bacán',
    meaning: 'awesome',
    fact: 'Chile is over 4,000 km long but on average under 200 km wide.',
  },
  Argentina: {
    flag: { stripes: [{ color: '#74ACDF' }, { color: WHITE }, { color: '#74ACDF' }], dot: '#F6B40E' },
    word: 'bárbaro',
    meaning: 'great, brilliant',
    fact: 'Friends share mate, a herbal tea, passing one cup with one metal straw around the group.',
  },
  Uruguay: {
    flag: {
      stripes: [
        { color: WHITE },
        { color: '#0038A8' },
        { color: WHITE },
        { color: '#0038A8' },
        { color: WHITE },
        { color: '#0038A8' },
        { color: WHITE },
        { color: '#0038A8' },
        { color: WHITE },
      ],
      canton: { color: WHITE, w: 0.36, h: 5 / 9, dot: '#FCD116' },
    },
    word: 'ta',
    meaning: 'OK',
    fact: 'Uruguay won the very first football World Cup, in 1930.',
  },
  Paraguay: {
    flag: { stripes: [{ color: '#D52B1E' }, { color: WHITE }, { color: '#0038A8' }], dot: '#3A7D44' },
    word: 'guapo',
    meaning: 'hard-working (in Paraguay!)',
    fact: 'Most Paraguayans speak two languages: Spanish and Guaraní.',
  },
  Venezuela: {
    flag: { stripes: [{ color: '#FFCC00' }, { color: '#00247D' }, { color: '#CF142B' }] },
    word: 'chamo',
    meaning: 'friend, kid',
    fact: 'Angel Falls in Venezuela is the highest waterfall in the world.',
  },
};

/** A flag, `height` tall and 3:2. `muted` draws it as a grey outline. */
export function Flag({ spec, height, muted = false }: { spec: FlagSpec; height: number; muted?: boolean }) {
  const width = Math.round(height * 1.5);
  if (muted) {
    return <View style={[styles.frame, styles.muted, { height, width }]} />;
  }
  const dir = spec.dir ?? 'h';
  const total = (spec.stripes ?? []).reduce((n, s) => n + (s.weight ?? 1), 0) || 1;
  return (
    <View style={[styles.frame, { height, width }]}>
      {spec.stripes && (
        <View style={[StyleSheet.absoluteFill, { flexDirection: dir === 'h' ? 'column' : 'row' }]}>
          {spec.stripes.map((s, i) => (
            <View key={i} style={{ backgroundColor: s.color, flex: (s.weight ?? 1) / total }} />
          ))}
        </View>
      )}
      {spec.quarters && (
        <View style={[StyleSheet.absoluteFill, styles.quarters]}>
          {spec.quarters.map((c, i) => (
            <View key={i} style={{ backgroundColor: c, height: '50%', width: '50%' }} />
          ))}
          {spec.cross && (
            <>
              <View style={[styles.crossV, { backgroundColor: spec.cross, left: width / 2 - height * 0.08 }, { width: height * 0.16 }]} />
              <View style={[styles.crossH, { backgroundColor: spec.cross, top: height / 2 - height * 0.08 }, { height: height * 0.16 }]} />
            </>
          )}
        </View>
      )}
      {spec.triangle && (
        <View
          style={{
            borderBottomColor: 'transparent',
            borderBottomWidth: height / 2,
            borderLeftColor: spec.triangle,
            borderLeftWidth: width * 0.45,
            borderTopColor: 'transparent',
            borderTopWidth: height / 2,
            height: 0,
            left: 0,
            position: 'absolute',
            top: 0,
            width: 0,
          }}
        />
      )}
      {spec.canton && (
        <View
          style={[
            styles.canton,
            { backgroundColor: spec.canton.color, height: height * spec.canton.h, width: width * spec.canton.w },
          ]}
        >
          {spec.canton.dot && (
            <View style={[styles.dot, { backgroundColor: spec.canton.dot, height: height * 0.18, width: height * 0.18 }]} />
          )}
        </View>
      )}
      {spec.dot && (
        <View
          style={[
            styles.dot,
            styles.centre,
            {
              backgroundColor: spec.dot,
              height: height * 0.26,
              left: width / 2 - height * 0.13,
              top: height / 2 - height * 0.13,
              width: height * 0.26,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 3, overflow: 'hidden' },
  muted: { borderColor: 'rgba(242,245,243,0.2)', borderStyle: 'dashed', borderWidth: 1 },
  quarters: { flexDirection: 'row', flexWrap: 'wrap' },
  crossV: { bottom: 0, position: 'absolute', top: 0 },
  crossH: { left: 0, position: 'absolute', right: 0 },
  canton: { alignItems: 'center', justifyContent: 'center', left: 0, position: 'absolute', top: 0 },
  dot: { borderRadius: 999 },
  centre: { position: 'absolute' },
});

/**
 * A LOCAL WORD AND A FACT FOR EVERY CITY (Radek, 2026-09-30: "a local word
 * or interesting fact for every city, not just country, so it's not
 * boring"). Real, everyday, non-vulgar words people say there — several are
 * regional or from a language spoken alongside Spanish, and the meaning
 * says so. Keys match roadmap.ts TRIP's `city`.
 */
export type LocalWord = { word: string; meaning: string };

export const CITIES: Record<string, { word: LocalWord; fact: string }> = {
  Madrid: {
    word: { word: '¡vale!', meaning: 'OK, sure' },
    fact: 'Botín, open since 1725, is said to be the oldest restaurant in the world.',
  },
  Sevilla: {
    word: { word: '¡illo!', meaning: 'hey, mate (Andalusian)' },
    fact: 'Seville’s cathedral is the largest Gothic cathedral in the world.',
  },
  Barcelona: {
    word: { word: 'bon dia', meaning: 'good morning (in Catalan, spoken there too)' },
    fact: 'Gaudí’s Sagrada Família has been under construction since 1882.',
  },
  Valencia: {
    word: { word: 'horchata', meaning: 'a cold tiger-nut drink' },
    fact: 'Paella was born here, cooked over a fire in the rice fields.',
  },
  Granada: {
    word: { word: 'tapa', meaning: 'a small snack' },
    fact: 'In Granada a free tapa usually comes with every drink you order.',
  },
  'Ciudad de México': {
    word: { word: '¿qué onda?', meaning: 'what’s up?' },
    fact: 'It is one of the cities with the most museums in the world.',
  },
  Oaxaca: {
    word: { word: 'mole', meaning: 'a rich chilli and chocolate sauce' },
    fact: 'Oaxaca is known as the land of the seven moles.',
  },
  Guadalajara: {
    word: { word: 'tapatío', meaning: 'someone from Guadalajara' },
    fact: 'Mariachi music and tequila both come from the region around it.',
  },
  Cancún: {
    word: { word: 'playa', meaning: 'beach' },
    fact: 'Cancún was a quiet sand island until it was built as a resort in the 1970s.',
  },
  'La Habana': {
    word: { word: '¿qué bolá?', meaning: 'what’s up? (Cuban)' },
    fact: 'The Malecón, Havana’s seafront wall, runs for about 8 km.',
  },
  'San Juan': {
    word: { word: '¡wepa!', meaning: 'yay! (Puerto Rican)' },
    fact: 'Old San Juan’s blue cobblestones are said to have come as ballast on Spanish ships.',
  },
  'Santo Domingo': {
    word: { word: '¿qué lo que?', meaning: 'what’s up? (Dominican)' },
    fact: 'Merengue music was born in the Dominican Republic.',
  },
  'Ciudad de Guatemala': {
    word: { word: '¡qué chilero!', meaning: 'how cool! (Guatemalan)' },
    fact: 'The city is ringed by volcanoes, and some of them are still active.',
  },
  'San José': {
    word: { word: 'tuanis', meaning: 'cool (Costa Rican)' },
    fact: 'Addresses are often given by landmarks, like “100 metres north of the church”.',
  },
  Panamá: {
    word: { word: '¿qué xopá?', meaning: 'what’s up? (Panamanian)' },
    fact: 'Panama City has a rainforest park inside its city limits.',
  },
  Bogotá: {
    word: { word: '¡qué oso!', meaning: 'how embarrassing!' },
    fact: 'Every Sunday, over 100 km of streets close to cars for the Ciclovía.',
  },
  Medellín: {
    word: { word: 'parce', meaning: 'buddy' },
    fact: 'It is called the City of Eternal Spring for its mild weather all year.',
  },
  Cartagena: {
    word: { word: '¡ajá!', meaning: 'the coast’s all-purpose “well…” / “so…”' },
    fact: 'Its old town is ringed by stone walls built to keep out pirates.',
  },
  Quito: {
    word: { word: '¡achachay!', meaning: 'brr, it’s cold! (from Kichwa)' },
    fact: 'At about 2,850 metres, Quito is one of the highest capitals in the world.',
  },
  Lima: {
    word: { word: 'pata', meaning: 'friend (Peruvian)' },
    fact: 'Ceviche, raw fish “cooked” in lime juice, is Lima’s pride.',
  },
  Cusco: {
    word: { word: '¡achalay!', meaning: 'how lovely! (from Quechua)' },
    fact: 'Cusco was the capital of the Inca Empire.',
  },
  'La Paz': {
    word: { word: '¡jallalla!', meaning: 'cheers, long live! (from Aymara)' },
    fact: 'Cable cars are part of everyday public transport in La Paz.',
  },
  Santiago: {
    word: { word: '¿cachai?', meaning: 'get it? (Chilean)' },
    fact: 'On a clear day the snowy Andes rise right behind the city.',
  },
  Valparaíso: {
    word: { word: 'cerro', meaning: 'hill' },
    fact: 'Century-old funicular lifts still carry people up its steep hills.',
  },
  Mendoza: {
    word: { word: 'bodega', meaning: 'winery' },
    fact: 'Mendoza makes most of Argentina’s wine, especially Malbec.',
  },
  Córdoba: {
    word: { word: 'fernet', meaning: 'the city’s favourite drink, with cola' },
    fact: 'Its university, founded in 1613, is one of the oldest in the Americas.',
  },
  'Buenos Aires': {
    word: { word: '¡che!', meaning: 'hey! (Argentinian)' },
    fact: 'Tango was born in the port neighbourhoods of Buenos Aires.',
  },
  Montevideo: {
    word: { word: 'bo', meaning: 'hey, you (Uruguayan)' },
    fact: 'Its riverside promenade, the Rambla, runs for about 22 km.',
  },
  Asunción: {
    word: { word: '¿mba’éichapa?', meaning: 'how are you? (in Guaraní)' },
    fact: 'Founded in 1537, it is one of the oldest cities in South America.',
  },
  Caracas: {
    word: { word: '¡epa!', meaning: 'hey there!' },
    fact: 'The green Mount Ávila rises right above the city.',
  },
};

/**
 * A CITY'S LOCAL WORD AND ITS FACT. THE ONE SOURCE for every local word in
 * the app: the arrival, the postcard, the map's banner and city panel, the
 * passport, the notifications. The country-level word in COUNTRIES is no
 * longer shown. ONE word per city (Radek, 2026-10-04, after two weeks of
 * two: "one word is better" — a second word took attention from the path).
 */
export function localFor(city: string): { word: LocalWord; fact: string } | null {
  return CITIES[city] ?? null;
}

/** A country's two strongest flag colours (white skipped), for tints, coasts and stamps. */
export function flagColours(country: string): [string, string] {
  const f = COUNTRIES[country]?.flag;
  const all = [
    ...(f?.stripes?.map((st) => st.color) ?? []),
    ...(f?.quarters ?? []),
    f?.triangle,
    f?.canton?.color,
    f?.dot,
  ].filter((c): c is string => !!c && c.toUpperCase() !== '#FFFFFF');
  const first = all[0] ?? '#5ee6a8';
  const second = all.find((c) => c !== first) ?? first;
  return [first, second];
}
