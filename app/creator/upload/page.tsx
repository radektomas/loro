'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  getMyCreator,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_SECONDS,
  readVideoDuration,
  subscribeToVideo,
  uploadCreatorVideo,
  type Creator,
  type CreatorVideo,
} from '@/lib/creators';
import { prepareClip, type PreparePhase } from '@/lib/prepareClip';
import {
  GateMessage,
  PageHeader,
  useSupabaseUser,
  VideoStatusChip,
} from '@/components/creator/ugc';
import { LoroMascot } from '@/components/LoroMascot';
import { CheckIcon, UploadIcon } from '@/components/icons/Icons';

type Picked = {
  /** the H.264 MP4 that will actually be uploaded (transcoded, or the
      original when it already was web-playable H.264 MP4) */
  file: File;
  duration: number;
  audio: Blob;
  transcoded: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The pipeline as the creator experiences it, driven by videos.status. */
function PipelineState({ video }: { video: CreatorVideo }) {
  const steps = [
    { key: 'uploaded', label: 'Uploaded', done: true },
    {
      key: 'processing',
      label: 'Transcribing & timing words',
      done: video.status !== 'uploaded' && video.status !== 'processing',
      active: video.status === 'processing' || video.status === 'uploaded',
    },
  ];
  return (
    <div className="rounded-3xl bg-surface p-6">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold text-text">
          {video.title ?? 'Your video'}
        </p>
        <VideoStatusChip status={video.status} />
      </div>

      {(video.status === 'uploaded' || video.status === 'processing') && (
        <>
          <ul className="mt-5 space-y-3">
            {steps.map((s) => (
              <li key={s.key} className="flex items-center gap-3">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    s.done
                      ? 'bg-accent text-background'
                      : 'bg-surface-raised text-muted'
                  }`}
                >
                  {s.done ? (
                    <CheckIcon width={12} height={12} />
                  ) : (
                    <span className="h-2 w-2 animate-pulse rounded-full bg-level" />
                  )}
                </span>
                <span
                  className={`text-sm ${s.done ? 'text-text' : 'text-muted'}`}
                >
                  {s.label}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-muted/70">
            This updates live — no need to refresh. Processing usually takes a
            few minutes.
          </p>
        </>
      )}

      {video.status === 'published' && (
        <div className="mt-4 flex items-start gap-3">
          <LoroMascot state="happy" size={56} />
          <p className="text-sm leading-relaxed text-muted">
            <span className="font-semibold text-accent">Live in the feed.</span>{' '}
            Word timing checked out — learners can watch it now. Track what
            they learn on your{' '}
            <Link href="/creator" className="font-semibold text-text underline">
              dashboard
            </Link>
            .
          </p>
        </div>
      )}

      {video.status === 'pending_review' && (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          The automatic quality check wants a human look at the word timing
          before this goes live. Nothing to do on your end — you&apos;ll see it
          published (or hear why not) soon.
        </p>
      )}

      {video.status === 'rejected' && (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          This clip didn&apos;t pass review
          {video.reviewNote ? (
            <>
              : <span className="text-text">{video.reviewNote}</span>
            </>
          ) : (
            '.'
          )}
        </p>
      )}
    </div>
  );
}

export default function CreatorUploadPage() {
  const { user, ready } = useSupabaseUser();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  // ffmpeg.wasm conversion state: which phase is running and how far along.
  const [converting, setConverting] = useState<{
    phase: PreparePhase;
    pct: number;
  } | null>(null);
  // Ignore results of a conversion the user has already abandoned.
  const pickToken = useRef(0);
  const [rights, setRights] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [live, setLive] = useState<CreatorVideo | null>(null);
  const [importWarning, setImportWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLoaded(true);
      return;
    }
    void getMyCreator().then((c) => {
      setCreator(c);
      setLoaded(true);
    });
  }, [ready, user]);

  // Live processing state: uploaded -> processing -> published/pending_review,
  // pushed by Supabase realtime as the n8n pipeline updates the row.
  useEffect(() => {
    if (!live) return;
    return subscribeToVideo(live.id, setLive);
  }, [live?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (file: File | undefined) => {
    const token = ++pickToken.current;
    setPickError(null);
    setPicked(null);
    setConverting(null);
    if (!file) return;
    // Pre-transcode source bound — the upload itself will be much smaller.
    if (file.size > MAX_UPLOAD_BYTES) {
      setPickError(
        `That file is ${formatBytes(file.size)} — the limit is 200 MB. Export a smaller version and try again.`
      );
      return;
    }
    let duration: number;
    try {
      duration = await readVideoDuration(file);
    } catch {
      setPickError('Could not read that file as a video.');
      return;
    }
    if (token !== pickToken.current) return;
    if (duration > MAX_UPLOAD_SECONDS) {
      setPickError(
        `That video is ${Math.round(duration)}s — the limit is ${MAX_UPLOAD_SECONDS} seconds. Trim it and try again.`
      );
      return;
    }
    // Convert NOW, before upload: transcode to H.264 MP4 (iPhone HEVC .mov
    // renders black in Chrome/Firefox, so it must never reach storage) and
    // extract the transcription audio. If either fails, the upload is
    // blocked with a real message instead of publishing a broken clip.
    setConverting({ phase: 'video', pct: 0 });
    const result = await prepareClip(file, (phase, ratio) => {
      if (token === pickToken.current)
        setConverting({ phase, pct: Math.round(ratio * 100) });
    });
    if (token !== pickToken.current) return;
    setConverting(null);
    if (!result.ok) {
      setPickError(result.error);
      return;
    }
    setPicked({
      file: result.video,
      duration,
      audio: result.audio,
      transcoded: result.transcoded,
    });
  };

  const submit = async () => {
    if (!picked || !rights || uploading) return;
    setUploading(true);
    setUploadError(null);
    const result = await uploadCreatorVideo(
      picked.file,
      picked.duration,
      picked.audio
    );
    setUploading(false);
    if (!result.ok) {
      setUploadError(result.error);
      return;
    }
    setLive(result.video);
    setImportWarning(!result.importTriggered);
    setPicked(null);
    setRights(false);
  };

  const approved = creator?.status === 'approved';

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <PageHeader title="Upload" backHref="/creator" />
      <div className="mx-auto max-w-md space-y-6 px-4 pb-10">
        {ready && loaded && (!user || !approved) && (
          <GateMessage
            title="Approved creators only"
            body={
              !user
                ? 'Sign in with your creator account to upload.'
                : 'Uploading unlocks once your creator application is approved.'
            }
            action={
              <Link
                href={user ? '/creator/apply' : '/creator'}
                className="rounded-2xl bg-accent px-6 py-3 text-base font-semibold text-background transition-transform active:scale-95"
              >
                {user ? 'Check application status' : 'Back'}
              </Link>
            }
          />
        )}

        {ready && loaded && user && approved && live && (
          <>
            <PipelineState video={live} />
            {importWarning && (
              <p className="rounded-2xl bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-300">
                The file is safely uploaded, but the processing pipeline
                couldn&apos;t be notified. It will be picked up manually — no
                need to re-upload.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setLive(null);
                setImportWarning(false);
              }}
              className="w-full rounded-2xl bg-surface py-3.5 text-base font-semibold text-text transition-colors hover:bg-surface-raised"
            >
              Upload another video
            </button>
          </>
        )}

        {ready && loaded && user && approved && !live && (
          <>
            <p className="px-1 text-sm leading-relaxed text-muted">
              One clip, Spanish audio, up to{' '}
              <span className="text-text">90 seconds</span>. MP4 or iPhone
              MOV — straight off your phone is fine; it&apos;s converted to a
              web-friendly MP4 right in your browser before it uploads (large
              files take longer to convert). Loro then transcribes it, times
              every word, and adds tap-to-translate automatically.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mov,.mp4"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
            />

            {converting !== null ? (
              <div className="rounded-3xl bg-surface p-6">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-text">
                    {converting.phase === 'video'
                      ? 'Converting video…'
                      : 'Extracting audio…'}
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-accent">
                    {converting.pct}%
                  </p>
                </div>
                {/* Phase 1 can take a minute or more on a long clip — the
                    bar is driven by ffmpeg's real progress, never fake. */}
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${Math.max(converting.pct, 3)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted/70">
                  {converting.phase === 'video'
                    ? 'Step 1 of 2 — converting to web-playable MP4.'
                    : 'Step 2 of 2 — extracting the audio track for transcription.'}{' '}
                  This runs in your browser — keep this tab open. Longer or
                  larger clips take longer.
                </p>
              </div>
            ) : !picked ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-white/15 bg-surface px-6 py-12 text-muted transition-colors hover:border-accent/40 hover:text-text"
              >
                <UploadIcon width={28} height={28} className="text-accent" />
                <span className="text-base font-semibold text-text">
                  Choose a video
                </span>
                <span className="text-xs text-muted/70">
                  MP4 or MOV · checked before it uploads
                </span>
              </button>
            ) : (
              <div className="rounded-3xl bg-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text">
                      {picked.file.name}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {formatBytes(picked.file.size)} ·{' '}
                      {Math.round(picked.duration)}s
                      <span className="text-accent">
                        {' '}
                        · {picked.transcoded ? 'converted to MP4' : 'MP4 ready'}{' '}
                        · audio ready ({formatBytes(picked.audio.size)})
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="shrink-0 rounded-xl bg-surface-raised px-3 py-2 text-xs font-semibold text-muted transition-colors hover:text-text"
                  >
                    Change
                  </button>
                </div>
              </div>
            )}

            {pickError && (
              <p className="rounded-2xl bg-[#f87171]/10 px-4 py-3 text-sm leading-relaxed text-[#f87171]">
                {pickError}
              </p>
            )}

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-surface px-4 py-3.5">
              <input
                type="checkbox"
                checked={rights}
                onChange={(e) => setRights(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="text-xs leading-relaxed text-muted">
                I made this content myself, or I hold the rights to publish it
                on Loro.
              </span>
            </label>

            {uploadError && (
              <p className="rounded-2xl bg-[#f87171]/10 px-4 py-3 text-sm leading-relaxed text-[#f87171]">
                {uploadError}
              </p>
            )}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={!picked || !rights || uploading}
              className="w-full rounded-2xl bg-accent py-3.5 text-base font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
