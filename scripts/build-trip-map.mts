/**
 * THE TRIP MAP'S GEOGRAPHY — generates apps/mobile/src/vocab/tripMapData.ts.
 *
 * Radek, 2026-09-30: real shapes and real city positions ("like on a real
 * map"), but not the whole earth — "swipe right and see one after another
 * how the countries and cities in them go". So: the trip's seventeen
 * countries only, laid side by side in trip order on one horizontal strip,
 * each drawn from its real outline (Natural Earth 1:50m, public domain) at
 * its OWN scale — big enough that its cities sit apart, small enough to fit
 * the strip — with its cities at their real positions inside it.
 *
 *   curl -sL -o /tmp/ne50.geojson \
 *     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
 *   node scripts/build-trip-map.mts /tmp/ne50.geojson
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-trip-map.mts <ne_50m_admin_0_countries.geojson>');
  process.exit(1);
}

/** The strip's height; each country's cities are centred on its middle. */
const H = 270;
const MID = H / 2 + 6;
/** A country is fitted into this box, unless its cities need it bigger. */
const FIT_H = 200;
const FIT_W = 300;
/** Nearest two cities of a country at least this far apart (px). */
const CITY_GAP = 56;
/** Scale bounds, px per degree. */
const K_MAX = 70;
/** The widest a country column may get; wider land is cut at the column's edge. */
const MAX_COL = 620;
/** Sea between countries; the Atlantic after Spain. */
const GAP = 64;
const OCEAN = 190;
const START = 96;
const TOL = 0.7;
const PAD = 16;

type P = [number, number];

/** The trip's countries, Natural Earth ADMIN -> the app's name (roadmap.ts TRIP). */
const TRIP_COUNTRIES: Record<string, string> = {
  Spain: 'España',
  Mexico: 'México',
  Cuba: 'Cuba',
  'Puerto Rico': 'Puerto Rico',
  'Dominican Republic': 'República Dominicana',
  Guatemala: 'Guatemala',
  'Costa Rica': 'Costa Rica',
  Panama: 'Panamá',
  Colombia: 'Colombia',
  Ecuador: 'Ecuador',
  Peru: 'Perú',
  Bolivia: 'Bolivia',
  Chile: 'Chile',
  Argentina: 'Argentina',
  Uruguay: 'Uruguay',
  Paraguay: 'Paraguay',
  Venezuela: 'Venezuela',
};

/** Every trip city, [lon, lat], and which side of its pin the name goes. */
type Side = 'above' | 'below' | 'left' | 'right';
const CITIES: Record<string, { at: P; side: Side }> = {
  Madrid: { at: [-3.7, 40.42], side: 'left' },
  Sevilla: { at: [-5.98, 37.39], side: 'left' },
  Barcelona: { at: [2.17, 41.39], side: 'right' },
  Valencia: { at: [-0.38, 39.47], side: 'right' },
  Granada: { at: [-3.6, 37.18], side: 'below' },
  'Ciudad de México': { at: [-99.13, 19.43], side: 'right' },
  Oaxaca: { at: [-96.73, 17.07], side: 'below' },
  Guadalajara: { at: [-103.35, 20.67], side: 'left' },
  Cancún: { at: [-86.85, 21.16], side: 'below' },
  'La Habana': { at: [-82.38, 23.11], side: 'right' },
  'San Juan': { at: [-66.11, 18.47], side: 'right' },
  'Santo Domingo': { at: [-69.93, 18.49], side: 'below' },
  'Ciudad de Guatemala': { at: [-90.51, 14.63], side: 'left' },
  'San José': { at: [-84.09, 9.93], side: 'below' },
  Panamá: { at: [-79.52, 8.98], side: 'below' },
  Bogotá: { at: [-74.07, 4.71], side: 'right' },
  Medellín: { at: [-75.56, 6.25], side: 'left' },
  Cartagena: { at: [-75.51, 10.39], side: 'right' },
  Quito: { at: [-78.47, -0.18], side: 'right' },
  Lima: { at: [-77.04, -12.05], side: 'left' },
  Cusco: { at: [-71.97, -13.53], side: 'right' },
  'La Paz': { at: [-68.15, -16.5], side: 'right' },
  Santiago: { at: [-70.67, -33.45], side: 'below' },
  Valparaíso: { at: [-71.61, -33.05], side: 'left' },
  Mendoza: { at: [-68.83, -32.89], side: 'above' },
  Córdoba: { at: [-64.18, -31.42], side: 'right' },
  'Buenos Aires': { at: [-58.38, -34.6], side: 'below' },
  Montevideo: { at: [-56.16, -34.9], side: 'right' },
  Asunción: { at: [-57.58, -25.26], side: 'right' },
  Caracas: { at: [-66.9, 10.48], side: 'right' },
};

