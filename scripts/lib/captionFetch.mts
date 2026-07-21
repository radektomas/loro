/**
 * Fetch a Spanish caption track (with word-level timing) for a YouTube video.
 *
 * RUN CONTEXT MATTERS. This talks to YouTube's caption delivery — the same
 * data the embedded player itself loads. It is meant to run from a
 * residential machine (your laptop), executed manually via
 * `npm run publish-embeds`; it is NOT part of the app runtime.
 *
 * Posture (decided 2026-07-21): iframe EMBED playback is the sanctioned path;
 * caption fetching is an undocumented endpoint and a grey zone we accept
 * knowingly — tiny text payloads, fetched once per video, cached forever in
 * data/embedVideos.json. Media download remains completely out.
 *
 * WHY IT LOOKS LIKE THIS — three hardenings, each found live and each fatal
 * on its own (2026-07-21). Do not "simplify" any of them away:
 *
 *   1. PO-TOKEN GATING. Caption URLs issued to the *web* client return an
 *      EMPTY 200 BODY (surfacing as "Unexpected end of JSON input"). This is
 *      not fixable with headers, cookies, referer, origin, `c=WEB`, `potc=1`,
 *      or a different `fmt` — all eight combinations were tested and all
 *      returned 0 bytes. Only URLs issued to a non-web client work.
 *   2. THE BOT CHECK. A bare InnerTube call is answered with LOGIN_REQUIRED
 *      ("confirm you're not a bot") or HTTP 400. The fix is `visitorData`:
 *      an anonymous session id, fetched once per run and put in the client
 *      context. WITH it, ANDROID_VR and IOS both return playability OK and
 *      ungated caption URLs; WITHOUT it, neither does. The plain ANDROID
 *      client is dead either way — it 400s now, attestation-gated.
 *   3. THE EU CONSENT WALL. Cookie-less page requests bounce to
 *      consent.youtube.com. Every non-API request sends consent cookies.
 *
 * Strategy order: ANDROID_VR, then IOS (same shape, independent client — if
 * one gets deprecated the other carries), then the watch page as a last
 * resort. The watch page is pot-gated today, so it will almost never be the
 * one that succeeds; it stays because it costs nothing when the others work
 * and it is the only path that survives InnerTube changing shape entirely.
 *
 * Track preference: ASR ('asr') FIRST even when an uploaded track exists —
 * only ASR carries per-word timestamps (tOffsetMs), and word timing is the
 * whole point. ASR text is lowercase/unpunctuated; downstream tolerates that.
 *
 * Set LORO_DEBUG_CAPTIONS=1 for per-step logging (see probe-captions.mts).
 */

export type Json3Seg = { utf8?: string; tOffsetMs?: number };
export type Json3Event = {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
  id?: number;
};
export type Json3 = { events?: Json3Event[] };

export type CaptionTrackInfo = {
  languageCode: string;
  kind: string; // 'asr' | '' (uploaded)
  baseUrl: string;
};

export class NoCaptionsError extends Error {
  constructor(videoId: string, detail: string) {
    super(`no usable Spanish captions for ${videoId}: ${detail}`);
    this.name = 'NoCaptionsError';
  }
}

const DEBUG = process.env.LORO_DEBUG_CAPTIONS === '1';
const dlog = (...args: unknown[]): void => {
  if (DEBUG) console.log('   [captions]', ...args);
};

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * The two InnerTube clients that still hand out ungated caption URLs.
 * Order matters only as redundancy — both were verified working live.
 */
const INNERTUBE_CLIENTS = [
  {
    label: 'android_vr',
    ua: 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; GB) gzip',
    client: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.61.48',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12',
    },
  },
  {
    label: 'ios',
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',
    client: {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
    },
  },
] as const;

const WATCH_HEADERS = {
  'user-agent': BROWSER_UA,
  'accept-language': 'es-ES,es;q=0.9,en;q=0.5',
  // Standard pre-granted consent pair; without it EU requests bounce to
  // consent.youtube.com and no player config ever loads.
  cookie: 'CONSENT=YES+cb.20220301-11-p0.en+FX+700; SOCS=CAI',
};

// ------------------------------------------------------- watch-page parsing

/**
 * Extract the caption track list from a watch page's embedded player config.
 *
 * Bracket-depth scanner, not a regex: the array nests further arrays
 * ("name":{"runs":[...]}) and URLs contain ']' — a lazy /\[.*?\]/ truncates
 * at the first inner ']' and the parse dies. Learned live.
 */
