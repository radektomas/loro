import { LoroMascot } from '@/components/LoroMascot';

/**
 * Standalone brand/export preview — deliberately NOT linked in navigation.
 *
 * Shows Loro (with the red crest) large in all three states plus a cropped
 * head for the profile picture, on a checkerboard so transparency reads
 * clearly. The shipped PNGs come from scripts/export-mascot.mjs; this page is
 * for eyeballing the mascot and as a headless-screenshot fallback target
 * (each figure carries a data-mascot id).
 */

const CHECKER =
  'repeating-conic-gradient(#3a423c 0% 25%, #2b322d 0% 50%) 50% / 28px 28px';

export default function BrandPage() {
  return (
    <main
      className="min-h-[100dvh] px-6 py-16 text-center"
      style={{ background: CHECKER }}
    >
      <h1 className="text-2xl font-bold tracking-tight text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
        Loro — brand mascot
      </h1>
      <p className="mt-2 text-sm text-white/80 [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
        Transparent exports live in <code>/branding</code> (run{' '}
        <code>node scripts/export-mascot.mjs</code>).
      </p>

      <div className="mx-auto mt-14 flex max-w-4xl flex-wrap items-end justify-center gap-10">
        {(['idle', 'happy', 'sleeping'] as const).map((state) => (
          <figure
            key={state}
            data-mascot={state}
            className="flex flex-col items-center gap-3"
          >
            <LoroMascot state={state} size={220} />
            <figcaption className="text-sm font-semibold uppercase tracking-widest text-white/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
              {state}
            </figcaption>
          </figure>
        ))}
      </div>

      {/* Cropped head — profile picture */}
      <div className="mt-16 flex flex-col items-center gap-3">
        <div
          data-mascot="head"
          className="relative h-56 w-56 overflow-hidden rounded-full ring-1 ring-white/20"
        >
          <div className="absolute" style={{ left: -149, top: -28 }}>
            <LoroMascot state="idle" size={448} />
          </div>
        </div>
        <p className="text-sm font-semibold uppercase tracking-widest text-white/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
          head · profile picture
        </p>
      </div>
    </main>
  );
}