function dp(pts: P[], tol: number): P[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1;
    let best = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * A CLOSED ring: its first and last points coincide, which gives
 * Douglas-Peucker a zero-length baseline and collapses the whole outline.
 * Split it at the point farthest from the start and simplify the two halves.
 */
function simplifyRing(ring: P[], tol: number): P[] {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  if (pts.length < 4) return pts;
  let far = 1;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = dp(pts.slice(0, far + 1), tol);
  const b = dp([...pts.slice(far), pts[0]], tol);
  return [...a, ...b.slice(1, -1)];
}


/** Sutherland-Hodgman against a rectangle. */
function clip(ring: P[], x0: number, x1: number, y0: number, y1: number): P[] {
  const cut = (a: P, b: P, axis: 0 | 1, v: number): P => {
    const t = (v - a[axis]) / (b[axis] - a[axis]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const edges: [(p: P) => boolean, (a: P, b: P) => P][] = [
    [(p) => p[0] >= x0, (a, b) => cut(a, b, 0, x0)],
    [(p) => p[0] <= x1, (a, b) => cut(a, b, 0, x1)],
    [(p) => p[1] >= y0, (a, b) => cut(a, b, 1, y0)],
    [(p) => p[1] <= y1, (a, b) => cut(a, b, 1, y1)],
  ];
  let out = ring;
  for (const [inside, meet] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i - 1 + input.length) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(meet(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(meet(prev, cur));
    }
    if (!out.length) return out;
  }
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (p: P) => `${r1(p[0])} ${r1(p[1])}`;
const bbox = (pts: P[]) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

const geo = JSON.parse(readFileSync(src, 'utf8')) as {
  features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[];
};
const byName = new Map<string, number[][][][]>();
for (const f of geo.features) {
  const trip = TRIP_COUNTRIES[String(f.properties.ADMIN)];
  if (!trip) continue;
  byName.set(trip, (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][]);
}

/** The trip order, read from roadmap.ts's TRIP by way of the city table. */
import { TRIP } from '../packages/core/src/roadmap.ts';
const order: string[] = [];
for (const t of TRIP) if (!order.includes(t.country)) order.push(t.country);

const lands: { country: string; d: string; x0: number; x1: number }[] = [];
const cityXY: Record<string, { x: number; y: number; side: Side }> = {};
const labels: Record<string, [number, number]> = {};
let oceanX = 0;
let cursor = START;

for (const country of order) {
  const polys = byName.get(country);
  if (!polys) throw new Error(`no outline for ${country}`);
  const cities = TRIP.filter((t) => t.country === country).map((t) => ({ name: t.city, ...CITIES[t.city] }));
  const latC = cities.reduce((n, c) => n + c.at[1], 0) / cities.length;
  const cos = Math.cos((latC * Math.PI) / 180);
  const deg = (lon: number, lat: number): P => [lon * cos, -lat];

  // The mainland — the largest outer ring — sets the fit; islands far off
  // (Canarias, Galápagos, Rapa Nui) simply fall outside the strip.
  const outers = polys.map((poly) => poly[0].map(([lon, lat]) => deg(lon, lat)));
  const main = outers
    .map((r) => ({ r, b: bbox(r) }))
    .sort((a, b) => (b.b.x1 - b.b.x0) * (b.b.y1 - b.b.y0) - (a.b.x1 - a.b.x0) * (a.b.y1 - a.b.y0))[0].b;
  const fitK = Math.min(FIT_H / (main.y1 - main.y0), FIT_W / (main.x1 - main.x0));
  let needK = 0;
  for (let i = 0; i < cities.length; i++)
    for (let j = i + 1; j < cities.length; j++) {
      const [ax, ay] = deg(...cities[i].at);
      const [bx, by] = deg(...cities[j].at);
      needK = Math.max(needK, CITY_GAP / Math.hypot(ax - bx, ay - by));
    }
  const k = Math.min(K_MAX, Math.max(fitK, needK));

  // Place: cities centred vertically; the column spans the mainland, cut to
  // MAX_COL around the cities when it is wider than that.
  const cityPx = cities.map((c) => deg(...c.at).map((v) => v * k) as P);
  const cb = bbox(cityPx);
  // A country that fits the strip is centred on its own shape (Spain keeps
  // its north coast); a bigger one is centred on its cities and cut.
  const mainH = (main.y1 - main.y0) * k;
  const dy = mainH <= H - 40 ? MID - ((main.y0 + main.y1) / 2) * k : MID - (cb.y0 + cb.y1) / 2;
  let left = main.x0 * k;
  let right = main.x1 * k;
  if (right - left > MAX_COL) {
    const mid = (cb.x0 + cb.x1) / 2;
    left = Math.max(left, mid - MAX_COL / 2);
    right = Math.min(right, left + MAX_COL);
    left = right - MAX_COL;
  }
  const dx = cursor - left;
  const width = right - left;

  const parts: string[] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const px = ring.map(([lon, lat]) => {
        const [x, y] = deg(lon, lat);
        return [x * k + dx, y * k + dy] as P;
      });
      const b = bbox(px);
      if (b.x1 < cursor - PAD || b.x0 > cursor + width + PAD || b.y1 < -PAD || b.y0 > H + PAD) continue;
      if (b.x1 - b.x0 < 2.5 && b.y1 - b.y0 < 2.5) continue;
      const cut = simplifyRing(clip(px, cursor - PAD, cursor + width + PAD, -PAD, H + PAD), TOL);
      if (cut.length >= 3) parts.push(`M${cut.map(fmt).join('L')}Z`);
    }
  }
  lands.push({ country, d: parts.join(''), x0: r1(cursor), x1: r1(cursor + width) });
  cities.forEach((c, i) => {
    cityXY[c.name] = { x: r1(cityPx[i][0] + dx), y: r1(cityPx[i][1] + dy), side: c.side };
  });
  labels[country] = [r1(cursor + width / 2), H - 16];

  cursor += width;
  if (country === 'España') {
    oceanX = r1(cursor + OCEAN / 2);
    cursor += OCEAN;
  } else cursor += GAP;
}
const W = Math.round(cursor + 60);

const out = `/**
 * GENERATED by scripts/build-trip-map.mts — do not edit by hand.
 * The trip's countries side by side in trip order, each from its real
 * outline (Natural Earth 1:50m admin-0, public domain) at its own scale,
 * cities at their real positions inside it.
 */

export type LabelSide = 'above' | 'below' | 'left' | 'right';

export const MAP_W = ${W};
export const MAP_H = ${H};

/** Trip cities (roadmap.ts TRIP names) in map pixels, with the side their name sits on. */
export const CITY_XY: Record<string, { x: number; y: number; side: LabelSide }> = ${JSON.stringify(cityXY)};

/** Where each country's name is written, under its land. */
export const COUNTRY_LABEL: Record<string, [number, number]> = ${JSON.stringify(labels)};

/** Each country's land, in trip order, and the column it occupies. */
export const LANDS: { country: string; d: string; x0: number; x1: number }[] = ${JSON.stringify(lands)};

/** The middle of the Atlantic, between Spain and Mexico. */
export const OCEAN_X = ${oceanX};
`;
const dest = new URL('../apps/mobile/src/vocab/tripMapData.ts', import.meta.url);
writeFileSync(dest, out);
console.log(`wrote ${dest.pathname}: ${W}x${H}px, ${lands.length} countries, ${(out.length / 1024).toFixed(0)} KB`);
