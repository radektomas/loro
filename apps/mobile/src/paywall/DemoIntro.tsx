import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { WebView } from 'react-native-webview';
import { CATALOG_BASE_URL } from '../platform/config';
import { mmkv } from '../platform/storage';
import { track } from '../platform/analytics';
import { GROUND, PrimaryButton, TEXT } from '../onboarding/chrome';

/**
 * THE DEMO IN FRONT OF THE WALL (Radek, 2026-10-12: "a phone sliding to the
 * middle of the screen … a few seconds screen recording of how the app works,
 * in front of the hard paywall").
 *
 * A phone slides up into the middle and plays a real screen recording: two
 * blanks filled, a word tapped and saved, the Words path, the map. One button
 * under it; the phone slides away and the wall is behind it.
 *
 * THE CLIP IS NOT IN THE BINARY. There is no native video module in the app
 * (that would be an EAS build), so it plays in the WebView the app already
 * ships, from the public catalog bucket — swappable without a build by
 * uploading a new file (scripts/upload-demo.mts) and bumping DEMO_FILE.
 *
 * FAILS QUIET. No network, a slow bucket, a WebView error: the phone shows a
 * spinner and the button still works, so the worst case is the wall one tap
 * later than before. Shown once per install (the launch wall only — the
 * Madrid arrival wall comes after they have used the app for real).
 */

const DEMO_FILE = 'config/demo/loro-demo-v1.mp4';
const DEMO_URL = `${CATALOG_BASE_URL}/${DEMO_FILE}`;
const SEEN_KEY = 'loro.paywallDemoSeen';
/** The recording's own aspect (1170×2532). */
const CLIP_ASPECT = 1170 / 2532;

export function paywallDemoDue(): boolean {
  try {
    return mmkv.getString(SEEN_KEY) !== '1';
  } catch {
    return false;
  }
}

const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:${GROUND};overflow:hidden}
video{width:100%;height:100%;object-fit:cover;display:block}</style></head><body>
<video id="v" src="${DEMO_URL}" autoplay muted playsinline loop preload="auto"></video>
<script>
var v=document.getElementById('v');
function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(m)}
v.addEventListener('playing',function(){post('playing')});
v.addEventListener('error',function(){post('error')});
v.play&&v.play().catch(function(){});
</script></body></html>`;

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

  /** The phone slides in from the right with a slight tilt that settles
      (Radek: "I would like the phone to move like from the side"), and
      leaves to the left, so it reads as one motion through the screen. */
  const slide = useSharedValue(reduce ? 0 : width);
  const fade = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    track('paywall_demo_shown', {});
    if (reduce) return;
    fade.value = withTiming(1, { duration: 320 });
    slide.value = withDelay(150, withSpring(0, { damping: 18, stiffness: 120, mass: 1 }));
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
    track('paywall_demo_done', { watchedMs: Date.now() - shownAt.current, played: playing });
    if (reduce) {
      onDone();
      return;
    }
    slide.value = withTiming(-width * 1.2, { duration: 480, easing: Easing.in(Easing.cubic) });
    fade.value = withDelay(220, withTiming(0, { duration: 320 }, (ok) => {
      if (ok) runOnJS(onDone)();
    }));
  };

  const phoneStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: slide.value },
      { rotate: `${(slide.value / width) * 8}deg` },
    ],
  }));
  const sheetStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.sheet, sheetStyle]}>
      <View style={{ paddingTop: insets.top + 24 }}>
        <Text style={styles.title}>This is Loro</Text>
      </View>

      <Animated.View style={[styles.center, phoneStyle]}>
        <View
          style={[
            styles.phone,
            { width: phoneW, height: phoneH, borderRadius: screenR + bezel + frame },
          ]}
        >
          <View
            style={[
              styles.bezel,
              { borderRadius: screenR + bezel, padding: bezel },
            ]}
          >
            <View style={{ width: screenW, height: screenH, borderRadius: screenR, overflow: 'hidden' }}>
              <WebView
                source={{ html: HTML, baseUrl: CATALOG_BASE_URL }}
                style={styles.web}
                originWhitelist={['*']}
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                scrollEnabled={false}
                bounces={false}
                pointerEvents="none"
                onMessage={(e) => {
                  if (e.nativeEvent.data === 'playing') setPlaying(true);
                }}
              />
              {!playing && (
                <View style={[StyleSheet.absoluteFill, styles.loading]}>
                  <ActivityIndicator color={TEXT} />
                </View>
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
  web: { backgroundColor: GROUND, flex: 1 },
  loading: { alignItems: 'center', backgroundColor: GROUND, justifyContent: 'center' },
  island: { backgroundColor: '#000', position: 'absolute' },
});
