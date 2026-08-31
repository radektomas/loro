import { useEffect, useState } from 'react';
import { AccessibilityInfo, Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { BRAND } from '../onboarding/brand';

/**
 * THE CORRECT-ANSWER CELEBRATION — Loro hops in, feathers burst off the word.
 *
 * A PORT OF THE WEB'S, AT THE WEB'S OWN DURATIONS. SubtitleTrack.tsx holds
 * `celebrating` for 1200ms and drives three things off it: the mascot hop
 * (.animate-loro-pop, 1050ms), a seven-feather burst from the recalled word
 * (.celebrate-particle, 650ms staggered 18ms), and the word's own snap+bloom
 * (.animate-correct). All three keyframes are transcribed below from
 * app/globals.css percent-of-duration into milliseconds — the numbers are not
 * re-tuned, so a change there should be mirrored here rather than re-invented.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS OVERRUNS THE RESUME, WHICH USED TO BE THE ARGUMENT AGAINST IT.
 *
 * Karaoke's RevealedWord shipped a deliberately shrunken version — ~480ms, on
 * the reasoning that the player resumes 600ms after grading and "an animation
 * still running when the video restarts reads as jank rather than reward".
 *
 * That premise does not survive checking against the web. Feed.tsx:629-635
 * resumes on exactly the same 600ms (RESUME_MS_CORRECT is that line, ported
 * verbatim), while the celebration runs to 1050-1200ms — so the web ALREADY
 * plays the hop over resumed video, by design, and has since the feature
 * shipped. The overlap is the effect, not a defect in it: the reward lands
 * while the clip carries on, which is what keeps the feed moving.
 *
 * So this restores the web's behaviour rather than inventing a louder one.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * THE ART IS THE PNG, NOT components/LoroMascot.tsx. That SVG's own header
 * calls it "a geometric placeholder, to be art-directed later"; the finished
 * parrot is the bundled bitmap, and drawing the SVG would mean react-native-svg
 * — a native module, so an EAS rebuild — for a placeholder. See brand.ts, which
 * already made this call for onboarding.
 *
 * COST: two <Animated.View>s and seven 7x11pt Views, transforms only, none of
 * them touching layout. The hop is absolutely positioned inside the subtitle
 * track and the burst inside the revealed word, so neither can reflow the band
 * and neither can resize the player.
 */

/** How long `celebrating` stays true — SubtitleTrack's celebrationTimer. */
export const CELEBRATE_MS = 1200;

/**
 * loro-hop-in, 1050ms ease-in-out, as segment durations.
 *
 * The keyframe is written in percentages (0/16/30/52/66/84/100); these are the
 * GAPS between them, which is what withSequence wants. They sum to 1050 and
 * the assertion of that is the arithmetic in each comment — get one wrong and
 * the parrot finishes early or hangs.
 */
const HOP_TOTAL = 1050;
const RISE = 168; // 0 -> 16%: up and overshoot to 1.1
const SETTLE = 147; // 16 -> 30%: land at rest
const HOP2 = 231; // 30 -> 52%: the second, smaller hop up
const LAND = 147; // 52 -> 66%: back down
const OUT = 357; // 66 -> 100%: sink and shrink away
/** 16 -> 84%: fully opaque through the middle of the hop. */
const OPACITY_HOLD = 714;
/** 84 -> 100%: the fade, which finishes exactly with the motion. */
const FADE_OUT = 168;

/** loro-particle: 650ms ease-out, each feather 18ms behind the last. */
const FEATHER_MS = 650;
const FEATHER_STAGGER = 18;

/** The web's PARTICLES array (SubtitleTrack.tsx:23-31), unchanged. */
const FEATHERS = [
  { dx: -34, dy: -30, rot: -120 },
  { dx: 26, dy: -38, rot: 90 },
  { dx: -18, dy: -44, rot: -60 },
  { dx: 40, dy: -18, rot: 140 },
  { dx: -42, dy: -6, rot: -160 },
  { dx: 16, dy: -50, rot: 45 },
  { dx: 44, dy: -34, rot: 180 },
];

const ACCENT = '#5ee6a8';
/** The web's .celebrate-particle:nth-child(even) fill — the belly green. */
const ACCENT_PALE = '#a8e89f';

/**
 * The near-miss palette. A spelling near-miss GRADES as correct (see core's
 * matchAnswer), so it earns the same hop rather than a consolation animation —
 * only the colour and the word change, which is what keeps "almost" readable
 * as a success you can still learn from.
 */
const ALMOST = '#f2c14e';
const ALMOST_PALE = '#f7d98c';

export type CelebrationVariant = 'correct' | 'almost';

const VARIANT = {
  correct: { color: ACCENT, pale: ACCENT_PALE, label: '¡Correcto!' },
  almost: { color: ALMOST, pale: ALMOST_PALE, label: 'Almost!' },
} as const;

/**
 * The last known Reduce Motion answer, resolved once at import.
 *
 * ⚠️ WITHOUT THIS THE FIRST CELEBRATION NEVER PLAYS, and it fails in the
 * direction that looks like the feature is broken rather than like a setting.
 * isReduceMotionEnabled() is an async native call, and the hook below has to
 * seed its state defensively as `true` — anything else risks a motion-
 * sensitive user catching a frame of hop. But these components MOUNT on the
 * answer and animate immediately: seeded true, the mount renders null, the
 * effect returns early, and by the time the real answer arrives a frame or
 * two later the moment has passed. Loro would simply not show up the first
 * time, then work forever after, which is the worst possible way for this to
 * be wrong.
 *
 * Resolving at module scope moves that round trip to bundle load — Karaoke
 * imports this file, so it is warm long before anyone answers a blank — and
 * leaves the hook's defensive default only for the window before it lands.
 */
let reduceMotionCache: boolean | null = null;
void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
  reduceMotionCache = on;
});

