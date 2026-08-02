'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { FeedMedia } from '@loro/core/types';
import { YouTubeMedia } from '@/lib/youtubePlayer';

/**
 * The shared, app-level YouTube player: ONE instance for the whole session.
 *
 * WHY ONE. iOS Safari grants playback permission per player instance. The feed
 * used to mount an iframe per slide, so every swipe produced a fresh unblessed
 * player and the user had to tap every single video. A single instance that is
 * created once and never destroyed is blessed once and stays blessed — the
 * autoplay lab (/dev/autoplay-lab, test 5) is where that was measured: after
 * one blessed play, loadVideoById() starts the next video with no new gesture,
 * even from a timer well outside the original gesture.
 *
 * THREE THINGS THAT MUST NEVER HAPPEN, all for the same reason — Safari
 * reloads an iframe that is re-created or re-parented, and a reloaded iframe is
 * a new unblessed player:
 *
 *   1. The instance is never destroyed. Nothing in here calls destroy().
 *   2. The host element is never re-created. It is mounted once, by the
 *      provider, at the root of the app.
 *   3. The host element is never MOVED in the DOM. It cannot follow a slide
 *      into the slide's own subtree, which is why playback lives in a
 *      fixed-position layer that positions ITSELF over whichever element
 *      currently carries `data-loro-player-slot`, tracking that element's
 *      rect. Consumers render an empty slot; they never render a player.
 *
 * The iframe is still created lazily — YouTubeMedia builds it on the first
 * play() — so mounting this provider app-wide does not put a YouTube frame or
 * the IFrame API script on the landing page. Nothing is requested from YouTube
 * until something actually asks to play.
 *
 * CONSUMER CONTRACT — the rules that keep a consumer honest:
 *
 * 1. `bless()` and `unmute()` MUST be called synchronously inside a real user
 *    gesture handler (no awaits before them). That is the whole reason they
 *    exist: iOS grants playback and audio per page load, to the gesture that
 *    asked. Calling them from a timer or a promise chain buys nothing.
 * 2. `loadAndPlay()` resolving does NOT prove that pixels are moving. A
 *    consumer must never make forward progress conditional on playback alone —
 *    always carry a stall path (a visible way for the user to move on).
 *    iOS Low Power Mode refuses autoplay outright, even muted, so this is a
 *    state real users reach, not a theoretical one. PLAYBACK_STALL_MS below is
 *    the shared deadline every surface uses to decide playback is not coming.
 * 3. `getCurrentTime()` may return 0 forever. Time-based logic must treat a
 *    clock that never advances as "no playback", not as "still at the start".
 * 4. The `subscribe()` listener argument is ADVISORY. Treat any notification
 *    as "something changed, go re-read getCurrentTime()", and never require
 *    the state argument to be present.
 *
 * The interface below is deliberately narrow and MUST NOT grow to fit a
 * consumer: it is the seam that lets the playback strategy change without
 * touching the feed or the deck. Consumers that need the richer FeedMedia
 * surface (a writable clock, pause(), the muted flag — the feed's recall
 * blanks need all three) get it from useSharedMedia() below, which hands out
 * this same instance rather than letting anyone make their own.
 */

/** Advisory playback state passed to a subscriber, when the provider has one. */
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'ended';

export type PlaybackListener = (state?: PlaybackState) => void;

export type SharedPlayer = {
  /** Swap the video on the shared instance and start it. */
  loadAndPlay(videoId: string): Promise<void>;
  /** Capture the gesture blessing. Call inside a user-gesture handler. */
  bless(): void;
  /** Restore sound. Call inside a user-gesture handler. */
  unmute(): void;
  /** Playhead in seconds — for word-highlight sync. */
  getCurrentTime(): number;
  /** Observe playback changes; returns the unsubscribe function. */
  subscribe(listener: PlaybackListener): () => void;
};

/**
 * How long a surface waits after asking for playback before it concludes
 * playback is not happening and shows its own way forward.
 *
 * ONE number for the whole app on purpose. The feed's centred play button and
 * the starter deck's Continue button answer the same question — "is this clip
 * ever going to start?" — and two different answers would mean one surface
 * calls a stall while the other is still waiting.
 */
export const PLAYBACK_STALL_MS = 1_500;

/** The attribute a consumer puts on the box the player should fill. */
const SLOT_ATTRIBUTE = 'data-loro-player-slot';

/**
 * Frames of a motionless slot before rect-tracking suspends itself. Scrolling,
 * resizing and slot changes wake it again — so the common case (nothing
 * moving) costs nothing, and a scroll-snap swipe is tracked every frame.
 */
