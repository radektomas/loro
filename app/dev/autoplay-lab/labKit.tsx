'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { loadYouTubeApi } from '@/lib/youtubePlayer';

/**
 * Shared plumbing for /dev/autoplay-lab — the log store, the player mounter,
 * the verdict timers and the card UI.
 *
 * Everything here is read-only with respect to the app: the ONE thing it
 * borrows is loadYouTubeApi(), because that function is already the app's
 * single guarded injection point for https://www.youtube.com/iframe_api. Using
 * it (rather than a private copy) is what guarantees the script is injected
 * once per page load even if the feed has already booted a player in the same
 * SPA session.
 *
 * Results must be readable on a phone with no devtools attached, so nothing
 * here writes to console: every observation goes through labLog and is
 * rendered on-screen.
 */

// --------------------------------------------------------------- player types

/** The IFrame API surface this lab exercises — a superset of the feed's. */
export type LabPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(videoId: string): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getVolume(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
  getIframe?(): HTMLIFrameElement;
  getVideoData?(): { video_id?: string; title?: string };
};

type LabPlayerEvent = { target: LabPlayer; data: number };

type LabYT = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (e: { target: LabPlayer }) => void;
        onStateChange: (e: LabPlayerEvent) => void;
        onError: (e: LabPlayerEvent) => void;
      };
    }
  ) => LabPlayer;
};

export const UNSTARTED = -1;
export const ENDED = 0;
export const PLAYING = 1;
export const PAUSED = 2;
export const BUFFERING = 3;
export const CUED = 5;

const STATE_NAMES = new Map<number, string>([
  [UNSTARTED, 'UNSTARTED'],
  [ENDED, 'ENDED'],
  [PLAYING, 'PLAYING'],
  [PAUSED, 'PAUSED'],
  [BUFFERING, 'BUFFERING'],
  [CUED, 'CUED'],
]);

/** Always print the numeric code — it is the thing worth comparing later. */
export function fmtState(code: number | null | undefined): string {
  if (code === null || code === undefined || Number.isNaN(code)) return 'n/a';
  return `${code} ${STATE_NAMES.get(code) ?? 'UNKNOWN'}`;
}

const ERROR_NAMES = new Map<number, string>([
  [2, 'invalid parameter'],
  [5, 'HTML5 player error'],
  [100, 'video removed or private'],
  [101, 'embedding disallowed by owner'],
  [150, 'embedding disallowed by owner'],
]);

export function fmtError(code: number): string {
  return `${code} ${ERROR_NAMES.get(code) ?? 'unknown error code'}`;
}

/**
 * Which video the player currently holds, or null if it will not say.
 *
 * Exception-safe and undefined-safe on purpose: for a beat after
 * loadVideoById(), getVideoData() exists but RETURNS undefined (observed in
 * Chrome 146), so `getVideoData?.().video_id` throws — and it throws inside an
 * onStateChange handler, where it would take the verdict machinery with it.
 */
export function currentVideoId(player: LabPlayer | null): string | null {
  try {
    return player?.getVideoData?.()?.video_id ?? null;
  } catch {
    return null;
  }
}

/** Read one getter without letting it take the whole log line down with it. */
function safeRead<T>(read: () => T): T | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

/**
 * One-line dump of everything the player will tell us right now, field by
 * field.
 *
 * Deliberately not one try/catch around the lot: in the moments after
 * loadVideoById() individual getters return undefined (getCurrentTime() and
 * getVideoData() both observed doing it in Chrome 146), and that instant is
 * precisely what tests 5 and 6 are inspecting. Losing four good fields because
 * the fifth was briefly absent would throw away the observation.
 */
export function playerInfo(player: LabPlayer | null): string {
  if (!player) return 'player=null';
  const time = safeRead(() => player.getCurrentTime());
  return [
    `state=${fmtState(safeRead(() => player.getPlayerState()))}`,
    `muted=${safeRead(() => player.isMuted()) ?? '?'}`,
    `volume=${safeRead(() => player.getVolume()) ?? '?'}`,
    `t=${typeof time === 'number' && Number.isFinite(time) ? `${time.toFixed(2)}s` : '?'}`,
    `video=${currentVideoId(player) ?? '?'}`,
  ].join(' ');
}

