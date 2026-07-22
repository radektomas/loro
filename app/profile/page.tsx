'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SavedWord } from '@/types';
import { storage } from '@/lib/storage';
import { computeStreaks, weekStrip, type WeekDay } from '@/lib/progress';
import {
  INITIAL_LEVEL_STATE,
  MAX_USER_LEVEL,
  tierFor,
  type LevelState,
} from '@/lib/levels';
import { localVideos } from '@/lib/localVideos';
import { useMyCreator } from '@/components/creator/ugc';
import { Avatar } from '@/components/creator/Avatar';
import { LanguagePicker } from '@/components/LanguagePicker';
import { SignInCard } from '@/components/SignInCard';
import {
  ChevronLeftIcon,
  FilmIcon,
  FlameIcon,
  UploadIcon,
} from '@/components/icons/Icons';

/**
 * /profile — the personal hub, reached from the top-right of the feed.
 *
 * NOT the same thing as /creator/[handle]. That page is public, server
 * rendered and OG-tagged so a creator can share it; this one is private,
 * client-only (it depends on the browser-held session and on localStorage),
 * and shows YOU your own state. Keeping them separate is what lets the
 * public page stay a server component.
 *
 * It is a primary navigation destination, so every viewer state renders
 * something useful — signed out, signed in, mid-application, or approved. It
 * must never 404 or dead-end.
 */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-muted">
      {children}
    </h2>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-3xl bg-surface px-3 py-5 text-center">
      <p className="text-3xl font-bold tabular-nums tracking-tight text-text">
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
    </div>
  );
}

/**
 * The learner's proficiency tier, with progress toward the next one.
 *
 * /profile ONLY. It must never appear on /creator/[handle]: that page belongs
 * to a native speaker, where a Spanish proficiency level would read as
 * nonsense.
 *
 * Both the tier and the meter come from lib/levels — the same state the feed's
 * blue level-blanks drive — so this can never drift from /progress.
 */