/**
 * Reduce Motion, shared by both pieces.
 *
 * The web's answer to this is not "make it smaller", it is to remove the
 * motion entirely: globals.css sets `display: none` on .celebrate-particle and
 * .animate-loro-pop under prefers-reduced-motion, leaving the colour change to
 * carry the result. Both callers below do exactly that.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(reduceMotionCache ?? true);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      reduceMotionCache = on;
      if (alive) setReduce(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      reduceMotionCache = on;
      setReduce(on);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * Loro hops in beside the subtitle line and waves.
 *
 * POSITIONED INSIDE THE TRACK, WHICH IS WHAT KEEPS IT COMPLIANT. The track is
 * the karaoke band — structurally below the player area (FeedScreen's band) —
 * so `top: 0` here is the top of the SUBTITLE box, not the top of the screen.
 * The web does the same (`absolute right-6 top-0` within the min-h-[11rem]
 * box) and for the same reason its own comment gives: the celebration is
 * absolute within that box, so it costs zero layout shift and cannot grow the
 * band under the player.
 *
 * The waving art rather than the standing one: the web swaps LoroMascot to
 * state="happy", which raises the wing and opens the beak. Of the two bundled
 * bitmaps, the wave is the one that reads as celebrating.
 */
export function LoroCelebration({
  variant = 'correct',
}: {
  variant?: CelebrationVariant;
}) {
  const reduceMotion = useReduceMotion();
  const lift = useSharedValue(10);
  const scale = useSharedValue(0.4);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    const ease = Easing.inOut(Easing.ease);

    // 168 + 714 + 168 = 1050
    opacity.value = withSequence(
      withTiming(1, { duration: RISE, easing: ease }),
      withDelay(OPACITY_HOLD, withTiming(0, { duration: FADE_OUT, easing: ease }))
    );
    // 168 + 147 + 231 + 147 + 357 = 1050
    lift.value = withSequence(
      withTiming(-8, { duration: RISE, easing: ease }),
      withTiming(0, { duration: SETTLE, easing: ease }),
      withTiming(-5, { duration: HOP2, easing: ease }),
      withTiming(0, { duration: LAND, easing: ease }),
      withTiming(2, { duration: OUT, easing: ease })
    );
    // 168 + 147 + (231 + 147) + 357 = 1050 — scale holds at 1 through both
    // hops, so the two middle segments become one delay.
    scale.value = withSequence(
      withTiming(1.1, { duration: RISE, easing: ease }),
      withTiming(1, { duration: SETTLE, easing: ease }),
      withDelay(HOP2 + LAND, withTiming(0.92, { duration: OUT, easing: ease }))
    );
  }, [reduceMotion, lift, scale, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));

  // The web hides the hop outright under reduced motion rather than easing it.
  if (reduceMotion) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.hopLayer, style]}>
      <Image source={BRAND.parrotWaving} style={styles.parrot} resizeMode="contain" />
      <View style={styles.pill}>
        <Text style={[styles.pillText, { color: VARIANT[variant].color }]}>
          {VARIANT[variant].label}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * THE CENTRE-STAGE CELEBRATION — the same hop, played big in the middle of
 * the screen, with the feather burst thrown from the parrot itself.
 *
 * FOR SURFACES WITH NOTHING UNDERNEATH. The feed's hop is deliberately small
 * and cornered because the video resumes 600ms after grading and the clip is
 * the show. The Words-tab review is the opposite moment: by grading time the
 * player is gone and the panel is about to close, so the reward IS the screen
 * — a corner-sized parrot there reads as an afterthought. Do not reach for
 * this in the feed; over a playing video it is exactly the loudness the small
 * hop was sized to avoid.
 *
 * SAME KEYFRAME, DOUBLED IN AMPLITUDE RATHER THAN RE-TIMED: the segment
 * durations are the web's numbers above, untouched, so this finishes inside
 * CELEBRATE_MS exactly like the small hop and every caller's close timer
 * keeps working. Only the travel (lift, entry scale) and the art grow.
 */
