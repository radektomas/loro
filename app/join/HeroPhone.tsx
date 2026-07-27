import Image from 'next/image';
import { BookmarkIcon } from '@/components/icons/Icons';

/**
 * The hero's proof-it's-real: the actual feed, recomposed as static markup.
 *
 * Nothing here is illustration. The frame is the real thumbnail of the
 * CC-licensed travel Short "-NSeE7KmIzw" (Viajamos Juntos — three places in
 * Córdoba, Argentina; credited in the page footer), the subtitle line is that
 * video's REAL cue with SubtitleTrack's exact type treatment, and the sheet
 * peeking from the bottom is WordSheet's layout carrying its real dictionary
 * entry (paraíso → "paradise"). The walking karaoke highlight is pure CSS
 * (join-word-cycle, staggered inline delays) — zero client JS.
 */

/** Cue 2 of the clip, word-for-word (9 words × 1.2s = the 10.8s CSS cycle). */
const WORDS = ['paraíso', 'a', 'solo', '45', 'minutos', 'del', 'centro', 'de', 'Córdoba'];
const TRANSLATION = 'paradise just 45 minutes from downtown Córdoba';

/** Index of the word the peeking WordSheet explains (static highlight when
    reduced motion turns the cycle off). */
const TAPPED = 0;

export function HeroPhone() {
  return (
    // Float (outer) and 3D tilt (inner) are separate wrappers because both
    // are transforms — combined on one element, the animation would override
    // the tilt.
    <div className="join-phone-float relative mx-auto w-[272px] sm:w-[300px]">
      {/* soft ground shadow the float bobs over */}
      <div
        aria-hidden
        className="absolute left-1/2 top-[97%] h-14 w-52 -translate-x-1/2 rounded-full bg-black/70 blur-2xl"
      />
      <div className="join-phone-tilt">
        {/* Device: CSS-drawn. A brushed-edge gradient rim around a black
            bezel — the two-layer frame is what reads as machined metal. */}
        <div className="rounded-[3.2rem] bg-gradient-to-br from-[#565a57] via-[#232624] to-[#0a0b0a] p-[3px] shadow-[0_28px_56px_-16px_rgba(0,0,0,0.75)]">
          <div className="relative rounded-[3rem] bg-black p-2.5">
            {/* side buttons */}
            <div aria-hidden className="absolute -left-[5px] top-24 h-9 w-[3px] rounded-l-md bg-[#3d403e]" />
            <div aria-hidden className="absolute -left-[5px] top-36 h-14 w-[3px] rounded-l-md bg-[#3d403e]" />
            <div aria-hidden className="absolute -right-[5px] top-28 h-16 w-[3px] rounded-r-md bg-[#3d403e]" />
            <div className="relative aspect-[9/19] overflow-hidden rounded-[2.4rem] bg-surface">
          <Image
            src="/posters/yt-viajamos-juntos.jpg"
            alt=""
            fill
            sizes="300px"
            priority
            className="object-cover"
          />
          {/* Legibility gradient, same job as the feed's. */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/40 to-transparent"
          />

          {/* Subtitle track — SubtitleTrack's type, scaled to the mockup. */}
          <div className="absolute inset-x-0 bottom-[112px] px-3">
            <p className="flex flex-wrap items-center gap-y-0.5 text-[15px] font-bold leading-[1.35] tracking-tight text-text [text-shadow:0_1px_12px_rgba(0,0,0,0.75)]">
              {WORDS.map((word, i) => (
                <span
                  key={`${word}-${i}`}
                  className={`join-cycle-word rounded-lg px-1 py-0.5 ${
                    i === TAPPED ? 'join-static-highlight' : ''
                  }`}
                  style={{ animationDelay: `${i * 1.2}s` }}
                >
                  {word}
                </span>
              ))}
            </p>
            <p className="mt-1 px-1 text-[11px] leading-relaxed text-text/70 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
              {TRANSLATION}
            </p>
          </div>

          {/* WordSheet peeking — real entry, cropped mid-button by the screen
              edge so it reads as risen-from-the-bottom, not a card. */}
          <div className="absolute inset-x-0 -bottom-9 rounded-t-[1.5rem] bg-surface-raised px-4 pt-2.5">
            <div aria-hidden className="mx-auto h-1 w-9 rounded-full bg-white/15" />
            <div className="mt-2.5 flex items-start justify-between">
              <div>
                <p className="text-xl font-bold tracking-tight text-text">
                  paraíso
                </p>
                <p className="mt-0.5 text-sm font-semibold text-accent">
                  paradise
                </p>
                <p className="mt-1 text-[10px] text-muted">noun</p>
              </div>
              <Image
                src="/brand/loro-mascot.png"
                alt=""
                width={377}
                height={560}
                className="h-11 w-auto shrink-0"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-2xl bg-accent py-2.5 text-xs font-semibold text-background">
              <BookmarkIcon width={13} height={13} />
              Save word
            </div>
          </div>

              {/* glass: a diagonal sheen plus a hairline inner rim, above
                  everything on screen — it is the screen's surface */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(115deg,rgba(255,255,255,0.10),rgba(255,255,255,0.03)_30%,transparent_48%)]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10 rounded-[2.4rem] ring-1 ring-inset ring-white/10"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
