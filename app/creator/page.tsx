'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  deleteCreatorVideo,
  getMyCreator,
  listMyVideos,
  type Creator,
  type CreatorVideo,
} from '@/lib/creators';
import {
  GateMessage,
  PageHeader,
  SectionTitle,
  useSupabaseUser,
  VideoStatusChip,
} from '@/components/creator/ugc';
import { LoroMascot } from '@/components/LoroMascot';
import { FilmIcon, TrashIcon, UploadIcon } from '@/components/icons/Icons';

function ImpactCard({
  value,
  label,
  hero = false,
}: {
  value: number;
  label: string;
  hero?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl px-3 py-5 text-center ${
        hero
          ? 'bg-gradient-to-br from-accent/25 via-accent-soft to-surface ring-1 ring-accent/25'
          : 'bg-surface'
      }`}
    >
      <p className="text-4xl font-bold tabular-nums tracking-tight text-text">
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
    </div>
  );
}

export default function CreatorDashboardPage() {
  const { user, ready } = useSupabaseUser();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [videos, setVideos] = useState<CreatorVideo[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Two-step delete: first tap arms the confirmation, second tap deletes.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLoaded(true);
      return;
    }
    void Promise.all([getMyCreator(), listMyVideos()]).then(([c, v]) => {
      setCreator(c);
      setVideos(v);
      setLoaded(true);
    });
  }, [ready, user]);

  // Learning impact — the numbers a future revenue share will be based on.
  const totals = useMemo(() => {
    let saved = 0;
    let mastered = 0;
    for (const v of videos) {
      saved += v.savedCount;
      mastered += v.masteredCount;
    }
    return { saved, mastered };
  }, [videos]);

  const gated = ready && loaded && (!user || creator?.status !== 'approved');

  const handleDelete = async (video: CreatorVideo) => {
    setDeletingId(video.id);
    setDeleteError(null);
    const result = await deleteCreatorVideo(video);
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (!result.ok) {
      setDeleteError(result.error ?? 'Could not delete the video.');
      return;
    }
    setVideos((prev) => prev.filter((v) => v.id !== video.id));
  };

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <PageHeader
        title="Creator studio"
        right={
          creator?.status === 'approved' ? (
            <Link
              href="/creator/upload"
              className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-background transition-transform active:scale-95"
            >
              <UploadIcon width={15} height={15} />
              Upload
            </Link>
          ) : undefined
        }
      />

      <div className="mx-auto max-w-md px-4 pb-10">
        {gated && (
          <GateMessage
            title={
              !user
                ? 'Sign in first'
                : !creator
                  ? 'Creators only'
                  : creator.status === 'pending'
                    ? 'Application pending'
                    : 'Not available'
            }
            body={
              !user
                ? 'The creator dashboard is tied to your account.'
                : !creator
                  ? 'This space is for approved Loro creators. Applying takes two minutes.'
                  : creator.status === 'pending'
                    ? 'Your application is still being reviewed — the dashboard unlocks once it’s approved.'
                    : 'Your application wasn’t accepted, so the dashboard isn’t available.'
            }
            action={
              user && !creator ? (
                <Link
                  href="/creator/apply"
                  className="rounded-2xl bg-accent px-6 py-3 text-base font-semibold text-background transition-transform active:scale-95"
                >
                  Apply to be a creator
                </Link>
              ) : undefined
            }
          />
        )}

        {ready && loaded && user && creator?.status === 'approved' && (
          <div className="space-y-8">
            <div className="flex items-center gap-3 px-1">
              <LoroMascot state="happy" size={44} />
              <p className="min-w-0 text-sm text-muted">
                Hola,{' '}
                <span className="font-semibold text-text">
                  {creator.displayName}
                </span>{' '}
                <span className="text-muted/60">@{creator.handle}</span>
              </p>
            </div>

            {/* THE hero: what people actually learned from your videos —
                mastered leads, it's the number the revenue share will follow. */}
            <section>
              <SectionTitle>Learning impact</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                <ImpactCard value={totals.mastered} label="Words mastered" hero />
                <ImpactCard value={totals.saved} label="Words saved" />
              </div>
              <p className="mt-2 px-1 text-xs leading-relaxed text-muted/70">
                {totals.saved === 0
                  ? 'These counters start moving as soon as learners save words from your first published video.'
                  : 'A word counts as mastered when a learner carries it to the top of their review ladder — the strongest signal your video taught something that stuck.'}
              </p>
              <div className="mt-3 rounded-2xl bg-level-soft px-4 py-3 ring-1 ring-level/25">
                <p className="text-xs font-bold uppercase tracking-wider text-level">
                  Revenue share — coming soon
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Creator payouts will be based on these learning numbers, not
                  views. They&apos;re being tracked for you from day one.
                </p>
              </div>
            </section>

            <section>
              <SectionTitle>Your videos</SectionTitle>
              {deleteError && (
                <p className="mb-2 rounded-2xl bg-[#f87171]/10 px-4 py-3 text-sm text-[#f87171]">
                  {deleteError}
                </p>
              )}
              {videos.length === 0 ? (
                <div className="flex flex-col items-center rounded-3xl bg-surface px-6 py-10 text-center">
                  <LoroMascot state="idle" size={72} />
                  <p className="mt-4 text-base font-semibold text-text">
                    No videos yet
                  </p>
                  <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted">
                    Upload your first clip — Loro transcribes it, times every
                    word, and adds tap-to-translate.
                  </p>
                  <Link
                    href="/creator/upload"
                    className="mt-6 flex items-center gap-2 rounded-2xl bg-accent px-6 py-3 text-base font-semibold text-background transition-transform active:scale-95"
                  >
                    <UploadIcon width={16} height={16} />
                    Upload a video
                  </Link>
                </div>
              ) : (
                <ul className="space-y-2">
                  {videos.map((v) => (
                    <li
                      key={v.id}
                      className="rounded-2xl bg-surface px-4 py-3.5"
                    >
                      <div className="flex items-center gap-2">
                        <FilmIcon
                          width={16}
                          height={16}
                          className="shrink-0 text-muted"
                        />
                        <span className="min-w-0 truncate text-sm font-semibold text-text">
                          {v.title ?? 'Untitled'}
                        </span>
                        <span className="ml-auto" />
                        <VideoStatusChip status={v.status} />
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDeleteId(
                              confirmDeleteId === v.id ? null : v.id
                            )
                          }
                          aria-label={`Delete ${v.title ?? 'video'}`}
                          className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted/70 transition-colors hover:text-[#f87171]"
                        >
                          <TrashIcon width={15} height={15} />
                        </button>
                      </div>
                      {confirmDeleteId === v.id && (
                        <div className="mt-3 rounded-xl bg-[#f87171]/10 px-3 py-3">
                          <p className="text-xs leading-relaxed text-text">
                            Delete this video?{' '}
                            {v.status === 'published'
                              ? 'It disappears from the feed and its learning stats go with it. '
                              : ''}
                            This can&apos;t be undone.
                          </p>
                          <div className="mt-2.5 flex gap-2">
                            <button
                              type="button"
                              disabled={deletingId === v.id}
                              onClick={() => void handleDelete(v)}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#f87171] py-2.5 text-xs font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-40"
                            >
                              <TrashIcon width={12} height={12} />
                              {deletingId === v.id ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === v.id}
                              onClick={() => setConfirmDeleteId(null)}
                              className="flex-1 rounded-lg bg-surface-raised py-2.5 text-xs font-semibold text-text transition-colors"
                            >
                              Keep it
                            </button>
                          </div>
                        </div>
                      )}
                      <p className="mt-1.5 text-xs text-muted/70">
                        {new Date(v.createdAt).toLocaleDateString()}
                        {v.durationSeconds
                          ? ` · ${Math.round(v.durationSeconds)}s`
                          : ''}
                      </p>
                      <p className="mt-2 text-xs">
                        <span className="font-semibold text-accent">
                          {v.masteredCount} mastered
                        </span>
                        <span className="text-muted/50"> · </span>
                        <span className="text-muted">{v.savedCount} words saved</span>
                      </p>
                      {v.savedCount > 0 && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-500"
                            style={{
                              width: `${Math.round(
                                (v.masteredCount / v.savedCount) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      )}
                      {v.status === 'rejected' && v.reviewNote && (
                        <p className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-xs leading-relaxed text-muted">
                          {v.reviewNote}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
