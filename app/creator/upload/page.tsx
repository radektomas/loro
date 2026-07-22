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
  /** Poster frame for the profile grid — null when extraction failed, which
      is not an upload error (the grid falls back to an initial tile). */
  poster: Blob | null;
  transcoded: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
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
  // Set when conversion failed for a file that passed validation — lets the
  // user retry without hunting for the file again.
  const [retryFile, setRetryFile] = useState<File | null>(null);
  // ffmpeg.wasm conversion state: which phase is running and how far along.
  const [converting, setConverting] = useState<{
    phase: PreparePhase;
    pct: number;
  } | null>(null);
  // Elapsed seconds since conversion started — a slow phone encode must
  // read as "working", never as "frozen".
  const [elapsed, setElapsed] = useState(0);
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

  // Tick the elapsed clock while a conversion runs.
  const isConverting = converting !== null;
  useEffect(() => {
    if (!isConverting) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, [isConverting]);

  // Convert a validated file: transcode to H.264 MP4 (iPhone HEVC .mov
  // renders black in Chrome/Firefox, so it must never reach storage) and
  // extract the transcription audio. If either fails, the upload is blocked
  // with a real message — and the file is kept so retry is one tap.
  const convert = async (file: File, duration: number, token: number) => {
    setConverting({ phase: 'video', pct: 0 });
    const result = await prepareClip(file, (phase, ratio) => {
      if (token === pickToken.current)
        setConverting({ phase, pct: Math.round(ratio * 100) });
    });
    if (token !== pickToken.current) return;
    setConverting(null);
    if (!result.ok) {
      setPickError(result.error);
      setRetryFile(file);
      return;
    }
    setRetryFile(null);
    setPicked({
      file: result.video,
      duration,
      audio: result.audio,
      poster: result.poster,
      transcoded: result.transcoded,
    });
  };

  const pick = async (file: File | undefined) => {
    const token = ++pickToken.current;
    setPickError(null);
    setPicked(null);
    setRetryFile(null);
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
    await convert(file, duration, token);
  };

  const retryConvert = async () => {
    const file = retryFile;
    if (!file) return;
    const token = ++pickToken.current;
    setPickError(null);
    let duration: number;
    try {
      duration = await readVideoDuration(file);
    } catch {
      setPickError('Could not read that file as a video.');
      return;
    }
    if (token !== pickToken.current) return;
    await convert(file, duration, token);
  };

  const submit = async () => {
    if (!picked || !rights || uploading) return;
    setUploading(true);
    setUploadError(null);
    const result = await uploadCreatorVideo(
      picked.file,
      picked.duration,
      picked.audio,
      picked.poster
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
            {/* The next action decides whether they upload a second video —
                make it the primary, with their library one tap away. */}
            <button
              type="button"
              onClick={() => {
                setLive(null);
                setImportWarning(false);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-base font-semibold text-background transition-transform active:scale-[0.98]"
            >
              <UploadIcon width={16} height={16} />
              Upload another video
            </button>
            <Link
              href="/creator"
              className="block w-full rounded-2xl bg-surface py-3.5 text-center text-base font-semibold text-text transition-colors hover:bg-surface-raised"
            >
              See your videos
            </Link>
          </>
        )}

        {ready && loaded && user && approved && !live && (
          <>
            {/* Set expectations BEFORE the file picker — especially that the
                conversion happens on their phone and takes a while. */}
            <ol className="space-y-3 rounded-3xl bg-surface p-5">
              {[
                {
                  title: 'Pick a clip',
                  body: 'Spanish audio, up to 90 seconds. MP4 or iPhone MOV — straight off your phone is fine.',
                },
                {
                  title: 'Your phone converts it',
                  body: 'Right here in the browser, before anything uploads. Longer clips can take a few minutes — keep this tab open.',
                },
                {
                  title: 'Loro does the rest',
                  body: 'Transcribes it, times every word, adds tap-to-translate, and it goes live after a quick check.',
                },
              ].map((step, i) => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text">
                      {step.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {step.body}
                    </span>
                  </span>
                </li>
              ))}
            </ol>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mov,.mp4"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
            />

            {converting !== null ? (
              <div className="rounded-3xl bg-surface p-6">
                <div className="flex items-center gap-3">
                  <LoroMascot state="idle" size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                      Step {converting.phase === 'video' ? '1' : '2'} of 2
                    </p>
                    <p className="mt-0.5 text-base font-semibold text-text">
                      {converting.phase === 'video'
                        ? 'Converting your video…'
                        : 'Extracting the audio…'}
                    </p>
                  </div>
                  <p className="shrink-0 text-2xl font-bold tabular-nums tracking-tight text-accent">
                    {converting.pct}%
                  </p>
                </div>
                {/* The bar is driven by ffmpeg's real progress, never fake;
                    the clock proves a slow phone encode isn't a freeze. */}
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${Math.max(converting.pct, 3)}%` }}
                  />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <p className="text-xs leading-relaxed text-muted/70">
                    Working on your device — keep this tab open.
                  </p>
                  <p className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                    {formatElapsed(elapsed)}
                  </p>
                </div>
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
                    className="shrink-0 rounded-xl bg-surface-raised px-4 py-3 text-xs font-semibold text-muted transition-colors hover:text-text"
                  >
                    Change
                  </button>
                </div>
              </div>
            )}

            {pickError && (
              <div className="rounded-2xl bg-[#f87171]/10 px-4 py-3">
                <p className="text-sm leading-relaxed text-[#f87171]">
                  {pickError}
                </p>
                {retryFile && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void retryConvert()}
                      className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-background transition-transform active:scale-[0.98]"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 rounded-xl bg-surface py-3 text-sm font-semibold text-text transition-colors hover:bg-surface-raised"
                    >
                      Choose another video
                    </button>
                  </div>
                )}
              </div>
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
              <div className="rounded-2xl bg-[#f87171]/10 px-4 py-3">
                <p className="text-sm leading-relaxed text-[#f87171]">
                  {uploadError}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Your converted clip is still here — press Upload to try
                  again.
                </p>
              </div>
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
