import type { FFmpeg } from '@ffmpeg/ffmpeg';

/**
 * Browser-side clip preparation with ffmpeg.wasm — one pass that makes an
 * upload universally usable BEFORE it reaches storage:
 *
 *  1. TRANSCODE the video to H.264 MP4 (yuv420p, AAC, +faststart, long edge
 *     capped at 1280). iPhone .mov files are HEVC/QuickTime, which Chrome
 *     and Firefox cannot decode — they render as a black player. Everything
 *     that lands in the bucket must be H.264. Skipped only when the input
 *     already is H.264 MP4 at a reasonable size.
 *  2. EXTRACT the audio track to mono 16 kHz AAC (m4a) — the transcription
 *     input (Whisper never sees the video).
 *
 * Everything is dynamically imported so none of it touches the page's
 * initial bundle — the ~11 MB single-thread core is fetched from the CDN
 * only after a file is actually picked. Single-thread on purpose: it needs
 * no SharedArrayBuffer, so it works even when the COOP/COEP headers didn't
 * apply (e.g. after a client-side navigation into the page). The trade-off
 * is speed — a 90 s clip can take a minute or more, which is why progress
 * is reported per phase and the UI must never look frozen.
 */

// Must match the @ffmpeg/ffmpeg version's expected core ABI (0.12.x line).
const CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
const TRANSCODE_TIMEOUT_MS = 600_000;
const EXTRACT_TIMEOUT_MS = 120_000;
/** An H.264 MP4 at or under this size is uploaded as-is — re-encoding what
    already plays everywhere would only cost the creator minutes of waiting. */
const SKIP_TRANSCODE_MAX_BYTES = 50 * 1024 * 1024;

let ffmpegPromise: Promise<FFmpeg> | null = null;

/** Load ffmpeg.wasm once and reuse the instance across all conversions. */
function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ]);
      const ffmpeg = new FFmpeg();
      // toBlobURL fetches with CORS (fine under COEP) and hands the worker a
      // same-origin blob: URL, sidestepping cross-origin worker restrictions.
      const loaded = await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(
          `${CORE_URL}/ffmpeg-core.wasm`,
          'application/wasm'
        ),
      });
      if (!loaded) throw new Error('ffmpeg.wasm failed to load');
      return ffmpeg;
    })();
    // A failed load (offline, CDN blocked) must not poison every later try.
    ffmpegPromise.catch(() => {
      ffmpegPromise = null;
    });
  }
  return ffmpegPromise;
}

/**
 * The input's video codec, parsed from ffmpeg's own stream info. `-i` with
 * no output exits non-zero by design — only the log lines matter here.
 */
async function probeVideoCodec(
  ffmpeg: FFmpeg,
  inName: string
): Promise<string | null> {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    lines.push(message);
  };
  ffmpeg.on('log', onLog);
  try {
    await ffmpeg.exec(['-hide_banner', '-i', inName]);
  } catch {
    // expected: no output file specified
  } finally {
    ffmpeg.off('log', onLog);
  }
  const streamLine = lines.find((l) => /Stream .*Video:/i.test(l));
  const match = streamLine?.match(/Video:\s*([a-z0-9_]+)/i);
  return match ? match[1].toLowerCase() : null;
}

export type PreparePhase = 'video' | 'audio';

export type PrepareResult =
  | {
      ok: true;
      video: File;
      audio: Blob;
      /** Poster frame, or null when extraction failed — see extractPoster. */
      poster: Blob | null;
      transcoded: boolean;
    }
  | { ok: false; error: string };

/** Poster frame: ~1s in, long edge 480, JPEG. -q:v 4 on mjpeg's 2..31 scale
    is roughly quality 0.8 — small enough for a 3-column grid tile. */
const POSTER_SECONDS = 1;
const POSTER_MAX_WIDTH = 480;
const POSTER_TIMEOUT_MS = 60_000;

/**
 * Grab a single frame as a JPEG for the profile grid.
 *
 * Returns null instead of throwing on ANY failure: a missing poster degrades
 * to the grid's initial tile, while a thrown error here would fail an upload
 * that is otherwise perfectly good. The poster is a nice-to-have; the clip is
 * the product.
 *
 * Reads whichever file is known to be H.264 — the transcoded output when we
 * made one, the original only when it was already H.264 (an HEVC .mov is not
 * decodable by the wasm core, which is why it was transcoded in the first
 * place). A clip shorter than the seek point yields no frame, so that retries
 * at 0.
 */
async function extractPoster(
  ffmpeg: FFmpeg,
  sourceName: string,
  outName: string
): Promise<Blob | null> {
  for (const seek of [POSTER_SECONDS, 0]) {
    try {
      const code = await ffmpeg.exec(
        [
          // -ss before -i seeks by keyframe: fast, and exact enough for a
          // thumbnail.
          '-ss', String(seek),
          '-i', sourceName,
          '-frames:v', '1',
          '-vf', `scale='min(iw,${POSTER_MAX_WIDTH})':-2`,
          '-q:v', '4',
          outName,
        ],
        POSTER_TIMEOUT_MS
      );
      if (code !== 0) continue;
      const data = await ffmpeg.readFile(outName);
      if (typeof data === 'string' || data.byteLength === 0) continue;
      return new Blob([new Uint8Array(data)], { type: 'image/jpeg' });
    } catch {
      // try the next seek point, then give up
    }
  }
  return null;
}

