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
    <div className="rotate-[2.5deg]">
      {/* Device: CSS-drawn, thin bezel, no notch drama. */}
      <div className="mx-auto w-[272px] rounded-[3rem] bg-black p-2.5 shadow-sm ring-1 ring-white/15 sm:w-[300px]">
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
        </div>
      </div>
    </div>
  );
}
