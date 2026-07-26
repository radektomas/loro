import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import './join/join.css';
import { CheckIcon } from '@/components/icons/Icons';
import { HeroPhone } from './join/HeroPhone';
import { WaitlistForm } from './join/WaitlistForm';

/**
 * / — pre-launch landing for the founding-member offer (launch: Aug 30).
 * Promoted from /join to the root (2026-07-27); /join now redirects here
 * (next.config.ts) and the feed lives at /feed.
 *
 * Server-rendered top to bottom; the only client JS on the page is
 * WaitlistForm. Every product visual is recomposed from the app's real UI —
 * real posters, real cues, real dictionary entries — because "learn from real
 * Spanish" is the claim and the page itself is the evidence. Scroll reveals
 * and the hero's walking highlight are pure CSS (join.css).
 *
 * Colour rule: the app reserves --loro-crest for the mascot (red = wrong
 * answer in the feed). This page is marketing, not feed — the crest is used
 * here on exactly the two CTA buttons and nowhere else.
 */

const DESCRIPTION =
  "Scroll real videos of real people. Tap any word you don't know. Loro remembers it until you do.";

export const metadata: Metadata = {
  title: 'Loro — Learn real Spanish',
  description: DESCRIPTION,
  openGraph: {
    title: 'Loro — Learn real Spanish',
    description: DESCRIPTION,
    url: '/',
    siteName: 'Loro',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Loro — Learn real Spanish',
    description: DESCRIPTION,
  },
};

/* ------------------------------------------------------------- section 2 */

function StepHeading({ n, label, body }: { n: number; label: string; body: string }) {
  return (
    <div className="mt-7">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden
          className="text-4xl font-bold tabular-nums tracking-tight text-white/10"
        >
          {n}
        </span>
        <h3 className="text-xl font-bold tracking-tight text-text">
          <span className="sr-only">Step {n}: </span>
          {label}
        </h3>
      </div>
      <p className="mt-1.5 max-w-[34rem] text-sm leading-relaxed text-muted">
        {body}
      </p>
    </div>
  );
}

/** Visual 1 — a live mini feed: two real travel Shorts stacked, the top card
    nudging up on a loop the way a feed announces the next clip. The second
    card is the hero's waterfall video — the one steps 2 and 3 continue. */
