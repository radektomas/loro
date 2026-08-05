import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { PLAYER_EMBED_ORIGIN } from '../platform/config';
import { buildPlayerPage } from './page';

/**
 * The one persistent player. ONE WebView for the whole session, mounted here,
 * never unmounted, never re-parented.
 *
 * WHY IT LIVES OUTSIDE THE LIST. A FlashList RECYCLES its cells. A WebView
 * inside a cell would be destroyed and rebuilt on every swipe, and each rebuild
 * is a fresh iframe boot — 256–1403ms measured (§5e) — plus, on the web side,
 * the reason for this whole architecture: a re-created player is a new
 * unblessed player. So the WebView is a sibling of the list, absolutely
 * positioned over whichever slide is active.
 *
 * pointerEvents="none" IS MANDATORY AND PERMANENT. The WebView is the topmost
 * native view over the player region; without this it swallows every touch and
 * a swipe that starts on a playing video cannot scroll the feed. That is the
 * exact dead zone the web app fixed by making its player layer permanently
 * `pointer-events: none` and putting the gesture surface underneath. Input
 * lands on the slide beneath instead. Do not make this interactive.
 *
 * WHAT IS DELIBERATELY ABSENT: bless(), the priming video, hasUserActivation,
 * awaitingActivation. §5e measured gesture-free autoplay working in
 * react-native-webview with mediaPlaybackRequiresUserAction={false}, and the
 * grant surviving both a swap and a pause. The web's blessing machinery exists
 * for mobile Safari and buys nothing here. The two on-screen readouts below are
 * what re-confirm that on SDK 57.
 */

// ---------------------------------------------------------------- the clock

/**
 * The RN half of the optimistic clock. The WebView owns the model and posts
 * ANCHORS; these three values are that anchor, and everything on this side
 * extrapolates from them rather than asking across the bridge.
 *
 * SharedValues rather than state because the karaoke loop reads them on the UI
 * thread at 60fps — React state would mean a JS round trip per frame.
 *
 * `anchorAt` is Date.now() at the moment the message ARRIVED, not the
 * WebView's performance.now(). The two clocks have different origins, so the
 * bridge latency is absorbed as a small constant offset — which is exactly what
 * the spike measured as bounded ±30ms drift, not something to correct for.
 */
export type PlayerClock = {
  anchorTime: SharedValue<number>;
  anchorAt: SharedValue<number>;
  isPlaying: SharedValue<boolean>;
};

export type PlayerApi = {
  /** Swap the video on the persistent instance and start it. */
  loadAndPlay(youtubeId: string): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  seek(seconds: number): void;
};

/** What the player is currently doing — reactive, drives posters and readouts. */
export type PlayerStatus = {
  ready: boolean;
  loadedVideoId: string | null;
  /** True once PLAYING was reached for loadedVideoId. Reset by the next swap. */
  started: boolean;
  playing: boolean;
  /** MEASUREMENT 1: ms from load to PLAYING, with no gesture. */
  lastPlayMs: number | null;
  lastPlayError: string | null;
  /** MEASUREMENT 2: RN extrapolation minus ground-truth getCurrentTime(). */
  driftMs: number | null;
  nonFinite: number;
  spuriousPause: number;
};

const NOOP_API: PlayerApi = {
  loadAndPlay: () => {},
  play: () => {},
  pause: () => {},
  togglePlay: () => {},
  seek: () => {},
};

const ApiContext = createContext<PlayerApi>(NOOP_API);
const ClockContext = createContext<PlayerClock | null>(null);
const StatusContext = createContext<PlayerStatus>({
  ready: false,
  loadedVideoId: null,
  started: false,
  playing: false,
  lastPlayMs: null,
  lastPlayError: null,
  driftMs: null,
  nonFinite: 0,
  spuriousPause: 0,
});

export const usePlayerApi = () => useContext(ApiContext);
export const usePlayerStatus = () => useContext(StatusContext);
export function usePlayerClock(): PlayerClock {
  const clock = useContext(ClockContext);
  if (!clock) throw new Error('[loro] usePlayerClock outside PlayerHost');
  return clock;
}

/** Where the player sits on screen. All slides share one geometry, so this
    changes only when the active slide changes — never per frame. */
export type PlayerBox = {
  top: number;
  left: number;
  width: number;
  height: number;
  /** Hidden during a swipe and until playback starts; the slide's poster shows
      through, which is what covers the black frame during a swap. */
  visible: boolean;
};

/** Ground-truth sampling cadence for the drift readout. */
const DRIFT_SAMPLE_MS = 3000;

