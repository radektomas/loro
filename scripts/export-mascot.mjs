#!/usr/bin/env node
/**
 * Export Loro's mascot to clean PNGs for Instagram / branding.
 *
 *   node scripts/export-mascot.mjs
 *
 * The mascot lives in components/LoroMascot.tsx as JSX whose fills use CSS
 * custom properties (var(--accent, …)), which a standalone SVG rasterizer
 * can't resolve. So we mirror that exact geometry here with the design-token
 * colours resolved to hex, build a self-contained SVG per state, and rasterize
 * with sharp — no browser or dev server needed, and the output is crisp vector
 * art rather than a screenshot.
 *
 * Keep this in sync with components/LoroMascot.tsx if the drawing ever changes.
 */

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

// Design tokens (globals.css :root) resolved to hex — these are the fallbacks
// baked into the component's var() fills.
const C = {
  accent: '#58cc4e', // body / head
  accentDeep: '#3d8b40', // tail / wing
  belly: '#a8e89f',
  crest: '#d14b3c', // red crest
  face: '#f3f9ef',
  eye: '#1c2a1e',
  beak: '#f5a623',
  beakDark: '#d98c12',
  background: '#0a0d0b', // app dark background
};

/**
 * The mascot's inner SVG elements for a given state — a faithful mirror of
 * LoroMascot.tsx (idle | happy). 'sleeping' isn't exported (none of the target
 * files use it), so only idle/happy branches are reproduced here.
 */
function mascotInner(state) {
  const happy = state === 'happy';

  const wing = happy
    ? `<ellipse cx="26" cy="42" rx="10" ry="16" fill="${C.accentDeep}" transform="rotate(-40 26 42)"/>`
    : `<ellipse cx="31" cy="56" rx="10" ry="16" fill="${C.accentDeep}" transform="rotate(-12 31 56)"/>`;

  const crestTransform = happy
    ? ' transform="translate(0 -2.5) rotate(-6 56 14)"'
    : '';

  const eye = `<circle cx="62" cy="29" r="${happy ? 4.5 : 3.5}" fill="${C.eye}"/><circle cx="63.5" cy="27.5" r="1.3" fill="#ffffff"/>`;

  const beak = happy
    ? `<path d="M72 30 Q84 30 78 38 L70 35 Z" fill="${C.beak}"/><path d="M71 37 Q80 42 73 44 L69 39 Z" fill="${C.beakDark}"/>`
    : `<path d="M72 28 Q86 32 74 42 L69 34 Z" fill="${C.beak}"/>`;

  return [
    // tail
    `<path d="M38 70 L26 90 L44 78 Z" fill="${C.accentDeep}"/>`,
    // body
    `<ellipse cx="48" cy="54" rx="24" ry="28" fill="${C.accent}"/>`,
    // belly
    `<ellipse cx="50" cy="62" rx="13" ry="16" fill="${C.belly}"/>`,
    // wing
    wing,
    // red crest — three angular feathers
    `<g fill="${C.crest}"${crestTransform}><path d="M50 17 L42 5 L53 12 Z"/><path d="M53 15 L54 0 L60 13 Z"/><path d="M59 14 L66 5 L63 15 Z"/></g>`,
    // head
    `<circle cx="56" cy="30" r="18" fill="${C.accent}"/>`,
    // face patch
    `<circle cx="62" cy="30" r="10" fill="${C.face}"/>`,
    // eye
    eye,
    // beak
    beak,
    // feet
    `<path d="M42 81 L42 88 M50 82 L50 89" stroke="${C.beak}" stroke-width="4" stroke-linecap="round"/>`,
  ].join('');
}

/** Wrap the mascot in a sized SVG document with an optional background. */
function svgDoc({ state, size, viewBox, background }) {
  const [mx, my, mw, mh] = viewBox;
  const bg = background
    ? `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" fill="${background}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${mx} ${my} ${mw} ${mh}">${bg}${mascotInner(state)}</svg>`;
}

// Framing windows into the 0..96 coordinate space.
const FULL_BODY = [-6, -6, 108, 108]; // whole parrot + small margin
const PADDED = [-18, -14, 132, 132]; // extra breathing room for social squares
const HEAD = [30, -2, 58, 58]; // cropped to head + crest + beak (profile pic)

const OUTPUTS = [
  { file: 'loro-mascot-idle.png', size: 1024, state: 'idle', viewBox: FULL_BODY },
  { file: 'loro-mascot-happy.png', size: 1024, state: 'happy', viewBox: FULL_BODY },
  { file: 'loro-mascot-head.png', size: 1024, state: 'idle', viewBox: HEAD },
  {
    file: 'loro-mascot-square-dark.png',
    size: 1080,
    state: 'idle',
    viewBox: PADDED,
    background: C.background,
  },
  {
    file: 'loro-mascot-square-green.png',
    size: 1080,
    state: 'idle',
    viewBox: PADDED,
    background: C.accent,
  },
];

async function main() {
  const root = path.resolve(fileURLToPath(import.meta.url), '../..');
  const outDir = path.join(root, 'branding');
  await mkdir(outDir, { recursive: true });

  for (const out of OUTPUTS) {
    const svg = svgDoc(out);
    const dest = path.join(outDir, out.file);
    await sharp(Buffer.from(svg))
      .resize(out.size, out.size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(dest);
    console.log(`  ✓ ${out.file}  (${out.size}×${out.size})`);
  }

  console.log(`\nDone — ${OUTPUTS.length} files in ${outDir}`);
}

main().catch((err) => {
  console.error('export-mascot failed:', err);
  process.exit(1);
});
