'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  isAdmin,
  listVideosByStatus,
  setVideoStatus,
  videoPublicUrl,
  type CreatorVideo,
  type UgcVideoStatus,
} from '@/lib/creators';
import {
  GateMessage,
  PageHeader,
  SectionTitle,
  useSupabaseUser,
  VideoStatusChip,
} from '@/components/creator/ugc';
import { ReviewPlayer } from '@/components/admin/ReviewPlayer';
import { CheckIcon, CloseIcon, FilmIcon, ReplayIcon } from '@/components/icons/Icons';

function VideoRow({
  video,
  expanded,
  onToggle,
  onSetStatus,
  busy,
}: {
  video: CreatorVideo;
  expanded: boolean;
  onToggle: () => void;
  onSetStatus: (status: UgcVideoStatus) => void;
  busy: boolean;
}) {
  const src = videoPublicUrl(video.storagePath);
  return (
    <li className="rounded-3xl bg-surface p-4">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 text-left"
      >
        <FilmIcon width={18} height={18} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text">
            {video.title ?? 'Untitled'}
          </p>
          <p className="mt-0.5 text-xs text-muted/70">
            {video.creator
              ? `${video.creator.displayName} @${video.creator.handle} · `
              : ''}
            {new Date(video.createdAt).toLocaleDateString()}
            {video.durationSeconds
              ? ` · ${Math.round(video.durationSeconds)}s`
              : ''}
          </p>
        </div>
        <VideoStatusChip status={video.status} />
      </button>

      {video.reviewNote && (
        <p className="mt-3 rounded-xl bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
          Quality gate: {video.reviewNote}
        </p>
      )}

      {expanded && (
        <div className="mt-4 space-y-3">
          {src ? (
            <ReviewPlayer video={video} src={src} />
          ) : (
            <p className="rounded-xl bg-white/5 px-3 py-2 text-xs text-muted">
              Storage URL unavailable.
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted/70">
            Watch with the subtitles on: the highlight should ride each word as
            it&apos;s spoken. Tap words to spot-check glosses.
          </p>
          <div className="flex gap-2">
            {video.status !== 'published' ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSetStatus('published')}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-accent py-3 text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-40"
                >
                  <CheckIcon width={15} height={15} />
                  Approve & publish
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSetStatus('rejected')}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#f87171]/15 py-3 text-sm font-semibold text-[#f87171] transition-transform active:scale-[0.98] disabled:opacity-40"
                >
                  <CloseIcon width={15} height={15} />
                  Reject
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSetStatus('pending_review')}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-400/15 py-3 text-sm font-semibold text-amber-300 transition-transform active:scale-[0.98] disabled:opacity-40"
              >
                <ReplayIcon width={15} height={15} />
                Pull back for review
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export default function AdminVideosPage() {
  const { user, ready } = useSupabaseUser();
  const [admin, setAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [needsReview, setNeedsReview] = useState<CreatorVideo[]>([]);
  const [published, setPublished] = useState<CreatorVideo[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [pending, live] = await Promise.all([
      listVideosByStatus(['pending_review']),
      listVideosByStatus(['published']),
    ]);
    setNeedsReview(pending);
    setPublished(live);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLoaded(true);
      return;
    }
    void isAdmin().then(async (ok) => {
      setAdmin(ok);
      if (ok) await refresh();
      setLoaded(true);
    });
  }, [ready, user, refresh]);

  const applyStatus = async (videoId: string, status: UgcVideoStatus) => {
    setBusyId(videoId);
    setError(null);
    const result = await setVideoStatus(videoId, status);
    if (!result.ok) setError(result.error ?? 'Update failed.');
    else setExpandedId(null);
    await refresh();
    setBusyId(null);
  };

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <PageHeader title="Video review" backHref="/admin/creators" />
      <div className="mx-auto max-w-md space-y-8 px-4 pb-10">
        {ready && loaded && (!user || !admin) && (
          <GateMessage
            title="Admins only"
            body="This screen reviews flagged videos and is limited to Loro admins."
          />
        )}

        {ready && loaded && admin && (
          <>
            {error && (
              <p className="rounded-2xl bg-[#f87171]/10 px-4 py-3 text-sm text-[#f87171]">
                {error}
              </p>
            )}

            {/* Clips the n8n quality gate flagged — bad timestamps or low
                confidence. The whole point is SEEING the word sync. */}
            <section>
              <SectionTitle>Needs review · {needsReview.length}</SectionTitle>
              {needsReview.length === 0 ? (
                <p className="rounded-3xl bg-surface px-5 py-6 text-sm text-muted">
                  Nothing flagged for review.
                </p>
              ) : (
                <ul className="space-y-3">
                  {needsReview.map((v) => (
                    <VideoRow
                      key={v.id}
                      video={v}
                      expanded={expandedId === v.id}
                      onToggle={() =>
                        setExpandedId(expandedId === v.id ? null : v.id)
                      }
                      busy={busyId === v.id}
                      onSetStatus={(s) => void applyStatus(v.id, s)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <SectionTitle>Published · {published.length}</SectionTitle>
              {published.length === 0 ? (
                <p className="rounded-3xl bg-surface px-5 py-6 text-sm text-muted">
                  Nothing published yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {published.map((v) => (
                    <VideoRow
                      key={v.id}
                      video={v}
                      expanded={expandedId === v.id}
                      onToggle={() =>
                        setExpandedId(expandedId === v.id ? null : v.id)
                      }
                      busy={busyId === v.id}
                      onSetStatus={(s) => void applyStatus(v.id, s)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