const TRACK_IDLE_FRAMES = 20;

/**
 * Grace period before playback is paused for having no slot on screen.
 *
 * A feed swap legitimately has no slot for a moment — the outgoing slide drops
 * its slot in the same commit the incoming one mounts its own — so pausing
 * instantly would stutter every swipe. Long enough to cover that, short enough
 * that navigating away from the feed does not leave audio playing under a page
 * with no visible player.
 */
const ORPHAN_PAUSE_MS = 600;

/**
 * The video used only to capture the blessing when bless() is called before
 * anything has been loaded (the starter deck blesses on its first card tap,
 * seconds before the first clip). It plays muted inside a hidden layer and is
 * paused the instant the blessing is confirmed, so it is never seen or heard;
 * a real feed embed rather than a placeholder because it has to be a video
 * YouTube will actually serve.
 */
const PRIME_VIDEO_ID = 'guIID3CEwuM';

/**
 * The no-op used when no provider is mounted. Deliberately silent rather than
 * throwing: a surface rendered outside the provider must still be fully
 * clickable and must still seed words, because that is the part that does not
 * depend on playback at all.
 */
const PLACEHOLDER_PLAYER: SharedPlayer = {
  loadAndPlay: () => Promise.resolve(),
  bless: () => {},
  unmute: () => {},
  getCurrentTime: () => 0,
  subscribe: () => () => {},
};

export const PlayerContext = createContext<SharedPlayer>(PLACEHOLDER_PLAYER);

/** The shared player. Falls back to the no-op placeholder above. */
export function usePlayer(): SharedPlayer {
  return useContext(PlayerContext);
}

/**
 * The reactive half: what the shared instance is currently doing.
 *
 * Separate from PlayerContext so that a swap — which changes `loadedVideoId`
 * and re-renders every consumer of this hook — can never change the identity
 * of the SharedPlayer object. Consumers hold that object in effect
 * dependencies (`[player, round]` in RoundClip), and a new identity there
 * would restart the very clip that had just been loaded.
 */
export type SharedMediaSurface = {
  /**
   * The persistent instance as a FeedMedia, for the components built against
   * that interface (SubtitleTrack's blank holds, the progress bar, the mute
   * toggle). Null until the provider has mounted.
   */
  media: FeedMedia | null;
  /** Which video the shared instance currently holds; null before the first load. */
  loadedVideoId: string | null;
  /**
   * True once playback has actually begun for `loadedVideoId`. Stays true
   * across a pause — it answers "did this video ever start", which is what a
   * poster cross-fade and a stall fallback both need. Reset by the next swap.
   */
  started: boolean;
};

const EMPTY_SURFACE: SharedMediaSurface = {
  media: null,
  loadedVideoId: null,
  started: false,
};

const SurfaceContext = createContext<SharedMediaSurface>(EMPTY_SURFACE);

export function useSharedMedia(): SharedMediaSurface {
  return useContext(SurfaceContext);
}

/**
 * The instance, held at module scope rather than in a ref.
 *
 * React's development double-invoke of effects would otherwise build a second
 * player (and a second iframe) on mount, and "exactly one player per page
 * load" is the entire premise of this module — so the guard has to outlive the
 * component, not the effect.
 */
let sharedMedia: YouTubeMedia | null = null;