export function extractCaptionTracks(html: string): CaptionTrackInfo[] {
  const key = '"captionTracks":';
  const at = html.indexOf(key);
  if (at < 0) return [];
  const start = html.indexOf('[', at + key.length);
  if (start < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];

  try {
    // JSON.parse decodes & escapes in baseUrl natively.
    const raw = JSON.parse(html.slice(start, end + 1)) as {
      languageCode?: string;
      kind?: string;
      baseUrl?: string;
    }[];
    return raw
      .filter((t) => t.baseUrl && t.languageCode)
      .map((t) => ({
        languageCode: t.languageCode!,
        kind: t.kind ?? '',
        baseUrl: t.baseUrl!,
      }));
  } catch {
    return [];
  }
}

/** Pick the best Spanish track: ASR first (word timing), uploaded fallback. */
export function pickSpanishTrack(
  tracks: readonly CaptionTrackInfo[]
): CaptionTrackInfo | null {
  const spanish = tracks.filter((t) => t.languageCode.startsWith('es'));
  return spanish.find((t) => t.kind === 'asr') ?? spanish[0] ?? null;
}

// ------------------------------------------------------------- strategies

/**
 * Pull `visitorData` out of the service-worker bootstrap blob.
 *
 * sw.js_data is ~3KB and carries the same anonymous session id the watch page
 * embeds in 1.2MB of HTML — 400x cheaper, and we fetch it once per run. The
 * payload is an XSSI-guarded nested array, so the path is positional; if
 * YouTube reshapes it this returns null and we fall back to the watch page.
 */