export function LoroCelebrationCenter({
  variant = 'correct',
}: {
  variant?: CelebrationVariant;
}) {
  const reduceMotion = useReduceMotion();
  const lift = useSharedValue(24);
  const scale = useSharedValue(0.5);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    const ease = Easing.inOut(Easing.ease);

    opacity.value = withSequence(
      withTiming(1, { duration: RISE, easing: ease }),
      withDelay(OPACITY_HOLD, withTiming(0, { duration: FADE_OUT, easing: ease }))
    );
    lift.value = withSequence(
      withTiming(-16, { duration: RISE, easing: ease }),
      withTiming(0, { duration: SETTLE, easing: ease }),
      withTiming(-10, { duration: HOP2, easing: ease }),
      withTiming(0, { duration: LAND, easing: ease }),
      withTiming(8, { duration: OUT, easing: ease })
    );
    scale.value = withSequence(
      withTiming(1.12, { duration: RISE, easing: ease }),
      withTiming(1, { duration: SETTLE, easing: ease }),
      withDelay(HOP2 + LAND, withTiming(0.94, { duration: OUT, easing: ease }))
    );
  }, [reduceMotion, lift, scale, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));

  // Hidden outright under Reduce Motion, like the small hop: the recalled
  // word's colour change carries the result.
  if (reduceMotion) return null;

  return (
    <View pointerEvents="none" style={styles.centerLayer}>
      <Animated.View style={[styles.centerStage, style]}>
        {/* The burst rides a scaled wrapper so the feathers' fixed offsets
            (±50pt, sized for a word) become a screen-sized throw. */}
        <View style={styles.centerBurst}>
          <FeatherBurst variant={variant} />
        </View>
        <View style={styles.centerPill}>
          <Text style={[styles.centerPillText, { color: VARIANT[variant].color }]}>
            {VARIANT[variant].label}
          </Text>
        </View>
        <Image
          source={BRAND.parrotWaving}
          style={styles.centerParrot}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

/**
 * The feather burst, thrown from the centre of the revealed word.
 *
 * ⚠️ ITS PARENT MUST NOT CLIP. The feathers travel up to 50pt out of a box
 * roughly 40pt tall, so an `overflow: 'hidden'` anywhere above this renders a
 * burst that stops at the word's edge. RevealedWord's own box DOES clip — it
 * has to, so the glow stays inside the rounded corners — which is why the
 * caller nests this as a sibling of that box rather than inside it.
 */
export function FeatherBurst({
  variant = 'correct',
}: {
  variant?: CelebrationVariant;
}) {
  const reduceMotion = useReduceMotion();
  if (reduceMotion) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {FEATHERS.map((feather, index) => (
        <Feather key={index} index={index} variant={variant} {...feather} />
      ))}
    </View>
  );
}

function Feather({
  index,
  dx,
  dy,
  rot,
  variant,
}: {
  index: number;
  dx: number;
  dy: number;
  rot: number;
  variant: CelebrationVariant;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      index * FEATHER_STAGGER,
      withTiming(1, { duration: FEATHER_MS, easing: Easing.out(Easing.ease) })
    );
  }, [progress, index]);

  // nth-child(even) in CSS is the 2nd, 4th, 6th — i.e. odd zero-based indices.
  const pale = index % 2 === 1;
  const width = pale ? 5 : 7;
  const height = pale ? 8 : 11;

  const style = useAnimatedStyle(() => ({
    // The keyframe fades 1 -> 0 across the whole travel, and `forwards` holds
    // it there; the component unmounts with the celebration either way.
    opacity: 1 - progress.value,
    transform: [
      { translateX: dx * progress.value },
      { translateY: dy * progress.value },
      { rotate: `${rot * progress.value}deg` },
      // 1 -> 0.4
      { scale: 1 - 0.6 * progress.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.feather,
        {
          backgroundColor: pale ? VARIANT[variant].pale : VARIANT[variant].color,
          height,
          width,
          // The CSS centres with translate(-50%,-50%); RN has no percentage
          // translate, so half the box comes off the margins instead.
          marginLeft: -width / 2,
          marginTop: -height / 2,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  /** `right`/`top` mirror the web's right-6 top-0, in points. */
  hopLayer: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 6,
    position: 'absolute',
    right: 24,
    top: 0,
  },
  /** The bitmap is 375x420, so a 60pt box would letterbox it. Height matches
      the web's size={60} and the width follows the art's own ratio. */
  parrot: { height: 60, width: 54 },
  pill: {
    backgroundColor: '#1b2420',
    borderRadius: 999,
    marginBottom: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { fontSize: 12, fontWeight: '700' },
  /** Fills the caller's screen and centres the stage; the caller mounts it
      absolutely over everything, pointer-transparent. */
  centerLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  centerStage: { alignItems: 'center' },
  centerBurst: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    transform: [{ scale: 2.6 }],
  },
  /** The same 375x420 art at centre-stage size. */
  centerParrot: { height: 140, width: 125 },
  centerPill: {
    backgroundColor: '#1b2420',
    borderRadius: 999,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  centerPillText: { fontSize: 20, fontWeight: '800' },
  /** Anchored at the parent's centre; the margins above do the -50% part. */
  feather: {
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    left: '50%',
    position: 'absolute',
    top: '50%',
  },
});
