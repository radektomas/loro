'use client';

import Image from 'next/image';
import { useState, type FormEvent } from 'react';

type FormPhase = 'idle' | 'loading' | 'success' | 'alreadyJoined';

type WaitlistFormProps = {
  /** Which of the two page forms this is — recorded in loro_waitlist.source. */
  source: 'landing-hero' | 'landing-final';
  /** Final-CTA form centres itself; the hero form is left-aligned. */
  align?: 'start' | 'center';
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The /join email capture — the ONLY client component on the page (plus
 * nothing else; the phone mockup animates in pure CSS). Success and
 * already-joined replace the form entirely, so the end state is calm: a
 * parrot and one sentence, no dead controls left behind.
 */
export function WaitlistForm({ source, align = 'start' }: WaitlistFormProps) {
  const [phase, setPhase] = useState<FormPhase>('idle');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const centered = align === 'center';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === 'loading') return;

    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      setError('Enter a valid email address.');
      return;
    }

    const form = event.currentTarget;
    const honeypot =
      (new FormData(form).get('website') as string | null) ?? '';

    setError(null);
    setPhase('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalized,
          consent,
          website: honeypot,
          source,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        alreadyJoined?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        setPhase('idle');
        return;
      }
      setPhase(data.alreadyJoined ? 'alreadyJoined' : 'success');
    } catch {
      setError('Something went wrong. Please try again.');
      setPhase('idle');
    }
  }

  if (phase === 'success' || phase === 'alreadyJoined') {
    return (
      <div
        className={`flex items-center gap-4 ${centered ? 'justify-center' : ''}`}
        role="status"
      >
        <Image
          src="/brand/loro-mascot-waving.png"
          alt=""
          width={500}
          height={560}
          className="h-16 w-auto shrink-0"
        />
        <div className={centered ? 'text-left' : ''}>
          <p className="text-lg font-semibold tracking-tight text-text">
            {phase === 'success'
              ? 'You’re in. See you August 30.'
              : 'You’re already on the list.'}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            The beta is open in the meantime — keep scrolling real Spanish.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className={centered ? 'mx-auto max-w-lg' : 'max-w-lg'}>
      {/* Honeypot — visually removed, still submittable by bots. */}
      <div aria-hidden="true" className="absolute -m-px h-px w-px overflow-hidden whitespace-nowrap [clip-path:inset(50%)]">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor={`email-${source}`} className="sr-only">
            Email address
          </label>
          <input
            id={`email-${source}`}
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            className={`h-[52px] w-full rounded-2xl bg-surface px-5 text-base text-text outline-none ring-1 transition-shadow placeholder:text-muted/60 focus:ring-2 ${
              error
                ? 'ring-red-400/60 focus:ring-red-400/60'
                : 'ring-white/10 focus:ring-white/30'
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={phase === 'loading'}
          className="relative h-[52px] shrink-0 rounded-2xl bg-[var(--loro-crest)] px-6 text-base font-semibold text-white transition-[filter,transform] duration-150 hover:-translate-y-px hover:brightness-110 disabled:hover:translate-y-0 disabled:hover:brightness-100"
        >
          {/* The label keeps its width while loading — no layout shift. */}
          <span className={phase === 'loading' ? 'invisible' : undefined}>
            Claim founding member spot
          </span>
          {phase === 'loading' && (
            <span className="absolute inset-0 flex items-center justify-center">
              <svg
                className="h-5 w-5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-label="Sending"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeOpacity="0.3"
                  strokeWidth="3"
                />
                <path
                  d="M21 12a9 9 0 0 0-9-9"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          )}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <label
        className={`mt-3 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-muted ${
          centered ? 'justify-center text-center sm:items-center' : ''
        }`}
      >
        <input
          type="checkbox"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-[#f4f7f4]"
        />
        <span>
          I agree to receive launch updates about Loro. Unsubscribe anytime.
        </span>
      </label>
    </form>
  );
}