// ---------------------------------------------------------------- the corpus

/**
 * Four real feed embeds, copied out of data/embedVideos.json (Spanish audio,
 * Czech glosses — the rows the feed actually serves). Hardcoded rather than
 * imported so this page stays isolated from feed code, and picked from the
 * longest available so a 10s clock sample or a trip through the app switcher
 * never runs off the end of the video.
 */
export const LAB_VIDEOS = [
  { id: 'guIID3CEwuM', creator: 'Resilentos', seconds: 73 },
  { id: '-PtGkAdnh6c', creator: 'IMachupicchu', seconds: 72 },
  { id: 'kosUAkqDW9U', creator: 'Gipsy Chef TV', seconds: 68 },
  { id: 'eakrXq3qa0Y', creator: 'JuanFe Castro', seconds: 66 },
] as const;

export const [VID_A, VID_B, VID_C, VID_D] = LAB_VIDEOS;

// ------------------------------------------------------------- the log store

export type LogEntry = {
  seq: number;
  /** Wall clock, so a log pasted back can be lined up against other traces. */
  wall: string;
  /** Milliseconds since this page load — the axis that matters for autoplay. */
  sinceLoad: number;
  scope: string;
  text: string;
};

const MAX_ENTRIES = 2_000;
const EMPTY: readonly LogEntry[] = [];

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

class LabLogStore {
  private entries: readonly LogEntry[] = EMPTY;
  private listeners = new Set<() => void>();
  private seq = 0;
  private readonly t0 =
    typeof performance === 'undefined' ? 0 : performance.now();

