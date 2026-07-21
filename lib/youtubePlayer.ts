'use client';

import type { FeedMedia } from '@/types';

/**
 * YouTube IFrame Player API adapter — implements the FeedMedia surface the
 * feed drives, over the OFFICIAL embed player. Playback through the iframe is
 * the sanctioned path for standard-licence videos and costs zero API quota.
 *
 * Design constraints this class exists to satisfy:
 *
 * 1. OPTIMISTIC CLOCK. The iframe reports currentTime via postMessage every
 *    ~250ms, but SubtitleTrack reads it every animation frame and — the sharp
 *    edge — RE-SEATS it whenever a paused clock drifts >0.05s from a blank's
 *    pause point. A naive proxy to player.getCurrentTime() would jitter the
 *    karaoke highlight at 4fps and enter a per-frame seek loop at every blank.
 *    So reads are answered from a local model: the last reported time,
 *    extrapolated with performance.now() while playing, and writes take
 *    effect on the local model INSTANTLY while seekTo() catches up behind.
 *
 * 2. LAZY BOOT. Every feed slide mounts at once; N iframes would be N full
 *    player bootstraps. The player is only created on the first play() —
 *    i.e. when the slide first becomes the active one. pause()/seek on a
 *    never-activated slide just update the local model.
 *
 * 3. AUTOPLAY PARITY. Feed's safePlay() expects the DOM contract: a play()
 *    that cannot start rejects with NotAllowedError (it then retries muted).
 *    The iframe API has no such rejection — a blocked play just never reaches
 *    PLAYING. We emulate: play() resolves on PLAYING and rejects with a
 *    synthetic NotAllowedError after a timeout, AbortError if pause() lands
 *    first. The existing muted-fallback path then works unchanged.
 */

// ------------------------------------------------------- minimal API typing
// No @types/youtube dependency for one class: these are the exact members we
// touch, nothing more.

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
};

type YTPlayerEvent = { target: YTPlayer; data?: number };

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (e: YTPlayerEvent) => void;
        onStateChange: (e: YTPlayerEvent) => void;
        onError: (e: YTPlayerEvent) => void;
      };
    }
  ) => YTPlayer;
  PlayerState: Record<string, number>;
};

// Player states (stable public constants of the IFrame API).
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const CUED = 5;

// ------------------------------------------------------------- script loader

let apiPromise: Promise<YTNamespace> | null = null;

/** Load https://www.youtube.com/iframe_api once; resolve with the namespace. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const w = window as unknown as {
      YT?: YTNamespace;
      onYouTubeIframeAPIReady?: () => void;
    };
    if (w.YT?.Player) {
      resolve(w.YT);
      return;
    }
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(w.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      // Un-poison so a later slide can retry (matches prepareClip's pattern).
      apiPromise = null;
      reject(new Error('YouTube IFrame API failed to load'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

/**
 * Has the user interacted with the page since it loaded?
 *
 * Phones grant audio per page load, not per preference: a stored "sound on"
 * from an earlier visit buys nothing. Unmuting a playing video before that
 * grant does not merely stay silent on Safari — it PAUSES the video. So the
 * adapter restores sound only once this is true; until then playback runs
 * muted, which is always permitted.
 *
 * navigator.userActivation would be the direct question to ask, but Safari
 * does not implement it — which is the exact browser this guards. A capture
 * listener on the first pointer/key event is portable and equivalent for our
 * purpose (any touch, including the scroll that moves to the next slide).
 */
let hasUserActivation = false;
/** Players already running muted that want sound the moment a touch lands. */
const awaitingActivation = new Set<() => void>();
if (typeof document !== 'undefined') {
  const mark = () => {
    hasUserActivation = true;
    for (const restore of awaitingActivation) restore();
    awaitingActivation.clear();
  };
  const opts = { once: true, capture: true, passive: true } as const;
  document.addEventListener('pointerdown', mark, opts);
  document.addEventListener('touchstart', mark, opts);
  document.addEventListener('keydown', mark, opts);
}

// ----------------------------------------------------------------- the shim

