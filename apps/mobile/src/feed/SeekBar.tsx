import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Video } from '@loro/core/types';
import { usePlayerApi, usePlayerClock } from '../player/PlayerHost';
import { useHeldBlank, useNoteSeek } from './RecallHost';

/**
 * THE SEEK BAR — a green progress line in the seam between the video and the
 * band, draggable in either direction.
 *
 * WHERE IT SITS, AND WHY THAT IS THE ONLY PLACE. The player box bottoms out
 * exactly on bandTop (the box is height-constrained on every supported phone),
 * so the first rows of the band ARE the gap under the video. The bar takes the
 * seam itself: below the frame — nothing Loro draws may cover the player, and
 * a scrubber drawn over the video's bottom edge is exactly the TikTok pattern
 * this app is not allowed — and above the chip row, so it reads as part of the
 * video rather than part of the transcript.
 *
 * THE LINE IS THE CLOCK'S. Position comes from the same worklet extrapolation
 * Karaoke runs — anchor plus elapsed wall time scaled by the confirmed rate —
 * so the bar and the karaoke highlight can never disagree about where the
 * video is. The span is the last cue's end: it is the span every other Loro
 * surface is built on, and the audible content is what a learner would scrub
 * through. Progress is clamped, so a musical outro past the last cue shows as
 * a full bar rather than an overflowing one.
 *
 * SEEKING IS OPTIMISTIC, BRIEFLY. api.seek is a bridge round trip, and until
 * the page posts its new anchor the extrapolated clock still reads the OLD
 * position — a bar that obeyed it would snap back for a few hundred
 * milliseconds and then jump forward, which reads as a failed drag. After a
 * release the worklet holds the bar at the drag's target until the anchor
 * lands near it (or a timeout gives up and believes the clock again).
 *
 * IT STANDS DOWN WHILE A BLANK HOLDS THE VIDEO. A held blank is RecallHost
 * asserting a pause it will re-assert if playback slips; a scrub during it
 * would fight that assertion and burn the blank's reseat budget on a fight the
 * user cannot see. The gesture disables and the bar dims — still true as a
 * readout, just not a control.
 *
 * A BLANK JUMPED OVER IS SKIPPED, NOT SPRUNG. A recall blank asks "what did
 * she just say?", and a seek past its word means she never said it to this
 * user — engaging at the landing point would demand recall of audio that was
 * never heard. So every commit reports its span to RecallHost (useNoteSeek)
 * BEFORE the seek command goes out: blanks inside a forward jump are skipped
 * (still due in the SRS, back in another video), and a backward jump re-arms
 * any skipped blank it puts back in front of the clock, because the word will
 * now be heard the honest way.
 *
 * THE GESTURE MUST COEXIST WITH THE PAGER. The bar lives inside a vertically
 * paging list, so the pan activates only after clearly horizontal movement and
 * fails on clearly vertical movement — a vertical swipe that begins on the bar
 * still turns the page. A plain tap seeks directly; that never scrolls, so it
 * has no such condition.
 */

/** Nothing after this close to the end is worth landing on: embed seeks land
    within ±0.5s, and seeking INTO the final half-second just ends the video. */
const SEEK_TAIL_PAD_S = 0.5;
/** How long a released drag may pin the bar while the seek's round trip is in
    flight. The anchor usually lands well inside this; the timeout only exists
    so a dropped message cannot pin the bar forever. */
const SEEK_SETTLE_MS = 1200;
/** How near the landed anchor must be to the target before the bar trusts the
    clock again. Generous because embed seeks are approximate by ±0.5s. */
const SEEK_SETTLE_EPSILON_S = 1.2;