  push(scope: string, text: string): void {
    const now = new Date();
    const entry: LogEntry = {
      seq: ++this.seq,
      wall: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
        now.getSeconds()
      )}.${pad(now.getMilliseconds(), 3)}`,
      sinceLoad: Math.round(performance.now() - this.t0),
      scope,
      text,
    };
    // Copy-on-write so useSyncExternalStore sees a new snapshot. Logging is
    // human-paced (the 60fps clock test reports aggregates, never per frame),
    // so the copy is never on a hot path.
    const next = [...this.entries, entry];
    this.entries = next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
    for (const fn of this.listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): readonly LogEntry[] => this.entries;

  getServerSnapshot = (): readonly LogEntry[] => EMPTY;

  toText(): string {
    return this.entries
      .map(
        (e) =>
          `${e.wall}  +${(e.sinceLoad / 1000).toFixed(3)}s  [${e.scope}] ${e.text}`
      )
      .join('\n');
  }
}

export const labLog = new LabLogStore();

export function useLogEntries(): readonly LogEntry[] {
  return useSyncExternalStore(
    labLog.subscribe,
    labLog.getSnapshot,
    labLog.getServerSnapshot
  );
}

// -------------------------------------------------------- activation tracking

/**
 * Every card is started by a tap on its Run button — which is itself a user
 * gesture, and on Safari activation is sticky for the page load. So a "blessed
 * play" three seconds after Run may owe its success to the Run tap rather than
 * to the gesture under test. That confound cannot be removed, only measured:
 * this counter is stamped into every verdict, and the ?run= auto-run (below)
 * exists so tests 1-4 can be taken with the count still at zero.
 */
let gestureCount = 0;
let firstGestureAt: number | null = null;
const seenGestureTypes = new Set<string>();

/**
 * Gestures seen on this page load.
 *
 * Exposed as a number, not just inside activationInfo()'s string, because a
 * test whose whole premise is "no gesture happened here" has to be able to
 * PROVE it: card 10 samples this before its unattended window and again at the
 * verdict, and reports the run as contaminated if a stray tap landed in
 * between. Otherwise an accidental touch reads as a passing result.
 */
export function pageGestureCount(): number {
  return gestureCount;
}

export function activationInfo(): string {
  const ago =
    firstGestureAt === null
      ? 'never'
      : `${Math.round(performance.now() - firstGestureAt)}ms ago`;
  return `pageGestures=${gestureCount} firstGesture=${ago}`;
}

function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return 'non-element';
  const label = target.textContent?.trim().slice(0, 24);
  return `<${target.tagName.toLowerCase()}>${label ? ` "${label}"` : ''}`;
}

if (typeof document !== 'undefined') {
  for (const type of ['touchstart', 'pointerdown', 'mousedown', 'click', 'keydown']) {
    document.addEventListener(
      type,
      (event) => {
        gestureCount += 1;
        if (firstGestureAt === null) firstGestureAt = performance.now();
        if (!seenGestureTypes.has(type)) {
          seenGestureTypes.add(type);
          labLog.push(
            'activation',
            `first ${type} on this page load, target ${describeTarget(event.target)}`
          );
        }
      },
      // Capture + passive: observe only. Nothing here may alter how the
      // browser treats the gesture the lab is trying to measure.
      { capture: true, passive: true }
    );
  }
}

// ------------------------------------------------------------- the embed host

/**
 * The feed embeds via youtube-nocookie.com, so that is the default here — a
 * result taken against a different host would not be a result about the feed.
 * The toggle exists because "is the privacy-enhanced host itself refusing
 * autoplay" is otherwise an untestable confound. It applies to players mounted
 * from now on, not to ones already running.
 */
export type EmbedHost = 'nocookie' | 'youtube';

let embedHost: EmbedHost = 'nocookie';

export function getEmbedHost(): EmbedHost {
  return embedHost;
}

export function setEmbedHost(next: EmbedHost): void {
  embedHost = next;
  labLog.push('config', `embed host set to ${embedHostUrl()}`);
}

export function embedHostUrl(): string {
  return embedHost === 'nocookie'
    ? 'https://www.youtube-nocookie.com'
    : 'https://www.youtube.com';
}

// ----------------------------------------------------------- player registry

type LiveEntry = { scope: string; player: LabPlayer };

const livePlayers = new Set<LiveEntry>();

/**
 * Destroy every live player.
 *
 * Called at the top of every card's Run, and this is not housekeeping — it is
 * what makes the results mean anything. Nine cards each leaving a YouTube embed
 * playing starves the page: measured on desktop Chrome, the sixth card's play
 * attempt missed a 5s deadline and a 2s timer overran by more than 9s purely
 * from the load of five live players. On a phone it is worse. So a run always
 * starts on an unloaded device, and the count is logged rather than implied.
 */
export function destroyAllPlayers(requestedBy: string): number {
  const entries = [...livePlayers];
  livePlayers.clear();
  for (const entry of entries) {
    try {
      entry.player.pauseVideo();
    } catch {
      // Already gone; we are destroying it anyway.
    }
    try {
      entry.player.destroy();
    } catch {
      // The iframe may already be detached.
    }
  }
  if (entries.length > 0) {
    labLog.push(
      requestedBy,
      `destroyed ${entries.length} live player(s) so this run is isolated: ${entries
        .map((entry) => entry.scope)
        .join(', ')}`
    );
  }
  return entries.length;
}

export function destroyLabPlayer(player: LabPlayer | null, scope: string): void {
  if (!player) return;
  for (const entry of [...livePlayers]) {
    if (entry.player === player) livePlayers.delete(entry);
  }
  try {
    player.pauseVideo();
  } catch {
    // Fine — we are about to destroy it.
  }
  try {
    player.destroy();
  } catch {
    // The iframe may already be detached.
  }
  labLog.push(scope, 'player destroyed');
}

// ------------------------------------------------------------ mounting a player

export type MountOptions = {
  /** Wrapper element; a fresh child div is created inside it per mount. */
  mount: HTMLElement;
  videoId: string;
  scope: string;
  autoplay: boolean;
  muted: boolean;
  /** Distinguishes players within one card (the dual-player test). */
  tag?: string;
  onState?: (code: number, player: LabPlayer) => void;
  onError?: (code: number) => void;
};

/** Outer bound on the whole boot; a dead iframe must not hang a card forever. */
const READY_TIMEOUT_MS = 15_000;

/**
 * Create a player and resolve on onReady.
 *
 * A brand-new child div is used for every mount because YT.Player REPLACES
 * the element it is handed with an iframe — re-running a card against the
 * original node would fail on the second Run.
 */
export function mountLabPlayer(options: MountOptions): Promise<LabPlayer> {
  const { mount, videoId, scope, autoplay, muted, tag } = options;
  const label = tag ? `${scope}/${tag}` : scope;
  return loadYouTubeApi().then((namespace) => {
    const YT = namespace as unknown as LabYT;
    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    mount.replaceChildren(host);

    return new Promise<LabPlayer>((resolve, reject) => {
      const t0 = performance.now();
      let settled = false;
      const since = () => Math.round(performance.now() - t0);

      labLog.push(
        label,
        `mounting player: video=${videoId} autoplay=${autoplay ? 1 : 0} ` +
          `mute=${muted ? 1 : 0} playsinline=1 enablejsapi=1 host=${embedHostUrl()} — ${activationInfo()}`
      );

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        labLog.push(label, `onReady never fired within ${READY_TIMEOUT_MS}ms`);
        reject(new Error('player never became ready'));
      }, READY_TIMEOUT_MS);

      const player = new YT.Player(host, {
        videoId,
        host: embedHostUrl(),
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          mute: muted ? 1 : 0,
          // Both required on iOS: playsinline stops the takeover into the
          // native fullscreen player, enablejsapi is what makes the postMessage
          // control channel exist at all.
          playsinline: 1,
          enablejsapi: 1,
          // No native chrome, matching the feed — a stray tap on YouTube's own
          // play button inside the iframe would silently invalidate a result.
          controls: 0,
          rel: 0,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            labLog.push(
              label,
              `onReady after ${since()}ms — ${playerInfo(player)}`
            );
            try {
              const iframe = player.getIframe?.();
              if (iframe) labLog.push(label, `iframe src: ${iframe.src}`);
            } catch {
              // getIframe is not in the documented surface on every build.
            }
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(player);
          },
          onStateChange: (event) => {
            labLog.push(
              label,
              `onStateChange -> ${fmtState(event.data)} at +${since()}ms`
            );
            options.onState?.(event.data, player);
          },
          onError: (event) => {
            labLog.push(
              label,
              `onError -> ${fmtError(event.data)} at +${since()}ms`
            );
            options.onError?.(event.data);
          },
        },
      });

      livePlayers.add({ scope: label, player });
    });
  });
}

// ------------------------------------------------------------ verdict timers

export type Verdict = {
  reached: boolean;
  ms: number;
  lastCode: number | null;
};

export type PlayWatch = {
  /** Feed every onStateChange in; returns true once the watch has settled. */
  note(code: number): boolean;
  cancel(): void;
  readonly done: boolean;
};

/**
 * "Did it reach PLAYING within N ms" — the single question tests 1-5 and 7 all
 * ask. Resolving on the PLAYING event rather than by polling getPlayerState()
 * matters: a blocked play on iOS produces no state change at all, so the
 * timeout IS the negative result.
 */
export function createPlayWatch(options: {
  scope: string;
  /** What is being measured, e.g. 'autoplay muted' or 'after touchstart'. */
  label: string;
  timeoutMs: number;
  getPlayer: () => LabPlayer | null;
  onVerdict: (verdict: Verdict) => void;
  /**
   * Extra condition on a PLAYING event. loadVideoById() needs it: the player is
   * usually still PLAYING the previous video when the swap is issued, and a
   * trailing event from that video would otherwise be counted as the new one
   * having started. Test 5 gates on the reported video id.
   */
  accept?: () => boolean;
}): PlayWatch {
  const t0 = performance.now();
  let lastCode: number | null = null;
  let done = false;

  const finish = (reached: boolean): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const ms = Math.round(performance.now() - t0);
    const detail = reached
      ? `PLAYING after ${ms}ms`
      : `NO PLAYING within ${options.timeoutMs}ms (last onStateChange ${fmtState(
          lastCode
        )})`;
    labLog.push(
      options.scope,
      `VERDICT ${options.label}: ${detail} — ${playerInfo(
        options.getPlayer()
      )} — ${activationInfo()}`
    );
    options.onVerdict({ reached, ms, lastCode });
  };

  const timer = setTimeout(() => finish(false), options.timeoutMs);

  return {
    note(code: number): boolean {
      lastCode = code;
      if (code === PLAYING) {
        if (options.accept?.() ?? true) finish(true);
        else
          labLog.push(
            options.scope,
            `${options.label}: PLAYING ignored — ${playerInfo(
              options.getPlayer()
            )} is not the video this probe is waiting for`
          );
      }
      return done;
    },
    cancel(): void {
      done = true;
      clearTimeout(timer);
    },
    get done(): boolean {
      return done;
    },
  };
}

/** Several probes can be in flight at once (test 5 fires two swaps). */
export function createWatchSet() {
  const set = new Set<PlayWatch>();
  return {
    add(watch: PlayWatch): PlayWatch {
      set.add(watch);
      return watch;
    },
    note(code: number): void {
      for (const watch of [...set]) {
        if (watch.note(code)) set.delete(watch);
      }
    },
    cancelAll(): void {
      for (const watch of set) watch.cancel();
      set.clear();
    },
  };
}

// ---------------------------------------------------------------- lifecycles

/**
 * Timers and document listeners registered by a run, cleared on the next run
 * and on unmount — otherwise a re-run leaves the previous run's one-shot
 * touchstart listener armed and the two results get mixed together.
 */
export function useTeardown() {
  const items = useRef<Array<() => void>>([]);

  const add = useCallback((fn: () => void) => {
    items.current.push(fn);
  }, []);

  const runAll = useCallback(() => {
    const pending = items.current;
    items.current = [];
    for (const fn of pending) {
      try {
        fn();
      } catch {
        // Teardown is best-effort by definition.
      }
    }
  }, []);

  useEffect(() => () => runAll(), [runAll]);

  return { add, runAll };
}

const autoRunHandled = new Set<string>();

export function autoRunTarget(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('run');
}

/**
 * Run a card automatically on page load, from ?run=<cardId>.
 *
 * This is the only way to measure true autoplay: pressing Run is itself a
 * user gesture, and on Safari that gesture is sticky for the page load.
 * Arriving via a link means activation is back to zero (it does not survive a
 * navigation), so tests 1-4 can be taken with an untouched page.
 */
export function useAutoRun(
  cardId: string,
  run: () => void,
  scrollTo: RefObject<HTMLElement | null>
): void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);

  useEffect(() => {
    if (autoRunTarget() !== cardId) return;
    // Guard the dev-mode double effect invocation, which would otherwise mount
    // two players and interleave their state changes in the log.
    if (autoRunHandled.has(cardId)) return;
    autoRunHandled.add(cardId);
    labLog.push(
      cardId,
      `AUTO-RUN via ?run=${cardId} — ${activationInfo()} (a clean run needs pageGestures=0)`
    );
    scrollTo.current?.scrollIntoView({ block: 'center' });
    latest.current();
  }, [cardId, scrollTo]);
}

// -------------------------------------------------------------------- numbers

export type Stats = {
  n: number;
  min: number;
  max: number;
  mean: number;
  /** Largest absolute deviation from the mean — our jitter measure. */
  jitter: number;
};

export function stats(values: readonly number[]): Stats | null {
  if (values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  const mean = sum / values.length;
  let jitter = 0;
  for (const value of values) {
    jitter = Math.max(jitter, Math.abs(value - mean));
  }
  return { n: values.length, min, max, mean, jitter };
}

export function ms(value: number): string {
  return `${value.toFixed(1)}ms`;
}

// ------------------------------------------------------------------ clipboard

export type CopyResult = 'clipboard' | 'execCommand' | 'failed';

/**
 * Copy without assuming a secure context. Testing on a physical iPhone means
 * hitting the dev server at http://192.168.x.x, where navigator.clipboard does
 * not exist — so the execCommand path is the one that will actually run, and
 * the select-all box under the log is the last resort.
 */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch {
    // Insecure origin or a denied permission — fall through.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.setSelectionRange(0, area.value.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok ? 'execCommand' : 'failed';
  } catch {
    return 'failed';
  }
}

// -------------------------------------------------------------------- card UI

export type StatusKind = 'idle' | 'running' | 'waiting' | 'pass' | 'fail' | 'info';
export type Status = { kind: StatusKind; text: string };

const DOT: Record<StatusKind, string> = {
  idle: 'bg-muted',
  running: 'bg-level',
  waiting: 'bg-yellow-400',
  pass: 'bg-accent',
  fail: 'bg-red-400',
  info: 'bg-level',
};

const TEXT: Record<StatusKind, string> = {
  idle: 'text-muted',
  running: 'text-text',
  waiting: 'text-yellow-300',
  pass: 'text-accent',
  fail: 'text-red-300',
  info: 'text-text',
};

export function TestCard({
  id,
  n,
  title,
  question,
  cardRef,
  children,
}: {
  id: string;
  n: number;
  title: string;
  question: string;
  cardRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      ref={cardRef}
      className="scroll-mt-4 rounded-3xl bg-surface p-4"
    >
      <h2 className="text-sm font-semibold">
        <span className="text-accent">{n}.</span> {title}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">{question}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function StatusLine({ status }: { status: Status }) {
  return (
    <p className="flex items-start gap-2 font-mono text-xs leading-relaxed">
      <span
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[status.kind]} ${
          status.kind === 'running' || status.kind === 'waiting'
            ? 'animate-pulse'
            : ''
        }`}
      />
      <span className={TEXT[status.kind]}>{status.text}</span>
    </p>
  );
}

