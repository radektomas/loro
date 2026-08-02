'use client';

import { useEffect, useState } from 'react';
import { authEnabled, getSession, onAuthChange, signInWithGoogle, signInWithMagicLink } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { savePromptVariant } from '@loro/core/savePrompt';
import { Sheet } from '@/components/Sheet';

/**
 * The one account nudge Loro ever shows — "save the progress you already
 * have", never a signup gate. Mounted ONLY by the vocab screen: the feed is
 * the product and is never interrupted (lib/savePrompt.ts encodes the same
 * rule, so even a future mis-mount decides null outside 'vocab').
 *
 * Auth goes through the same lib/auth entry points as SignInCard (magic
 * link + Google) — no duplicated sign-in logic. Conversion is recorded by
 * the sync engine when the session actually arrives (the magic link may
 * complete in another tab), not optimistically here.
 *
 * Both actions are deliberately equal-weight buttons: a buried skip juices
 * signups short-term and wrecks retention; dismissing is genuinely free.
 */

const COPY = {
  cs: {
    title1: (n: number) => `Máš uložených ${n} slovíček. Ulož si je, ať o ně nepřijdeš.`,
    title2: (n: number) => `Už máš ${n} slovíček. Poslední připomínka — pak se už nezeptáme.`,
    body: 'S účtem tvoje slovíčka a postup přežijí i nové zařízení — a neztratí se, když prohlížeč promaže data.',
    google: 'Pokračovat přes Google',
    emailPlaceholder: 'tvůj e-mail',
    sendLink: 'Poslat přihlašovací odkaz',
    sent: 'Hotovo — koukni do e-mailu.',
    skip: 'Pokračovat bez účtu',
    error: 'Něco se nepovedlo.',
  },
  en: {
    title1: (n: number) => `You have ${n} saved words. Keep them safe.`,
    title2: (n: number) => `${n} words saved. Last reminder — we won't ask again.`,
    body: "With an account your words and progress survive a new device — and aren't lost if the browser clears its data.",
    google: 'Continue with Google',
    emailPlaceholder: 'your email',
    sendLink: 'Email me a sign-in link',
    sent: 'Done — check your email.',
    skip: 'Continue without an account',
    error: 'Something went wrong.',
  },
} as const;

export function SavePromptSheet() {
  const [variant, setVariant] = useState<1 | 2 | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decide once, when the vocab screen mounts. The catalog carries cs/de/en/fr
  // gloss languages but the app's UI is English; Czech is the one localized
  // copy set (de/fr fall back to English like the rest of the UI).
  const t = COPY[storage.getLanguage() === 'cs' ? 'cs' : 'en'];

  useEffect(() => {
    if (!authEnabled) return;
    let cancelled = false;
    void getSession().then((session) => {
      if (cancelled) return;
      // Words we GRANTED don't count toward the thresholds — the deck hands
      // out 9 and the first prompt fires at 10, so counting them would mean a
      // beginner's first real save trips the ask. Same counter as the
      // free-tier ceiling (storage.getCountedSavedWords -> countedSaved), so
      // the two gates can never drift into counting different things. This is
      // also the measurement payload recorded below.
      const savedCount = storage.getCountedSavedWords();
      const v = savePromptVariant(storage.getSavePromptState(), {
        signedIn: session !== null,
        savedCount,
        surface: 'vocab',
      });
      if (v) {
        storage.recordSavePromptShown(v, savedCount);
        setWordCount(savedCount);
        setVariant(v);
      }
    });
    // Sign-in completing (this tab or via the magic link) closes the sheet;
    // the sync engine marks the pending prompt converted.
    const off = onAuthChange((session) => {
      if (session) setVariant(null);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (variant === null) return null;

  const dismiss = () => {
    storage.recordSavePromptOutcome(variant, 'dismissed');
    setVariant(null);
  };

  const handleGoogle = async () => {
    setError(null);
    const res = await signInWithGoogle();
    if (!res.ok) setError(res.error ?? t.error);
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    const res = await signInWithMagicLink(email);
    setSending(false);
    if (res.ok) setSent(true);
    else setError(res.error ?? t.error);
  };

  return (
    <div className="fixed inset-0 z-40">
      <Sheet onClose={dismiss}>
        <div className="pb-4">
          <h3 className="text-base font-bold leading-snug text-text">
            {variant === 1 ? t.title1(wordCount) : t.title2(wordCount)}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t.body}</p>

          {sent ? (
            <p className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm font-medium text-accent">
              {t.sent}
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleGoogle()}
                className="mt-4 w-full rounded-full bg-accent px-4 py-3 text-sm font-semibold text-background transition-transform active:scale-[0.99]"
              >
                {t.google}
              </button>
              <form onSubmit={handleMagicLink} className="mt-2 flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  autoComplete="email"
                  className="min-w-0 flex-1 rounded-full border border-text/15 bg-surface px-4 py-3 text-sm text-text outline-none focus:border-accent/60"
                />
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  className="shrink-0 rounded-full bg-white/10 px-4 py-3 text-sm font-semibold text-text disabled:opacity-40"
                >
                  {t.sendLink}
                </button>
              </form>
            </>
          )}

          {error && (
            <p className="mt-2 text-xs text-red-400" role="alert">
              {error}
            </p>
          )}

          {/* Equal-weight skip — same size and solidity as the primary. */}
          <button
            type="button"
            onClick={dismiss}
            className="mt-2 w-full rounded-full bg-white/10 px-4 py-3 text-sm font-semibold text-text transition-transform active:scale-[0.99]"
          >
            {t.skip}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