export function SeekBar({
  cues,
  active,
}: {
  cues: Video['cues'];
  /** The slide is on screen AND owns the player — same gate as Karaoke's. */
  active: boolean;
}) {
  const api = usePlayerApi();
  const { anchorTime, anchorAt, isPlaying, rate } = usePlayerClock();
  const held = useHeldBlank();
  const noteSeek = useNoteSeek();

  const span = cues.length > 0 ? cues[cues.length - 1].end : 0;

  /** Track width, measured — the fill and the knob are positioned in pixels
      because a percentage width cannot be written from a worklet's number
      without a string build per frame. */
  const width = useSharedValue(0);
  const frac = useSharedValue(0);
  const dragging = useSharedValue(0);
  const scrubFrac = useSharedValue(0);
  const seekTarget = useSharedValue(-1);
  const seekUntil = useSharedValue(0);

  const frame = useFrameCallback(() => {
    'worklet';
    if (span <= 0) return;
    if (dragging.value === 1) {
      frac.value = scrubFrac.value;
      return;
    }
    let t = isPlaying.value
      ? anchorTime.value + ((Date.now() - anchorAt.value) / 1000) * rate.value
      : anchorTime.value;
    if (seekUntil.value > 0) {
      if (
        Date.now() < seekUntil.value &&
        Math.abs(t - seekTarget.value) > SEEK_SETTLE_EPSILON_S
      ) {
        t = seekTarget.value; // the round trip is still in flight — hold the drag's answer
      } else {
        seekUntil.value = 0;
      }
    }
    frac.value = Math.min(1, Math.max(0, t / span));
  }, false);

  useEffect(() => {
    frame.setActive(active && span > 0);
  }, [active, span, frame]);

  const seekTo = (from: number, target: number) => {
    const to = Math.min(Math.max(0, target), Math.max(0, span - SEEK_TAIL_PAD_S));
    // The report goes FIRST: the skipped-blank mask must be set before the
    // player can land, or the hold could engage on a blank mid-jump.
    noteSeek(from, to);
    api.seek(to);
  };

  const commit = (f: number) => {
    'worklet';
    /**
     * Where the seek starts FROM. The clock still reads the pre-seek position
     * (the bridge round trip has not happened), so extrapolating here is
     * honest — except when a previous seek is still settling, where the truth
     * is that seek's target rather than the stale anchor. Without that branch
     * two quick forward drags would report the second jump as starting at the
     * first's origin and skip blanks the user actually stopped to hear.
     */
    const from =
      seekUntil.value > Date.now()
        ? seekTarget.value
        : isPlaying.value
          ? anchorTime.value + ((Date.now() - anchorAt.value) / 1000) * rate.value
          : anchorTime.value;
    const target = f * span;
    seekTarget.value = target;
    seekUntil.value = Date.now() + SEEK_SETTLE_MS;
    runOnJS(seekTo)(from, target);
  };

  const enabled = active && !held && span > 0;

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Horizontal-only, so a page swipe that starts on the bar still pages.
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .hitSlop({ top: 6, bottom: 10 })
    .onStart((e) => {
      'worklet';
      if (width.value <= 0) return;
      dragging.value = 1;
      scrubFrac.value = Math.min(1, Math.max(0, e.x / width.value));
    })
    .onUpdate((e) => {
      'worklet';
      if (width.value <= 0) return;
      scrubFrac.value = Math.min(1, Math.max(0, e.x / width.value));
    })
    .onEnd(() => {
      'worklet';
      commit(scrubFrac.value);
    })
    .onFinalize(() => {
      'worklet';
      dragging.value = 0;
    });

  const tap = Gesture.Tap()
    .enabled(enabled)
    .hitSlop({ top: 6, bottom: 10 })
    .onEnd((e) => {
      'worklet';
      if (width.value <= 0) return;
      const f = Math.min(1, Math.max(0, e.x / width.value));
      frac.value = f; // land the line under the finger immediately
      commit(f);
    });

  const fillStyle = useAnimatedStyle(() => ({
    width: width.value * frac.value,
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: width.value * frac.value },
      { scale: withTiming(dragging.value === 1 ? 1.6 : 1, { duration: 120 }) },
    ],
  }));
  /** Dragging thickens the line — the touch is acknowledged where the eye
      already is, without a popup. */
  const trackStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleY: withTiming(dragging.value === 1 ? 1.9 : 1, { duration: 120 }) },
    ],
  }));

  if (span <= 0) return null;

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        style={[styles.row, !enabled && styles.dimmed]}
        onLayout={(e) => {
          width.value = e.nativeEvent.layout.width;
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Video progress"
      >
        <Animated.View style={[styles.track, trackStyle]}>
          <Animated.View style={[styles.fill, fillStyle]} />
        </Animated.View>
        {enabled && <Animated.View style={[styles.knob, knobStyle]} />}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  /** The seam row. Tall enough to be a finger target on its own; the visual
      line is centred inside it. */
  row: { height: 16, justifyContent: 'center', marginHorizontal: 20 },
  dimmed: { opacity: 0.45 },
  track: {
    backgroundColor: 'rgba(242,245,243,0.16)',
    borderRadius: 1.5,
    height: 3,
    overflow: 'hidden',
  },
  fill: {
    backgroundColor: '#5ee6a8',
    borderRadius: 1.5,
    height: '100%',
  },
  knob: {
    backgroundColor: '#5ee6a8',
    borderRadius: 4.5,
    height: 9,
    // Centred on the fill's end: translateX moves its LEFT edge there, so pull
    // back by half its own width.
    left: -4.5,
    position: 'absolute',
    width: 9,
  },
});