/** Non-finite readings are dropped, never propagated. See the guards note. */
function finiteTime(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<YouTubeMedia | null>(null);

  const [media, setMedia] = useState<FeedMedia | null>(null);
  const [loadedVideoId, setLoadedVideoId] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  /** What loadAndPlay was last asked for — the identity `started` refers to. */
  const requestedIdRef = useRef<string | null>(null);
  /** Mirrors `started` for the rect writer, which runs outside React. */
  const revealedRef = useRef(false);
  /** A gesture has already been spent capturing the blessing. */
  const blessedRef = useRef(false);
  /** The current play() exists only to capture the blessing — stop it on 'play'. */
  const primingRef = useRef(false);
  const listenersRef = useRef(new Set<PlaybackListener>());
  /** Set by the tracking effect; nudges the rect loop out of its idle state. */
  const wakeRef = useRef<() => void>(() => {});

  // ---------------------------------------------------------- the instance

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!sharedMedia) {
      // Created once per page load and never destroyed. `loop` is left at its
      // default (true) so feed slides keep looping silently the way they
      // always have — the wrap emits 'ended' without a 'pause', so the deck
      // still gets its end-of-clip signal and the feed's paused indicator
      // still never flashes at the loop point.
      sharedMedia = new YouTubeMedia(host, PRIME_VIDEO_ID);
    }
    mediaRef.current = sharedMedia;
    setMedia(sharedMedia);

    const emit = (state: PlaybackState) => {
      // A subscriber that throws must not take playback down with it: these
      // callbacks run inside the player's own state-change handler.
      for (const listener of [...listenersRef.current]) {
        try {
          listener(state);
        } catch {
          // Advisory notification; nothing here can act on a broken consumer.
        }
      }
    };

    const onPlay = () => {
      if (requestedIdRef.current === null) {
        // The priming play from bless(): the blessing is captured now, so stop
        // streaming a video nobody asked for. Not reported as playback — no
        // consumer requested it and nothing is showing it.
        if (primingRef.current) {
          primingRef.current = false;
          mediaRef.current?.pause();
        }
        return;
      }
      revealedRef.current = true;
      setStarted(true);
      wakeRef.current();
      emit('playing');
    };
    const onPause = () => emit('paused');
    const onEnded = () => emit('ended');

    sharedMedia.addEventListener('play', onPlay);
    sharedMedia.addEventListener('pause', onPause);
    sharedMedia.addEventListener('ended', onEnded);
    return () => {
      // Listeners only. The instance itself outlives every consumer, and its
      // iframe outlives every route — that is the point of this module.
      sharedMedia?.removeEventListener('play', onPlay);
      sharedMedia?.removeEventListener('pause', onPause);
      sharedMedia?.removeEventListener('ended', onEnded);
    };
  }, []);

  // ------------------------------------------------- slot tracking + layer

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    let raf = 0;
    let idleFrames = 0;
    let lastKey = '';
    let slot: HTMLElement | null = null;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;

    /** Write the layer over the slot. Returns whether anything changed. */
    const apply = (): boolean => {
      const rect = slot?.getBoundingClientRect();
      const key = rect
        ? [
            Math.round(rect.left),
            Math.round(rect.top),
            Math.round(rect.width),
            Math.round(rect.height),
            revealedRef.current ? 1 : 0,
          ].join(',')
        : 'no-slot';
      if (key === lastKey) return false;
      lastKey = key;

      if (!rect) {
        // Hidden, never unmounted and never display:none — both would reload
        // the iframe on Safari and throw the blessing away.
        layer.style.opacity = '0';
        layer.style.pointerEvents = 'none';
        return true;
      }
      layer.style.width = `${rect.width}px`;
      layer.style.height = `${rect.height}px`;
      layer.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
      // Revealed only once playback has actually started for the video that
      // was asked for. Until then the layer is transparent and the consumer's
      // poster shows through it, which is what hides the black frame during a
      // swap. Transparent also means non-interactive, so a stall fallback
      // rendered inside the slot is tappable.
      const show = revealedRef.current && rect.width >= 1 && rect.height >= 1;
      layer.style.opacity = show ? '1' : '0';
      layer.style.pointerEvents = show ? 'auto' : 'none';
      return true;
    };

    const tick = () => {
      idleFrames = apply() ? 0 : idleFrames + 1;
      if (idleFrames > TRACK_IDLE_FRAMES) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      idleFrames = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    const resizeObserver = new ResizeObserver(() => wake());

    const resolveSlot = () => {
      const found = document.querySelectorAll<HTMLElement>(`[${SLOT_ATTRIBUTE}]`);
      if (found.length > 1 && process.env.NODE_ENV !== 'production') {
        console.warn(
          `[loro] ${found.length} elements carry ${SLOT_ATTRIBUTE}. Only one slot ` +
            'may be active at a time; using the last one in document order.'
        );
      }
      const next = found.length > 0 ? found[found.length - 1] : null;
      if (next === slot) return;
      if (slot) resizeObserver.unobserve(slot);
      slot = next;
      if (slot) {
        resizeObserver.observe(slot);
        // Inherit the slot's own rounding, so the video is clipped to exactly
        // the box the consumer laid out rather than spilling past its corners.
        layer.style.borderRadius = window.getComputedStyle(slot).borderRadius;
      }

      if (pauseTimer) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }
      if (!slot) {
        // Nothing on screen is showing the player. Audio continuing under a
        // page with no visible player is both wrong for the user and an
        // embed-terms problem — but only after the grace period, because a
        // feed swap has no slot for an instant.
        pauseTimer = setTimeout(() => {
          pauseTimer = null;
          if (!slot) mediaRef.current?.pause();
        }, ORPHAN_PAUSE_MS);
      }
      wake();
    };

    resolveSlot();
    const mutationObserver = new MutationObserver(resolveSlot);
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [SLOT_ATTRIBUTE],
    });

    const onViewportChange = () => wake();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    // Capture phase: the feed scrolls an inner container, and scroll events do
    // not bubble to window.
    document.addEventListener('scroll', onViewportChange, {
      capture: true,
      passive: true,
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (pauseTimer) clearTimeout(pauseTimer);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      document.removeEventListener('scroll', onViewportChange, { capture: true });
    };
  }, []);

  // -------------------------------------------------------------- the API

  // Built once. Every method reads refs, so this object's identity is stable
  // for the life of the page (see the SurfaceContext note above).
  const player = useMemo<SharedPlayer>(
    () => ({
      loadAndPlay(videoId: string): Promise<void> {
        const instance = mediaRef.current;
        if (!instance) {
          return Promise.reject(new Error('[loro] shared player not mounted'));
        }
        if (requestedIdRef.current !== videoId) {
          requestedIdRef.current = videoId;
          revealedRef.current = false;
          setStarted(false);
          setLoadedVideoId(videoId);
          // The blessing-preserving swap: same instance, same iframe, new
          // video (YouTubeMedia.loadVideo -> loadVideoById). Also resets that
          // adapter's clock model, so the previous video's timings cannot
          // reach the next consumer's highlighting.
          instance.loadVideo(videoId, undefined, 'play');
        }
        wakeRef.current();
        // play() is what resolves on PLAYING and rejects NotAllowedError when
        // playback is refused, which is what makes a retry from a real gesture
        // (the feed's fallback button) work.
        return instance.play();
      },

      /**
       * UNVERIFIED ASSUMPTION — that a pause preserves the blessing.
       *
       * When nothing has been loaded yet (the starter deck blesses on its first
       * card tap, seconds before the first clip), this captures the grant by
       * playing the priming video and then PAUSING it once 'play' confirms the
       * grant, so the user's data is not spent streaming a video nobody asked
       * for. Every later loadVideoById then relies on a blessing that was
       * granted to a player which has since been paused.
       *
       * The autoplay lab measured swap-after-PLAYING (test 5), not
       * swap-after-pause. Card 10 of /dev/autoplay-lab exists to settle exactly
       * this and nothing else — run it on a physical iPhone before treating the
       * behaviour as known. If it turns out a pause does drop the grant, the
       * fix is to keep the priming video playing (muted, inside the hidden
       * layer) until the first real load, at the cost of that streaming.
       *
       * Nobody is trapped either way: PLAYBACK_STALL_MS gives both surfaces a
       * gesture-driven way forward when playback does not start.
       */
      bless(): void {
        const instance = mediaRef.current;
        if (!instance || blessedRef.current) return;
        blessedRef.current = true;
        // Synchronous inside the caller's gesture handler — no awaits before
        // this line, or the gesture is spent.
        primingRef.current = requestedIdRef.current === null;
        instance.play().catch(() => {
          // Refused (Low Power Mode, or no gesture after all). Let the next
          // gesture try again rather than believing we are blessed.
          blessedRef.current = false;
          primingRef.current = false;
        });
      },

      unmute(): void {
        // The adapter applies this to the player when it is ready, and queues
        // it behind the page's first touch when it is not — a stored "sound
        // on" can therefore never become an unmuted autoplay attempt.
        const instance = mediaRef.current;
        if (instance) instance.muted = false;
      },

      getCurrentTime(): number {
        const instance = mediaRef.current;
        if (!instance) return 0;
        // Guarded because the underlying getter can transiently return
        // undefined in the moments after loadVideoById (measured in the
        // autoplay lab), and a NaN escaping here would poison every
        // time-based consumer for the rest of the session.
        return finiteTime(instance.currentTime);
      },

      subscribe(listener: PlaybackListener): () => void {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    []
  );

  const surface = useMemo<SharedMediaSurface>(
    () => ({ media, loadedVideoId, started }),
    [media, loadedVideoId, started]
  );

  return (
    <PlayerContext.Provider value={player}>
      <SurfaceContext.Provider value={surface}>
        {children}
        {/*
          THE PLAYER LAYER. Fixed, so it can sit over a slot anywhere in the
          tree without ever being re-parented into it. z-index 15 keeps the
          previous paint order exactly: above a slide's poster and subtitle
          band (which never overlap it geometrically), below the top chrome
          (z-20) and the word/glossary sheets (z-40), which covered the
          per-slide iframe before this existed too.
        */}
        <div
          ref={layerRef}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            zIndex: 15,
            opacity: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            backgroundColor: '#000',
            // Only opacity transitions: the transform is rect tracking and
            // must land on the same frame as the slot it is following.
            transition: 'opacity 300ms ease',
          }}
        >
          <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </SurfaceContext.Provider>
    </PlayerContext.Provider>
  );
}
