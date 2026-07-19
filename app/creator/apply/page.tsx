'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  applyAsCreator,
  getMyCreator,
  type Creator,
} from '@/lib/creators';
import {
  GateMessage,
  PageHeader,
  useSupabaseUser,
} from '@/components/creator/ugc';
import { SignInCard } from '@/components/SignInCard';
import { LoroMascot } from '@/components/LoroMascot';
import { CheckIcon } from '@/components/icons/Icons';

const inputCls =
  'w-full rounded-2xl bg-surface px-4 py-3.5 text-base text-text placeholder:text-muted/50 outline-none ring-1 ring-transparent focus:ring-accent/50';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="px-1 text-xs font-semibold uppercase tracking-widest text-muted">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 px-1 text-xs text-muted/60">{hint}</p>}
    </label>
  );
}

/** What the applicant sees once a row exists — one card per status. */
function ApplicationStatus({ creator }: { creator: Creator }) {
  if (creator.status === 'approved') {
    return (
      <div className="rounded-3xl bg-accent-soft p-6 ring-1 ring-accent/25">
        <LoroMascot state="happy" size={72} />
        <h2 className="mt-4 text-lg font-bold text-text">
          You&apos;re a Loro creator
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your application was approved. Upload videos and watch what people
          learn from them.
        </p>
        <Link
          href="/creator"
          className="mt-6 inline-block rounded-2xl bg-accent px-6 py-3 text-base font-semibold text-background transition-transform active:scale-95"
        >
          Go to your dashboard
        </Link>
      </div>
    );
  }
  if (creator.status === 'rejected') {
    return (
      <div className="rounded-3xl bg-surface p-6">
        <h2 className="text-lg font-bold text-text">Application not accepted</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Thanks for applying as{' '}
          <span className="text-text">@{creator.handle}</span> — this one
          didn&apos;t make the cut. Loro is starting with a very small group of
          creators, so this says little about your content.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-3xl bg-surface p-6">
      <LoroMascot state="idle" size={72} />
      <h2 className="mt-4 text-lg font-bold text-text">Application received</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        You applied as <span className="text-text">@{creator.handle}</span> on{' '}
        {new Date(creator.appliedAt).toLocaleDateString()}. We review every
        application by hand — you&apos;ll hear back soon.
      </p>
      <p className="mt-3 rounded-2xl bg-white/5 px-4 py-3 text-xs leading-relaxed text-muted/70">
        Status: <span className="font-semibold text-text">pending review</span>
      </p>
    </div>
  );
}

export default function CreatorApplyPage() {
  const { user, ready } = useSupabaseUser();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState('');
  const [bio, setBio] = useState('');
  const [sampleLink, setSampleLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setCreator(null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    void getMyCreator().then((c) => {
      setCreator(c);
      setLoaded(true);
    });
  }, [ready, user]);

  const handleValid = /^[a-z0-9_.]{3,20}$/.test(handle.trim().toLowerCase());
  const canSubmit =
    displayName.trim().length >= 2 &&
    handleValid &&
    nativeLanguage.trim().length >= 2 &&
    bio.trim().length >= 10 &&
    !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result = await applyAsCreator({
      displayName,
      handle,
      bio,
      nativeLanguage,
      sampleLink,
    });
    setSubmitting(false);
    if (result.ok) setCreator(result.creator);
    else setError(result.error);
  };

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <PageHeader title="Become a creator" />
      <div className="mx-auto max-w-md space-y-6 px-4 pb-10">
        {ready && loaded && !user && (
          <>
            <GateMessage
              title="Sign in to apply"
              body="Creator applications are tied to your Loro account, so sign in first — then this form unlocks."
            />
            <SignInCard />
          </>
        )}

        {ready && loaded && user && creator && (
          <ApplicationStatus creator={creator} />
        )}

        {ready && loaded && user && !creator && (
          <>
            {/* An invited friend lands here knowing nothing about Loro —
                explain the app, their part in it, and what a good clip is,
                in one scannable card. */}
            <div className="rounded-3xl bg-surface p-5">
              <div className="flex items-start gap-3">
                <LoroMascot state="idle" size={48} />
                <p className="min-w-0 text-sm leading-relaxed text-muted">
                  <span className="font-semibold text-text">
                    Loro teaches Spanish with short, real videos.
                  </span>{' '}
                  People watch, tap the words they don&apos;t know, and
                  practice them until they stick. Your clips become the
                  lessons — Loro adds the subtitles and translations
                  automatically.
                </p>
              </div>
              <p className="mt-4 px-1 text-xs font-semibold uppercase tracking-widest text-muted">
                What makes a good clip
              </p>
              <ul className="mt-2 space-y-2">
                {[
                  'Speak naturally, like you’re talking to a friend',
                  'Clear audio — loud background noise fails the automatic quality check',
                  '15–60 seconds, filmed vertically on your phone',
                  'Any everyday topic: food, your street, a story, an opinion',
                ].map((tip) => (
                  <li key={tip} className="flex items-start gap-2.5">
                    <CheckIcon
                      width={14}
                      height={14}
                      className="mt-0.5 shrink-0 text-accent"
                    />
                    <span className="text-sm leading-relaxed text-muted">
                      {tip}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="px-1 text-sm leading-relaxed text-muted">
              Tell us who you are — every application is reviewed by a human.
            </p>
            <form onSubmit={submit} className="space-y-5">
              <Field label="Display name">
                <input
                  className={inputCls}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="María del Barrio"
                  maxLength={50}
                  required
                />
              </Field>
              <Field
                label="Handle"
                hint="3–20 characters: lowercase letters, numbers, dots, underscores."
              >
                <div className="flex items-center gap-1 rounded-2xl bg-surface pl-4 ring-1 ring-transparent focus-within:ring-accent/50">
                  <span className="text-base text-muted">@</span>
                  <input
                    className="w-full bg-transparent py-3.5 pr-4 text-base text-text placeholder:text-muted/50 outline-none"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value.toLowerCase())}
                    placeholder="maria.habla"
                    maxLength={20}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                  />
                </div>
              </Field>
              <Field label="Native language" hint="Language and region, e.g. “Spanish (Mexico)”.">
                <input
                  className={inputCls}
                  value={nativeLanguage}
                  onChange={(e) => setNativeLanguage(e.target.value)}
                  placeholder="Spanish (Mexico)"
                  maxLength={50}
                  required
                />
              </Field>
              <Field label="Short bio" hint="What you'd make videos about, in a sentence or two.">
                <textarea
                  className={`${inputCls} min-h-28 resize-y leading-relaxed`}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Mexico City street food, slow everyday Spanish, one dish per video."
                  maxLength={500}
                  required
                />
              </Field>
              <Field label="Sample content (optional)" hint="A link to something you've already made — TikTok, Instagram, YouTube…">
                <input
                  className={inputCls}
                  type="url"
                  value={sampleLink}
                  onChange={(e) => setSampleLink(e.target.value)}
                  placeholder="https://…"
                  maxLength={300}
                />
              </Field>

              {error && (
                <p className="rounded-2xl bg-[#f87171]/10 px-4 py-3 text-sm text-[#f87171]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full rounded-2xl bg-accent py-3.5 text-base font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-40"
              >
                {submitting ? 'Sending…' : 'Apply'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
