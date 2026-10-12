import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { mmkv } from '../platform/storage';
import { track } from '../platform/analytics';
import { GROUND, PrimaryButton, TEXT } from '../onboarding/chrome';

/**
 * THE DEMO IN FRONT OF THE WALL (Radek, 2026-10-12: "a phone sliding to the
 * middle of the screen … a few seconds screen recording of how the app works,
 * in front of the hard paywall").
 *
 * A phone slides in from the side and plays a real screen recording: two
 * blanks filled, a word tapped and saved, the Words path, the map. One button
 * under it; the phone slides away and the wall is behind it.
 *
 * NATIVE VIDEO, AND THE CLIP IS IN THE BINARY (assets/demo/loro-demo.mp4,
 * 0.9 MB). It first played in a WebView, streamed from the catalog bucket,
 * and on device that loaded slowly, froze as a zoomed still, or never started
 * (2026-10-12) — a WebView's video layer is fragile on iOS. expo-video is
 * AVPlayer: instant, offline, smooth under any animation.
 *
 * FAILS QUIET. A binary without the expo-video module (a dev client older than
 * this change) gets the clip's first frame as a still and the same button —
 * never a crash, never a spinner. The first frame sits on the screen in every
 * case until the video's own first frame has rendered, so the hand-off is
 * invisible. Shown once per install, on the launch wall only.
 */

const SEEN_KEY = 'loro.paywallDemoSeen';
/** The recording's own aspect (1170×2532). */
const CLIP_ASPECT = 1170 / 2532;
const CLIP = require('../../assets/demo/loro-demo.mp4');
/** The clip's first frame, bundled: on screen until the video's own renders. */
const POSTER = require('../../assets/brand/demo-poster.jpg');

export function paywallDemoDue(): boolean {
  try {
    return mmkv.getString(SEEN_KEY) !== '1';
  } catch {
    return false;
  }
}

type VideoModule = typeof import('expo-video');

/** expo-video, or null on a binary that does not have its native module. */
const video: VideoModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('expo-modules-core') as typeof import('expo-modules-core');
    if (!core.requireOptionalNativeModule('ExpoVideo')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-video') as VideoModule;
  } catch {
    return null;
  }
})();

/** The player, in its own component so the hook only ever runs with the module. */
function Clip({
  mod,
  width,
  height,
  onFirstFrame,
}: {
  mod: VideoModule;
  width: number;
  height: number;
  onFirstFrame: () => void;
}) {
  const player = mod.useVideoPlayer(CLIP, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  const VideoView = mod.VideoView as unknown as ComponentType<Record<string, unknown>>;
  return (
    <VideoView
      player={player}
      style={{ width, height }}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
      fullscreenOptions={{ enable: false }}
      onFirstFrameRender={onFirstFrame}
    />
  );
}

export function DemoIntro({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const shownAt = useRef(Date.now());
  const leaving = useRef(false);

  // The phone: as tall as the room between the title and the button allows.
  const bezel = 7;
  const frame = 4;
  const room = height - insets.top - insets.bottom - 230;
  const screenH = Math.min(room - 2 * (bezel + frame), (width * 0.72) / CLIP_ASPECT);
  const screenW = screenH * CLIP_ASPECT;
  const phoneW = screenW + 2 * (bezel + frame);
  const phoneH = screenH + 2 * (bezel + frame);
  const screenR = screenW * 0.13;

  /** The phone slides in from the right (Radek: "I would like the phone to
      move like from the side") and leaves to the left: one motion through. */
  const slide = useSharedValue(reduce ? 0 : width);
  const fade = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    track('paywall_demo_shown', { native: video !== null });
    if (reduce) return;
    fade.value = withTiming(1, { duration: 320 });
    slide.value = withDelay(150, withTiming(0, { duration: 650, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      mmkv.set(SEEN_KEY, '1');
    } catch {
      // A demo shown twice is fine.
    }
    track('paywall_demo_done', { watchedMs: Date.now() - shownAt.current, played: playing, native: video !== null });
    if (reduce) {
      onDone();
      return;
    }
    slide.value = withTiming(-width * 1.2, { duration: 480, easing: Easing.in(Easing.cubic) });
    fade.value = withDelay(220, withTiming(0, { duration: 320 }, (ok) => {
      if (ok) runOnJS(onDone)();
    }));
  };

  const phoneStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }));
  const sheetStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.sheet, sheetStyle]}>
      <View style={{ paddingTop: insets.top + 24 }}>
        <Text style={styles.title}>This is Loro</Text>
      </View>

      <Animated.View style={[styles.center, phoneStyle]}>
        <View style={[styles.phone, { width: phoneW, height: phoneH, borderRadius: screenR + bezel + frame }]}>
          <View style={[styles.bezel, { borderRadius: screenR + bezel, padding: bezel }]}>
            <View style={{ width: screenW, height: screenH, borderRadius: screenR, overflow: 'hidden' }}>
              {video && <Clip mod={video} width={screenW} height={screenH} onFirstFrame={() => setPlaying(true)} />}
              {!playing && (
                <Image
                  source={POSTER}
                  style={{ position: 'absolute', top: 0, left: 0, width: screenW, height: screenH }}
                  resizeMode="cover"
                />
              )}
              {/* Dynamic Island, so it reads as a phone and not a box. */}
              <View
                style={[
                  styles.island,
                  {
                    width: screenW * 0.3,
                    height: screenW * 0.088,
                    borderRadius: screenW * 0.044,
                    top: screenW * 0.028,
                    left: screenW * 0.35,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </Animated.View>

      <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 16 }}>
        <PrimaryButton label="Continuar" onPress={finish} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: GROUND, justifyContent: 'space-between', zIndex: 10 },
  title: {
    color: TEXT,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  phone: {
    backgroundColor: '#8e9197',
    borderColor: '#5a5c61',
    borderWidth: 1.5,
    padding: 4,
    shadowColor: '#5ee6a8',
    shadowOpacity: 0.25,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 10 },
  },
  bezel: { backgroundColor: '#040405', flex: 1 },
  island: { backgroundColor: '#000', position: 'absolute' },
});