/**
 * Prepare a picked clip for upload: H.264 MP4 video + m4a transcription
 * audio. `onProgress` reports (phase, 0..1) so the UI can show labelled,
 * honest progress for each stage.
 */
export async function prepareClip(
  file: File,
  onProgress?: (phase: PreparePhase, ratio: number) => void
): Promise<PrepareResult> {
  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFFmpeg();
  } catch {
    return {
      ok: false,
      error:
        'Could not load the video converter — check your connection and try again.',
    };
  }

  const inName = `in.${(file.name.split('.').pop() || 'mov').toLowerCase()}`;
  const outVideo = 'out.mp4';
  const outAudio = 'out.m4a';
  const outPoster = 'out.jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'clip';

  let phase: PreparePhase = 'video';
  const handleProgress = ({ progress }: { progress: number }) => {
    // ffmpeg occasionally reports slightly out-of-range ratios near the ends
    onProgress?.(phase, Math.min(1, Math.max(0, progress)));
  };

  try {
    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile(inName, await fetchFile(file));

    // Skip the (slow) re-encode only when the input already plays everywhere:
    // H.264 in an MP4 container, at a size worth serving as-is.
    const codec = await probeVideoCodec(ffmpeg, inName);
    const isMp4 =
      /\.mp4$/i.test(file.name) || file.type.toLowerCase() === 'video/mp4';
    const skipTranscode =
      isMp4 && codec === 'h264' && file.size <= SKIP_TRANSCODE_MAX_BYTES;

    ffmpeg.on('progress', handleProgress);

    let video: File;
    let transcoded = false;
    if (skipTranscode) {
      onProgress?.('video', 1);
      video = file;
    } else {
      // H.264 + yuv420p + faststart = decodable by every current browser and
      // streamable from byte one. Long edge capped at 1280, never upscaled,
      // dimensions forced even (yuv420p requires it). CRF 28 / veryfast:
      // modest quality is fine for short phone clips, and single-threaded
      // wasm makes every preset step above this painfully slow.
      const code = await ffmpeg.exec(
        [
          '-i', inName,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '28',
          '-vf',
          "scale='min(iw,1280)':'min(ih,1280)':force_original_aspect_ratio=decrease:force_divisible_by=2",
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '96k',
          '-movflags', '+faststart',
          outVideo,
        ],
        TRANSCODE_TIMEOUT_MS
      );
      if (code !== 0) {
        return {
          ok: false,
          error:
            'Could not convert that video to a web-playable format. Try re-exporting it as MP4 and picking it again.',
        };
      }
      const data = await ffmpeg.readFile(outVideo);
      if (typeof data === 'string' || data.byteLength === 0) {
        return {
          ok: false,
          error: 'Video conversion produced an empty file — try again.',
        };
      }
      video = new File([new Uint8Array(data)], `${baseName}.mp4`, {
        type: 'video/mp4',
      });
      transcoded = true;
    }

    // Audio for transcription — from the ORIGINAL input (best source
    // quality); -vn skips the video stream so the codec never matters.
    phase = 'audio';
    onProgress?.('audio', 0);
    const audioCode = await ffmpeg.exec(
      [
        '-i', inName,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'aac',
        '-b:a', '48k',
        outAudio,
      ],
      EXTRACT_TIMEOUT_MS
    );
    if (audioCode !== 0) {
      return {
        ok: false,
        error:
          'Could not read an audio track from that video. Make sure the clip has sound, or re-export it as MP4 and try again.',
      };
    }
    const audioData = await ffmpeg.readFile(outAudio);
    if (typeof audioData === 'string' || audioData.byteLength === 0) {
      return {
        ok: false,
        error:
          'Audio extraction produced an empty file — try re-exporting the clip.',
      };
    }

    // Last, and deliberately unguarded by any error path: by this point the
    // upload is already viable, so a failed poster must change nothing.
    const poster = await extractPoster(
      ffmpeg,
      transcoded ? outVideo : inName,
      outPoster
    );

    return {
      ok: true,
      video,
      audio: new Blob([new Uint8Array(audioData)], { type: 'audio/mp4' }),
      poster,
      transcoded,
    };
  } catch {
    return {
      ok: false,
      error:
        phase === 'video'
          ? 'Video conversion failed. Try again, or re-export the clip as MP4.'
          : 'Audio extraction failed. Try again, or re-export the clip as MP4 with sound.',
    };
  } finally {
    ffmpeg.off('progress', handleProgress);
    // Best-effort scratch cleanup; the worker keeps its FS between runs.
    for (const name of [inName, outVideo, outAudio, outPoster]) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {}
    }
  }
}