export function LabButton({
  onClick,
  disabled,
  children,
  tone = 'default',
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  tone?: 'default' | 'primary';
}) {
  const base =
    'min-h-11 rounded-full px-4 text-xs font-semibold transition disabled:opacity-35';
  const skin =
    tone === 'primary'
      ? 'bg-accent text-[#0a0d0b] active:bg-accent-deep'
      : 'bg-surface-raised text-text active:bg-[#2a352c]';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${skin}`}>
      {children}
    </button>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/** The wrapper YT.Player mounts into. Kept small: the page must stay scrollable. */
export function PlayerStage({
  mountRef,
  caption,
}: {
  mountRef: RefObject<HTMLDivElement | null>;
  caption?: string;
}) {
  return (
    <div className="w-full max-w-[220px]">
      <div
        ref={mountRef}
        className="aspect-video w-full overflow-hidden rounded-2xl bg-black"
      />
      {caption ? (
        <p className="mt-1 font-mono text-[10px] text-muted">{caption}</p>
      ) : null}
    </div>
  );
}

export function Prompt({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-yellow-400/60 bg-yellow-400/10 p-3 text-center text-xs font-semibold text-yellow-200">
      {children}
    </p>
  );
}

export function Metrics({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-2xl bg-background/60 p-3 font-mono text-[11px]">
      {rows.map(([key, value]) => (
        <div key={key} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-muted">{key}</dt>
          <dd className="break-words text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Link that reloads the page straight into this card with no prior tap. */
export function CleanRunLink({ id }: { id: string }) {
  return (
    <a
      href={`?run=${id}#${id}`}
      className="inline-block font-mono text-[11px] text-level underline decoration-dotted"
    >
      clean run: reload with 0 page gestures →
    </a>
  );
}

/** Shared bookkeeping for the "state code sequence" every card displays. */
export function useStateSequence() {
  const [codes, setCodes] = useState<readonly number[]>([]);
  const record = useCallback((code: number) => {
    setCodes((previous) => [...previous, code]);
  }, []);
  const reset = useCallback(() => setCodes([]), []);
  const text =
    codes.length === 0
      ? '—'
      : codes.map((code) => `${code}${STATE_NAMES.has(code) ? '' : '?'}`).join(' → ');
  return { codes, record, reset, text };
}