export function extractVisitorData(swJsData: string): string | null {
  try {
    const parsed = JSON.parse(swJsData.replace(/^\)\]\}'\n?/, '')) as unknown;
    // Walk for the first string that looks like a visitor id rather than
    // trusting fixed indices — the blob's shape shifts between releases.
    const seen: unknown[] = [parsed];
    while (seen.length > 0) {
      const node = seen.pop();
      if (typeof node === 'string') {
        // Base64url with percent-encoded '=' padding, e.g. "...Xg%3D%3D".
        if (/^Cg[A-Za-z0-9_%=-]{20,}$/.test(node)) return node;
      } else if (Array.isArray(node)) {
        seen.push(...node);
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

let visitorDataCache: string | null | undefined;

/** Anonymous session id; without it InnerTube answers LOGIN_REQUIRED. */
async function getVisitorData(videoId: string): Promise<string | null> {
  if (visitorDataCache !== undefined) return visitorDataCache;

  try {
    const res = await fetch('https://www.youtube.com/sw.js_data', {
      headers: WATCH_HEADERS,
    });
    if (res.ok) {
      const found = extractVisitorData(await res.text());
      if (found) {
        dlog(`visitorData via sw.js_data: ${found.slice(0, 16)}…`);
        return (visitorDataCache = found);
      }
    }
    dlog(`visitorData: sw.js_data gave nothing (HTTP ${res.status}), trying watch page`);
  } catch (err) {
    dlog(`visitorData: sw.js_data failed (${err instanceof Error ? err.message : err})`);
  }

  try {
    const res = await fetch(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=es`,
      { headers: WATCH_HEADERS }
    );
    if (res.ok) {
      const raw = (await res.text()).match(/"visitorData":"([^"]+)"/)?.[1];
      if (raw) {
        const decoded = JSON.parse(`"${raw}"`) as string;
        dlog(`visitorData via watch page: ${decoded.slice(0, 16)}…`);
        return (visitorDataCache = decoded);
      }
    }
  } catch {
    /* fall through */
  }

  dlog('visitorData: UNAVAILABLE — InnerTube will likely bot-check');
  return (visitorDataCache = null);
}

/** Strategy 1/2: InnerTube player API with a non-web client. */
async function tracksViaInnerTube(
  videoId: string,
  spec: (typeof INNERTUBE_CLIENTS)[number],
  visitorData: string | null
): Promise<{ tracks: CaptionTrackInfo[]; playability: string }> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': spec.ua },
    body: JSON.stringify({
      context: {
        client: {
          ...spec.client,
          hl: 'es',
          gl: 'US',
          ...(visitorData ? { visitorData } : {}),
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  dlog(`${spec.label} player: HTTP ${res.status}`);
  if (!res.ok) return { tracks: [], playability: `http ${res.status}` };
  const data = (await res.json().catch(() => null)) as {
    playabilityStatus?: { status?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: { languageCode?: string; kind?: string; baseUrl?: string }[];
      };
    };
  } | null;
  const playability = data?.playabilityStatus?.status ?? 'unknown';
  dlog(`${spec.label} playability: ${playability}`);
  const raw = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  dlog(
    `${spec.label} tracks: ${raw.map((t) => `${t.languageCode}/${t.kind ?? 'up'}`).join(', ') || '(none)'}`
  );
  return {
    tracks: raw
      .filter((t) => t.baseUrl && t.languageCode)
      .map((t) => ({
        languageCode: t.languageCode!,
        kind: t.kind ?? '',
        baseUrl: t.baseUrl!,
      })),
    playability,
  };
}

/** Strategy 2: the watch page, with consent cookies. */
async function tracksViaWatchPage(videoId: string): Promise<{
  tracks: CaptionTrackInfo[];
  consentWalled: boolean;
}> {
  const res = await fetch(
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=es`,
    { headers: WATCH_HEADERS }
  );
  dlog(`watch page: HTTP ${res.status}`);
  if (!res.ok) return { tracks: [], consentWalled: false };
  const html = await res.text();
  const consentWalled = html.includes('consent.youtube.com');
  const tracks = extractCaptionTracks(html);
  dlog(
    `watch tracks: ${tracks.map((t) => `${t.languageCode}/${t.kind || 'up'}`).join(', ') || '(none)'}${consentWalled ? '  [consent-walled page]' : ''}`
  );
  return { tracks, consentWalled };
}

/** Fetch a track's json3 payload; null when the body is empty (pot-gated). */
async function fetchTrackJson3(
  track: CaptionTrackInfo,
  userAgent: string
): Promise<Json3 | null> {
  const url = new URL(track.baseUrl);
  url.searchParams.set('fmt', 'json3');
  const res = await fetch(url, {
    headers: { 'user-agent': userAgent, 'accept-language': 'es-ES,es;q=0.9' },
  });
  dlog(`track fetch: HTTP ${res.status}`);
  if (!res.ok) return null;
  const body = await res.text();
  dlog(`track body: ${body.length} bytes`);
  if (!body.trim()) return null; // the PO-token-gated empty 200
  try {
    return JSON.parse(body) as Json3;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ entry point

/**
 * Fetch the json3 caption payload for one video.
 *
 * Throws NoCaptionsError always; the MESSAGE decides what the publisher may
 * persist. Only track-level facts ('none Spanish', 'empty caption payload')
 * are definitive rejects — everything else reads as transient and retries on
 * a later run, because a bot-check page or endpoint change looks identical
 * to caption absence and must never mass-reject good candidates.
 */
export async function fetchCaptions(videoId: string): Promise<{
  json3: Json3;
  track: CaptionTrackInfo;
}> {
  const failures: string[] = [];
  const visitorData = await getVisitorData(videoId);

  // Strategies 1-2: InnerTube with a non-web client (the only ungated URLs).
  for (const spec of INNERTUBE_CLIENTS) {
    try {
      const { tracks, playability } = await tracksViaInnerTube(
        videoId,
        spec,
        visitorData
      );
      if (tracks.length === 0) {
        // A blocked/removed video is a fact about the video, but a bot check
        // is a fact about us — only the former may become a reject, and we
        // cannot tell them apart from here, so both stay transient.
        failures.push(`${spec.label}: no tracks (playability ${playability})`);
        continue;
      }
      const track = pickSpanishTrack(tracks);
      if (!track) {
        throw new NoCaptionsError(
          videoId,
          `tracks exist but none Spanish: ${tracks.map((t) => t.languageCode).join(',')}`
        );
      }
      const json3 = await fetchTrackJson3(track, spec.ua);
      if (json3?.events?.length) return { json3, track };
      if (json3 && !json3.events?.length) {
        throw new NoCaptionsError(videoId, 'empty caption payload');
      }
      failures.push(`${spec.label}: track URL returned empty body`);
    } catch (err) {
      if (err instanceof NoCaptionsError) throw err;
      failures.push(
        `${spec.label}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Strategy 3: watch page. Pot-gated today; kept as structural insurance.
  try {
    const { tracks, consentWalled } = await tracksViaWatchPage(videoId);
    if (tracks.length === 0) {
      failures.push(
        consentWalled
          ? 'watch page consent-walled despite consent cookies'
          : 'no captionTracks in player config'
      );
    } else {
      const track = pickSpanishTrack(tracks);
      if (!track) {
        throw new NoCaptionsError(
          videoId,
          `tracks exist but none Spanish: ${tracks.map((t) => t.languageCode).join(',')}`
        );
      }
      const json3 = await fetchTrackJson3(track, BROWSER_UA);
      if (json3?.events?.length) return { json3, track };
      if (json3 && !json3.events?.length) {
        throw new NoCaptionsError(videoId, 'empty caption payload');
      }
      failures.push('web track URL returned empty body (pot-gated)');
    }
  } catch (err) {
    if (err instanceof NoCaptionsError) throw err;
    failures.push(`watch: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Both strategies exhausted — always transient wording, never definitive.
  throw new NoCaptionsError(videoId, `all strategies failed: ${failures.join(' | ')}`);
}

/** Politeness delay between videos — this is a batch tool, not a crawler. */
export const CAPTION_FETCH_DELAY_MS = 1_500;