export function PlayerHost({
  box,
  children,
}: {
  box: PlayerBox;
  children: ReactNode;
}) {
  const webRef = useRef<WebView>(null);
  const seqRef = useRef(0);

  const anchorTime = useSharedValue(0);
  const anchorAt = useSharedValue(Date.now());
  const isPlaying = useSharedValue(false);

  const [status, setStatus] = useState<PlayerStatus>({
    ready: false,
    loadedVideoId: null,
    started: false,
    playing: false,
    lastPlayMs: null,
    lastPlayError: null,
    driftMs: null,
    nonFinite: 0,
    spuriousPause: 0,
  });

  /** The id the current play request belongs to — what `started` refers to. */
  const requestedIdRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const playStartedAtRef = useRef<number | null>(null);

  const send = useCallback((cmd: Record<string, unknown>) => {
    const id = `c${++seqRef.current}`;
    webRef.current?.injectJavaScript(
      `window.__cmd(${JSON.stringify({ ...cmd, id })}); true;`
    );
  }, []);

  /** The RN-side model read, on the JS thread (the karaoke loop has its own
      copy of this arithmetic in a worklet). */
  const extrapolate = useCallback((): number => {
    if (!isPlaying.value) return anchorTime.value;
    return anchorTime.value + (Date.now() - anchorAt.value) / 1000;
  }, [anchorTime, anchorAt, isPlaying]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'anchor': {
          anchorTime.value = msg.time as number;
          anchorAt.value = Date.now();
          isPlaying.value = msg.playing as boolean;
          setStatus((s) =>
            s.playing === (msg.playing as boolean) ? s : { ...s, playing: msg.playing as boolean }
          );
          break;
        }
        case 'ready': {
          readyRef.current = true;
          setStatus((s) => ({ ...s, ready: true }));
          break;
        }
        case 'playResult': {
          const ok = msg.ok as boolean;
          const elapsed = msg.elapsedMs as number;
          // Measure from OUR request, not the page's, so the number includes
          // the bridge round trip the user actually waits through.
          const wall = playStartedAtRef.current
            ? Date.now() - playStartedAtRef.current
            : elapsed;
          setStatus((s) => ({
            ...s,
            started: ok ? true : s.started,
            lastPlayMs: ok ? wall : s.lastPlayMs,
            lastPlayError: ok ? null : ((msg.error as string) ?? 'unknown'),
          }));
          break;
        }
        case 'sample': {
          const raw = msg.raw as number | null;
          if (raw !== null) {
            setStatus((s) => ({ ...s, driftMs: (extrapolate() - raw) * 1000 }));
          }
          if (typeof msg.nonFinite === 'number') {
            setStatus((s) =>
              s.nonFinite === msg.nonFinite ? s : { ...s, nonFinite: msg.nonFinite as number }
            );
          }
          break;
        }
        case 'nonFinite': {
          setStatus((s) => ({ ...s, nonFinite: msg.count as number }));
          break;
        }
        case 'spuriousPause': {
          setStatus((s) => ({ ...s, spuriousPause: msg.count as number }));
          break;
        }
        default:
          break;
      }
    },
    [anchorTime, anchorAt, isPlaying, extrapolate]
  );

  const api = useMemo<PlayerApi>(
    () => ({
      loadAndPlay(youtubeId: string) {
        if (requestedIdRef.current === youtubeId) return;
        requestedIdRef.current = youtubeId;
        playStartedAtRef.current = Date.now();
        // Reset the RN model too: the outgoing video's anchor must not drive
        // the incoming slide's karaoke for the moments before the first new
        // anchor arrives.
        anchorTime.value = 0;
        anchorAt.value = Date.now();
        isPlaying.value = false;
        setStatus((s) => ({
          ...s,
          loadedVideoId: youtubeId,
          started: false,
          playing: false,
          lastPlayMs: null,
          lastPlayError: null,
        }));
        send({ cmd: 'load', videoId: youtubeId, andPlay: true });
      },
      play() {
        playStartedAtRef.current = Date.now();
        send({ cmd: 'play' });
      },
      pause() {
        send({ cmd: 'pause' });
      },
      togglePlay() {
        if (isPlaying.value) send({ cmd: 'pause' });
        else send({ cmd: 'play' });
      },
      seek(seconds: number) {
        send({ cmd: 'seek', time: seconds });
      },
    }),
    [send, anchorTime, anchorAt, isPlaying]
  );

  const clock = useMemo<PlayerClock>(
    () => ({ anchorTime, anchorAt, isPlaying }),
    [anchorTime, anchorAt, isPlaying]
  );

  // MEASUREMENT 2. Ground truth every few seconds while playing — the raw
  // player clock, compared against this side's extrapolation. The spike's
  // equivalent stayed within ~±30ms over 60s; a growing number here would mean
  // SDK 57 extrapolates differently and the karaoke would slide out of sync.
  useEffect(() => {
    const timer = setInterval(() => {
      if (readyRef.current && isPlaying.value) send({ cmd: 'sample' });
    }, DRIFT_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [send, isPlaying]);

  const layerStyle = useAnimatedStyle(() => ({
    opacity: withTiming(box.visible ? 1 : 0, { duration: 180 }),
  }));

  const page = useMemo(
    () =>
      buildPlayerPage({
        // Any embeddable id: the player is created once and every real video
        // arrives later via loadVideoById. This one is only ever on screen
        // before the first slide loads, behind the poster.
        initialVideoId: 'guIID3CEwuM',
        embedOrigin: PLAYER_EMBED_ORIGIN,
      }),
    []
  );

  return (
    <ApiContext.Provider value={api}>
      <ClockContext.Provider value={clock}>
        <StatusContext.Provider value={status}>
          {children}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.layer,
              { top: box.top, left: box.left, width: box.width, height: box.height },
              layerStyle,
            ]}
          >
            <WebView
              ref={webRef}
              source={{ html: page, baseUrl: PLAYER_EMBED_ORIGIN }}
              originWhitelist={['*']}
              onMessage={onMessage}
              // The two props that make gesture-free playback legal here, and
              // the reason the web's blessing machinery is not ported.
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              allowsFullscreenVideo={false}
              scrollEnabled={false}
              setSupportMultipleWindows={false}
              // The page is a black box behind the poster until it plays; a
              // white flash on boot would be visible through the fade.
              style={styles.web}
            />
          </Animated.View>
        </StatusContext.Provider>
      </ClockContext.Provider>
    </ApiContext.Provider>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#000',
  },
  web: { flex: 1, backgroundColor: '#000' },
});