function MiniFeedCard() {
  return (
    <div className="flex h-60 items-end justify-center">
      <div className="h-[13.5rem] w-36 overflow-hidden [mask-image:linear-gradient(to_bottom,black_82%,transparent)]">
        <div className="join-feed-nudge space-y-2">
          <div className="relative aspect-[3/4] w-36 overflow-hidden rounded-2xl">
            <Image
              src="/posters/yt-valle-sagrado.jpg"
              alt=""
              fill
              sizes="144px"
              className="object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 to-transparent"
            />
            <div className="absolute inset-x-0 bottom-0 p-2.5">
              <p className="text-[12px] font-bold leading-snug tracking-tight text-text">
                Así es el recorrido por el Valle Sagrado VIP.
              </p>
              <p className="mt-0.5 text-[9px] leading-snug text-text/70">
                This is the VIP tour of the Sacred Valley.
              </p>
            </div>
          </div>
          {/* the next clip — the waterfall video the other two steps use */}
          <div className="relative aspect-[3/4] w-36 overflow-hidden rounded-2xl">
            <Image
              src="/posters/yt-viajamos-juntos.jpg"
              alt=""
              fill
              sizes="144px"
              className="object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Visual 2 — a tapped word and its WordSheet gloss: the hero clip's cue 3
    and its real dictionary entry (cascadas → waterfalls). The word carries
    the app's own coach-mark pulse (animate-coach, globals.css). */
function TapCard() {
  return (
    <div className="flex h-60 flex-col items-center justify-center px-2 text-center">
      <p className="text-base font-bold leading-[1.4] tracking-tight text-text">
        que te ofrece una paz total con sus{' '}
        <span className="animate-coach rounded-lg bg-accent px-1.5 py-0.5 text-background">
          cascadas
        </span>
      </p>
      <div className="mt-6 w-44 rounded-2xl bg-surface-raised p-3.5 text-left shadow-sm">
        <p className="text-base font-bold tracking-tight text-text">cascadas</p>
        <p className="mt-0.5 text-sm font-semibold text-accent">waterfalls</p>
        <p className="mt-1 text-[10px] text-muted">cascadas → cascada · noun</p>
      </div>
    </div>
  );
}

/** Visual 3 — the SRS recall blank, exactly as SubtitleTrack draws it — and
    it answers itself on a loop: gloss hint fades, "cascadas" types in
    (join.css), the check pops when the word lands. */
function RecallCard() {
  return (
    <div className="flex h-60 flex-col items-center justify-center px-2">
      <p className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2 text-base font-bold leading-[1.4] tracking-tight text-text">
        que te ofrece una paz total con sus
        <span className="inline-flex items-center gap-1.5">
          <span className="relative inline-flex h-8 min-w-24 items-center justify-center border-b-[3px] border-dashed border-accent px-1">
            <span
              aria-hidden
              className="join-type-hint absolute inset-0 flex items-center justify-center text-xs font-medium text-accent/50"
            >
              waterfalls
            </span>
            <span className="join-type-word overflow-hidden whitespace-nowrap text-accent">
              cascadas
            </span>
          </span>
          <span className="join-type-check flex h-7 w-7 items-center justify-center rounded-full bg-accent text-background">
            <CheckIcon width={14} height={14} />
          </span>
        </span>
      </p>
      <p className="mt-5 text-xs leading-relaxed text-muted">
        Your saved word, back in a later video.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- section 3 */

const COMPARISON: ReadonlyArray<{ them: string; loro: string }> = [
  {
    them: 'Streaks that measure opening an app',
    loro: 'Words you actually remember',
  },
  {
    them: 'Sentences no human has ever said',
    loro: 'Spanish the way natives speak it',
  },
  {
    them: 'Points, gems, leagues',
    loro: 'Just you, real videos, and a parrot with a good memory',
  },
];

/* ----------------------------------------------------------------- page */

export default function JoinPage() {
  return (
    <main className="min-h-[100dvh] overflow-x-clip bg-background text-text">
      {/* ------------------------------------------------------------ hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-14 md:pb-24 md:pt-20">
        {/* The phone needs ~340px, no more — everything else is the text's,
            which is what lets the headline hold one sentence per line. */}
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
          <div className="join-reveal order-2 lg:order-1">
            {/* The brand lockup opens the page — modest size, generous air
                below; the headline stays the loudest thing here. */}
            <Image
              src="/brand/loro-logo.png"
              alt="Loro"
              width={880}
              height={436}
              priority
              className="mb-10 h-auto w-40"
            />
            {/* Sized so each sentence holds ONE line from lg up — two clean
                lines beat four ragged ones at a bigger size. */}
            <h1 className="text-[clamp(2.5rem,3.6vw,3.3rem)] font-bold leading-[1.08] tracking-[-0.02em]">
              <span className="block text-text/50">
                Duolingo teaches you the app.
              </span>
              <span className="block">
                Loro teaches you <span className="font-black">real</span>{' '}
                Spanish.
              </span>
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg leading-[1.6] text-muted">
              {DESCRIPTION}
            </p>
            <div className="mt-9">
              <WaitlistForm source="landing-hero" />
              <p className="mt-3 max-w-md text-xs leading-relaxed text-muted/80">
                Free forever premium for the first 100. Loro is in open beta —
                you can try it right now.
              </p>
              <Link
                href="/feed"
                className="mt-5 inline-flex h-11 items-center rounded-2xl px-4 text-sm font-semibold text-text ring-1 ring-white/15 transition-colors duration-150 hover:bg-white/5"
              >
                Try the beta →
              </Link>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <HeroPhone />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          How it works
        </p>
        <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-[-0.02em] md:text-4xl">
          Three things, in the order they happen.
        </h2>
        {/* No card chrome — each visual lives on the page and runs its own
            quiet loop (join.css); the ghost numeral does the step counting. */}
        <div className="join-reveal mt-14 grid gap-14 md:grid-cols-3 md:gap-8">
          <div>
            <MiniFeedCard />
            <StepHeading
              n={1}
              label="Scroll real Spanish"
              body="Short clips from actual Spanish speakers — the feed you already doomscroll, made useful."
            />
          </div>
          <div>
            <TapCard />
            <StepHeading
              n={2}
              label="Tap what you don't know"
              body="Every word is tappable. One tap shows what it means in this exact sentence."
            />
          </div>
          <div>
            <RecallCard />
            <StepHeading
              n={3}
              label="Remember forever"
              body="Saved words return as quick recall moments in later videos, spaced so they stick."
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------- honest comparison */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          The honest comparison
        </p>
        <div className="join-reveal mt-10 space-y-10 md:space-y-12">
          {COMPARISON.map((row) => (
            <div
              key={row.them}
              className="grid gap-2 md:grid-cols-2 md:items-baseline md:gap-16"
            >
              <p className="text-lg leading-snug text-muted/70 md:text-right md:text-xl">
                {row.them}
              </p>
              <p className="max-w-[26rem] text-xl font-semibold leading-snug tracking-tight text-text md:text-2xl">
                {row.loro}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- founder line */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
        <p className="text-xl font-light leading-relaxed text-text/75 md:text-2xl">
          Built by one developer learning Spanish the same way you are.
        </p>
      </section>

      {/* ------------------------------------------------------ final CTA */}
      <section className="mx-auto max-w-3xl px-6 pb-24 pt-4 text-center md:pb-32">
        <div className="join-reveal">
          <Image
            src="/brand/loro-mascot-waving.png"
            alt=""
            width={500}
            height={560}
            className="join-wave mx-auto h-28 w-auto"
          />
          <h2 className="mt-6 text-3xl font-bold tracking-[-0.02em] md:text-4xl">
            Lock in your founding spot.
          </h2>
          <div className="mt-8">
            <WaitlistForm source="landing-final" align="center" />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex items-center justify-between text-sm">
            <Image
              src="/brand/loro-logo.png"
              alt="Loro"
              width={880}
              height={436}
              className="h-auto w-24"
            />
            <div className="flex items-center gap-6 text-xs text-muted">
              <Link
                href="/privacy"
                className="transition-colors duration-150 hover:text-text"
              >
                Privacy
              </Link>
              <span>© 2026</span>
            </div>
          </div>
          {/* CC BY attribution for the two real clips shown above. */}
          <p className="mt-3 text-[10px] leading-relaxed text-muted/60">
            Clips shown:{' '}
            <a
              href="https://www.youtube.com/watch?v=-NSeE7KmIzw"
              className="underline decoration-white/20 underline-offset-2 transition-colors duration-150 hover:text-muted"
            >
              Viajamos Juntos
            </a>{' '}
            and{' '}
            <a
              href="https://www.youtube.com/watch?v=-PtGkAdnh6c"
              className="underline decoration-white/20 underline-offset-2 transition-colors duration-150 hover:text-muted"
            >
              IMachupicchu
            </a>{' '}
            on YouTube (CC BY) — the same real videos you learn from in the
            app.
          </p>
        </div>
      </footer>
    </main>
  );
}