type PendingPlay = {
  resolve: () => void;
  reject: (err: unknown) => void;
  /** Null until playVideo() has actually been issued (see armPlayTimeout). */
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * How long an unanswered playVideo() waits before we call it blocked.
 *
 * The timer is armed only once playVideo() has ACTUALLY been called — i.e.
 * after the API script, the iframe and onReady are all done. Arming it at
 * play() time instead would make a slow first boot indistinguishable from an
 * autoplay block: Feed would mute the media and flip the whole feed's sound
 * state off on a cold-network timing artifact.
 */
const PLAY_TIMEOUT_MS = 2_500;
/**
 * Outer bound covering the whole cold boot: API script fetch, iframe
 * construction, onReady. Generous, because a slow network must NOT read as
 * an autoplay block — but finite, because an iframe that never becomes ready
 * (blocked by an extension, unavailable video) would otherwise leave play()
 * unsettled forever and Feed's muted fallback would never fire.
 */
const BOOT_TIMEOUT_MS = 12_000;
/** A seek counts as landed only when a NEW sample arrives near the target. */
const SEEK_CONVERGENCE_S = 0.35;
/** ...or once this much time has passed (the player simply is where it is). */
const SEEK_TIMEOUT_MS = 1_500;

export class YouTubeMedia implements FeedMedia {
  readonly preload = 'metadata';

  private readonly host: HTMLElement;
  private readonly videoId: string;
  private readonly fallbackDuration: number;
  private player: YTPlayer | null = null;
  private playerReady = false;
  private creating = false;
  private destroyed = false;

  private desired: 'playing' | 'paused' = 'paused';
  private playing = false;
  private _muted = true;

  // The local clock model (see design note 1).
  private anchorTime = 0;
  private anchorAt = 0;
  private lastRaw = -1;
  private pendingSeek: {
    target: number;
    at: number;
    /** What the player reported at the instant we asked — see the getter. */
    sampleAtWrite: number;
  } | null = null;

  private pendingPlay: PendingPlay | null = null;
  private listeners = new Map<string, Set<() => void>>();

  constructor(host: HTMLElement, videoId: string, durationSeconds?: number) {
    this.host = host;
    this.videoId = videoId;
    this.fallbackDuration = durationSeconds ?? NaN;
    this.anchorAt = performance.now();
  }

  // -------------------------------------------------------------- the clock

  get currentTime(): number {
    // PAUSED: the local model is authoritative, full stop. Nothing advances
    // while paused, so the last written/known value IS the position — and
    // reporting the iframe's coarse, ~250ms-stale sample instead is what
    // would make SubtitleTrack's blank-hold re-seat (it re-writes whenever
    // the paused clock drifts >0.05s from the pause point) fight the player
    // forever, one seekTo per animation frame.
    if (!this.playing) return this.anchorTime;

    if (!this.playerReady) return this.anchorTime;

    // PLAYING: a fresh write wins until the player demonstrably acts on it.
    // "Demonstrably" is the subtle part — proximity to the target proves
    // nothing, because a small seek (every SubtitleTrack clamp is a frame's
    // worth, ~16ms) starts out within tolerance of the pre-seek position.
    // So the seek has landed only once the player reports a sample that has
    // both CHANGED from what it read at write time and is near the target.
    if (this.pendingSeek) {
      const raw = this.player!.getCurrentTime();
      const moved =
        Number.isFinite(raw) &&
        Number.isFinite(this.pendingSeek.sampleAtWrite) &&
        raw !== this.pendingSeek.sampleAtWrite;
      const nearTarget =
        Number.isFinite(raw) &&
        Math.abs(raw - this.pendingSeek.target) < SEEK_CONVERGENCE_S;
      const expired = performance.now() - this.pendingSeek.at > SEEK_TIMEOUT_MS;
      if (!((moved && nearTarget) || expired)) return this.pendingSeek.target;
      this.pendingSeek = null;
      this.lastRaw = raw;
      this.anchorTime = raw;
      this.anchorAt = performance.now();
    }

    const raw = this.player!.getCurrentTime() ?? 0;
    // Re-anchor whenever the iframe posts a fresh sample; extrapolate between.
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      this.anchorTime = raw;
      this.anchorAt = performance.now();
    }
    const extrapolated = this.anchorTime + (performance.now() - this.anchorAt) / 1000;
    const total = this.duration;
    return Number.isFinite(total) && total > 0
      ? Math.min(extrapolated, total)
      : extrapolated;
  }

  set currentTime(t: number) {
    this.anchorTime = t;
    this.anchorAt = performance.now();
    this.pendingSeek = {
      target: t,
      at: performance.now(),
      // Snapshot what the player reports RIGHT NOW, so the getter can tell
      // "the seek landed" from "the player never moved" — proximity alone
      // cannot, since small seeks start out near the old position.
      sampleAtWrite: this.playerReady ? this.player!.getCurrentTime() : NaN,
    };
    if (this.playerReady) this.player!.seekTo(t, true);
    // Not ready: the seek is applied in onReady from anchorTime.
  }

  get duration(): number {
    if (this.playerReady) {
      const d = this.player!.getDuration();
      if (d > 0) return d;
    }
    return this.fallbackDuration;
  }

  get paused(): boolean {
    return !this.playing;
  }

  get readyState(): number {
    // 4 = HAVE_ENOUGH_DATA once the player exists; 1 = HAVE_METADATA when we
    // at least know the duration from harvest data (deep-link seeks rely on
    // readyState >= 1 meaning "currentTime writes stick" — ours always do).
    if (this.playerReady) return 4;
    return Number.isFinite(this.fallbackDuration) ? 1 : 0;
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(value: boolean) {
    this._muted = value;
    if (this.playerReady) {
      if (value) this.player!.mute();
      else this.player!.unMute();
    }
  }

  // ----------------------------------------------------------- play control

  play(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.desired = 'playing';
    this.ensurePlayer();
    if (this.playerReady) this.player!.playVideo();
    if (this.playing) return Promise.resolve();
    this.settlePendingPlay(new DOMException('interrupted by a new play()', 'AbortError'));
    return new Promise<void>((resolve, reject) => {
      this.pendingPlay = { resolve, reject, timer: null };
      // Two different clocks. If playVideo() has genuinely been issued, a
      // short silence means blocked playback. If we are still booting, only
      // the generous outer bound applies — timing the boot as if it were a
      // play attempt turns a slow network into a fake NotAllowedError, and
      // Feed answers that by muting and flipping the feed's sound state off.
      this.armPlayTimeout(this.playerReady ? PLAY_TIMEOUT_MS : BOOT_TIMEOUT_MS);
    });
  }

  /** (Re)start the blocked-playback timer; later calls replace earlier ones. */
  private armPlayTimeout(ms: number): void {
    const pending = this.pendingPlay;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      if (this.pendingPlay !== pending) return;
      this.pendingPlay = null;
      // Same name the DOM uses for gesture-gated autoplay, so Feed's
      // muted-retry fallback fires exactly as it does for <video>.
      pending.reject(new DOMException('playback blocked', 'NotAllowedError'));
    }, ms);
  }

  pause(): void {
    this.desired = 'paused';
    this.settlePendingPlay(new DOMException('interrupted by pause()', 'AbortError'));
    if (this.playerReady) this.player!.pauseVideo();
    // No player yet: nothing is audibly playing; the model is already paused.
  }

  load(): void {
    // preload is always 'metadata'; nothing to do.
  }

  /** Bound so it can be added to and removed from awaitingActivation. */
  private restoreSound = (): void => {
    if (this.destroyed || !this.player || this._muted) return;
    this.player.unMute();
  };

  destroy(): void {
    this.destroyed = true;
    awaitingActivation.delete(this.restoreSound);
    this.settlePendingPlay(new DOMException('media destroyed', 'AbortError'));
    this.listeners.clear();
    if (this.player) {
      try {
        this.player.destroy();
      } catch {
        // The iframe may already be gone mid-unmount; nothing to clean.
      }
      this.player = null;
    }
    this.playerReady = false;
    this.playing = false;
  }

  private settlePendingPlay(error: unknown): void {
    if (!this.pendingPlay) return;
    const pending = this.pendingPlay;
    this.pendingPlay = null;
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(error);
  }

  // ---------------------------------------------------------------- events

  addEventListener(
    type: string,
    listener: () => void,
    options?: boolean | AddEventListenerOptions
  ): void {
    const once = typeof options === 'object' && options?.once;
    const set = this.listeners.get(type) ?? new Set();
    if (once) {
      const wrapped = () => {
        this.removeEventListener(type, wrapped);
        listener();
      };
      // Track under the ORIGINAL listener too so removeEventListener works.
      (wrapped as { original?: () => void }).original = listener;
      set.add(wrapped);
    } else {
      set.add(listener);
    }
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      if (fn === listener || (fn as { original?: () => void }).original === listener) {
        set.delete(fn);
      }
    }
  }

  private emit(type: string): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn();
  }

  // ----------------------------------------------------------- player boot

  private ensurePlayer(): void {
    if (this.player || this.creating || this.destroyed) return;
    this.creating = true;
    loadYouTubeApi()
      .then((YT) => {
        if (this.destroyed) return;
        this.player = new YT.Player(this.host, {
          videoId: this.videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            // No native controls: the band UI is the interface. playsinline
            // keeps iOS from hijacking into fullscreen.
            autoplay: 0,
            controls: 0,
            playsinline: 1,
            // REQUIRED for autoplay on phones. Mobile browsers decide whether
            // a gesture-free play() is allowed from the player's state at
            // CREATION, so calling player.mute() later in onReady is too
            // late: without this the feed loaded muted, playVideo() was
            // refused on every slide, and each video had to be tapped.
            // Desktop is lenient about it, so the bug only showed on a phone.
            // The user's sound choice is applied on top of this in
            // handleReady (unMute) once playback is under way.
            mute: 1,
            rel: 0,
            fs: 0,
            disablekb: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: () => this.handleReady(),
            onStateChange: (e) => this.handleStateChange(e.data ?? -2),
            onError: () => this.handleError(),
          },
        });
      })
      .catch(() => {
        this.creating = false;
        this.settlePendingPlay(
          new DOMException('YouTube API unavailable', 'NotAllowedError')
        );
      });
  }

  private handleReady(): void {
    if (this.destroyed || !this.player) return;
    this.playerReady = true;
    // ALWAYS start muted, even when the user's stored preference is sound-on.
    // A phone grants audio only after a gesture IN THIS PAGE LOAD, and a
    // preference persisted from an earlier visit is not one — so unmuting
    // here made the very first playVideo() an unmuted autoplay, which iOS
    // refuses outright, leaving YouTube's own red play button on every
    // slide. Muted autoplay is always permitted, so we take it and restore
    // sound the instant playback is actually running (see PLAYING).
    this.player.mute();
    if (this.anchorTime > 0.25) this.player.seekTo(this.anchorTime, true);
    this.emit('loadedmetadata');
    if (this.desired === 'playing') {
      this.player.playVideo();
      // Boot is done, so swap the generous boot bound for the short one:
      // silence from here really does mean blocked playback.
      this.armPlayTimeout(PLAY_TIMEOUT_MS);
    }
  }

  private handleStateChange(state: number): void {
    if (this.destroyed || !this.player) return;
    switch (state) {
      case PLAYING: {
        this.playing = true;
        // Sound is restored only now, once playback is genuinely running AND
        // the page has been touched at least once (see hasUserActivation).
        // Worst case the first slide of a cold load plays silently until the
        // user touches anything; the old behaviour was that it did not play
        // at all.
        if (!this._muted) {
          if (hasUserActivation) this.player.unMute();
          // Not touched yet: queue, so the video the user is looking at gains
          // sound on their first touch rather than staying silent until the
          // next slide.
          else awaitingActivation.add(this.restoreSound);
        }
        this.lastRaw = this.player.getCurrentTime();
        this.anchorTime = this.lastRaw;
        this.anchorAt = performance.now();
        if (this.pendingPlay) {
          const pending = this.pendingPlay;
          this.pendingPlay = null;
          if (pending.timer) clearTimeout(pending.timer);
          pending.resolve();
        }
        this.emit('play');
        break;
      }
      case PAUSED: {
        this.playing = false;
        // Re-anchor from the player ONLY when we are not mid-seek: a blank
        // hold does `currentTime = pauseAt` then `pause()`, and the PAUSED
        // event usually beats the seek. Overwriting the target with the
        // player's pre-seek sample there would drop the clamp on the floor.
        if (!this.pendingSeek) {
          this.anchorTime = this.player.getCurrentTime();
          this.anchorAt = performance.now();
        }
        this.emit('pause');
        break;
      }
      case ENDED: {
        // The <video> equivalent has loop — replicate it: jump home and
        // relaunch without ever reporting a pause, so the paused indicator
        // never flashes at the loop point.
        if (this.desired === 'playing') {
          this.anchorTime = 0;
          this.anchorAt = performance.now();
          this.player.seekTo(0, true);
          this.player.playVideo();
        } else {
          this.playing = false;
          this.emit('pause');
        }
        break;
      }
      case CUED:
        // Fresh cue after a stop — treat as paused-at-start.
        if (this.playing) {
          this.playing = false;
          this.emit('pause');
        }
        break;
      default:
        // UNSTARTED (-1) and BUFFERING (3) keep the current playing state:
        // buffering mid-playback is not a pause, and reporting it as one
        // would flash the paused indicator on every stutter.
        break;
    }
  }

  private handleError(): void {
    // 101/150 = embedding disabled, 100 = removed. The slide stays on its
    // poster; the liveness sweep (scripts/sweep-embeds.mts) prunes the entry.
    this.playing = false;
    this.settlePendingPlay(new DOMException('video unavailable', 'NotAllowedError'));
    this.emit('pause');
  }
}