function LevelChip({ state }: { state: LevelState }) {
  const tier = tierFor(state.level);
  const atTop = state.level >= MAX_USER_LEVEL;
  const next = tierFor(state.level + 1);
  // Five correct fills fill the meter (+20 each), so this is the honest
  // "what closes the gap" number rather than a percentage.
  const fillsLeft = Math.ceil((100 - state.meter) / 20);

  return (
    <Link
      href="/progress"
      className="mt-2 block rounded-2xl bg-level-soft px-3 py-2 ring-1 ring-level/25 transition-colors hover:bg-level-soft/70"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold tracking-tight text-text">
          {tier.name}
        </span>
        <span className="truncate text-[11px] text-muted">
          &ldquo;{tier.meaning}&rdquo;
        </span>
      </div>
      {!atTop && (
        <>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-level transition-[width] duration-500"
              style={{ width: `${state.meter}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {fillsLeft} more blue {fillsLeft === 1 ? 'word' : 'words'} to{' '}
            {next.name}
          </p>
        </>
      )}
      {atTop && (
        <p className="mt-1 text-[11px] text-muted">Top tier — nothing left to climb.</p>
      )}
    </Link>
  );
}

/**
 * The week, as seven dots. Filled = a day with a correct recall, today gets a
 * ring whether or not it is filled.
 *
 * This is the reason the streak is a card and not a number: a streak that
 * reset to 0 still has real days behind it, and those days stay visible here.
 * Missed days are simply unfilled — never red, never marked.
 */
function WeekStrip({ days }: { days: WeekDay[] }) {
  return (
    <ul className="flex items-end justify-between gap-1">
      {days.map((day) => (
        <li key={day.key} className="flex flex-1 flex-col items-center gap-1.5">
          <span
            aria-hidden
            className={`h-6 w-6 rounded-full ${
              day.active
                ? 'bg-accent'
                : day.isFuture
                  ? 'bg-white/5'
                  : 'bg-white/10'
            } ${day.isToday ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''}`}
          />
          <span
            className={`text-[10px] font-semibold ${
              day.isToday ? 'text-text' : 'text-muted/60'
            }`}
          >
            {/* Duplicate letters (T/T, S/S) are fine as column heads; the
                accessible name below carries the real day. */}
            {day.label}
          </span>
          <span className="sr-only">
            {day.key}
            {day.active ? ' — practised' : ''}
            {day.isToday ? ' (today)' : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A tappable card in the Create section. */
function ActionCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-3xl bg-surface p-5 transition-colors hover:bg-surface-raised"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-text">{title}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-muted">
          {body}
        </span>
      </span>
    </Link>
  );
}

export default function ProfilePage() {
  const { user, creator, ready } = useMyCreator();

  const [words, setWords] = useState<SavedWord[]>([]);
  const [recallDays, setRecallDays] = useState<string[]>([]);
  const [levelState, setLevelState] = useState<LevelState>(INITIAL_LEVEL_STATE);
  const [language, setLanguage] = useState('en');
  const [hydrated, setHydrated] = useState(false);

  const refresh = useCallback(() => {
    setWords(storage.getSavedWords());
    setRecallDays(storage.getCorrectRecallDays());
    setLevelState(storage.getLevelState());
    setLanguage(storage.getLanguage());
  }, []);

  useEffect(() => {
    refresh();
    setHydrated(true);
    return storage.onWordsChanged(refresh);
  }, [refresh]);

  const handleLanguageChange = useCallback((code: string) => {
    setLanguage(code);
    storage.setLanguage(code);
  }, []);

  // Every translation language present in the shipped catalogue — the same
  // rule the feed used when this picker lived in its top bar.
  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const video of localVideos)
      for (const cue of video.cues)
        for (const code of Object.keys(cue.translations)) set.add(code);
    return [...set].sort();
  }, []);

  const totals = useMemo(() => {
    let learned = 0;
    for (const w of words) if (w.state === 'known') learned++;
    return { learned, saved: words.length };
  }, [words]);

  const streak = useMemo(
    () => computeStreaks(recallDays).current,
    [recallDays]
  );
  const week = useMemo(() => weekStrip(recallDays), [recallDays]);
  const activeThisWeek = useMemo(
    () => week.filter((d) => d.active).length,
    [week]
  );

  const displayName = creator?.displayName ?? 'Learner';

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <header className="sticky top-0 z-10 bg-background/85 pt-safe backdrop-blur-md">
        <div className="flex items-center gap-2 px-4 py-4">
          <Link
            href="/"
            aria-label="Back to feed"
            className="rounded-full bg-surface p-2 text-muted transition-colors hover:text-text"
          >
            <ChevronLeftIcon width={20} height={20} />
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-text">Profile</h1>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-8 px-4 pb-10">
        <section className="flex items-start gap-4">
          <Avatar url={creator?.avatarUrl ?? null} name={displayName} size={64} />
          <div className="min-w-0 flex-1 pt-1">
            <p className="truncate text-lg font-bold tracking-tight text-text">
              {displayName}
            </p>
            {creator ? (
              <p className="truncate text-sm text-muted">@{creator.handle}</p>
            ) : (
              <p className="truncate text-sm text-muted">
                Learning Spanish with Loro
              </p>
            )}
            {hydrated && <LevelChip state={levelState} />}
          </div>
        </section>

        {/* Learning stats come from localStorage, so they are real for
            signed-out users too — this hub is useful before any account
            exists. /progress remains the detailed view. */}
        {hydrated && (
          <section className="space-y-2">
            <SectionTitle>Your learning</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <Stat value={totals.learned} label="Learned" />
              <Stat value={totals.saved} label="Saved" />
            </div>

            {/* The streak is a card, not a tile: the week strip keeps real
                practice visible even when the streak itself is 0. */}
            <div className="rounded-3xl bg-surface p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* Accent, not red: red in this app means a wrong answer,
                      and the crest colour is the mascot's alone. A live streak
                      is an earned, only-goes-up thing, so it takes the same
                      green every other such metric does. */}
                  {streak > 0 && (
                    <FlameIcon width={22} height={22} className="text-accent" />
                  )}
                  <span className="text-3xl font-bold tabular-nums tracking-tight text-text">
                    {streak}
                  </span>
                  <span className="text-sm font-semibold text-muted">
                    {streak === 1 ? 'day' : 'days'}
                  </span>
                </div>
                <p className="text-xs font-medium text-muted">
                  {activeThisWeek > 0
                    ? `${activeThisWeek} of 7 days this week`
                    : 'No days yet this week'}
                </p>
              </div>

              <div className="mt-4">
                <WeekStrip days={week} />
              </div>

              {streak === 0 && (
                <p className="mt-4 text-xs leading-relaxed text-muted">
                  Recall a word correctly to start a streak — today counts.
                </p>
              )}
            </div>

            <Link
              href="/progress"
              className="block px-1 text-xs font-medium text-muted transition-colors hover:text-text"
            >
              See full progress →
            </Link>
          </section>
        )}

        {/* Create: the same approved / pending / rejected / none branching the
            creator screens gate on, via the shared useMyCreator hook. Nothing
            is offered that the destination would only refuse. */}
        <section>
          <SectionTitle>Create</SectionTitle>
          {!ready ? (
            <div className="h-24 rounded-3xl bg-surface" aria-hidden />
          ) : creator?.status === 'approved' ? (
            <div className="space-y-2">
              <ActionCard
                href="/creator/upload"
                icon={<UploadIcon width={16} height={16} />}
                title="Upload a video"
                body="Add a clip. Loro transcribes it and times every word for you."
              />
              <ActionCard
                href={`/creator/${creator.handle}`}
                icon={<FilmIcon width={16} height={16} />}
                title="View public profile"
                body={`See @${creator.handle} exactly as learners see it — the page you share.`}
              />
              <Link
                href="/creator"
                className="block px-1 pt-1 text-xs font-medium text-muted transition-colors hover:text-text"
              >
                Creator dashboard →
              </Link>
            </div>
          ) : creator?.status === 'pending' ? (
            <div className="rounded-3xl bg-surface p-5">
              <p className="text-base font-semibold text-text">
                Application under review
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                You applied as{' '}
                <span className="text-text">@{creator.handle}</span> on{' '}
                {new Date(creator.appliedAt).toLocaleDateString()}. Every
                application is read by a human — you&apos;ll hear back soon.
              </p>
            </div>
          ) : creator?.status === 'rejected' ? (
            <div className="rounded-3xl bg-surface p-5">
              <p className="text-base font-semibold text-text">
                Application not accepted
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Loro is starting with a very small group of creators, so this
                says little about your content.
              </p>
            </div>
          ) : (
            <ActionCard
              href="/creator/apply"
              icon={<FilmIcon width={16} height={16} />}
              title="Create videos"
              body={
                user
                  ? 'Turn your clips into Spanish lessons. Applications are reviewed by hand.'
                  : 'Turn your clips into Spanish lessons. Sign in to apply.'
              }
            />
          )}
        </section>

        <section>
          <SectionTitle>Settings</SectionTitle>
          {hydrated && (
            <LanguagePicker
              languages={languages}
              value={language}
              onChange={handleLanguageChange}
              variant="row"
            />
          )}
        </section>

        {/* Sign in / sign out. SignInCard is already the one place Loro
            invites an account, and frames it as backup and sync rather than
            a wall — exactly what this section needs. */}
        <section>
          <SectionTitle>Account</SectionTitle>
          <SignInCard />
        </section>
      </div>
    </main>
  );
}
