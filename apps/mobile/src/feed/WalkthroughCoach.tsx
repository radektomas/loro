import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * THE WALKTHROUGH'S FLOATING COACH MARKS — the cards and the swipe hint of the
 * onboarding taste reel, drawn OVER the band instead of below the feed.
 *
 * WHY AN OVERLAY. These used to live in a reserved slot above the Continue
 * button, and the reservation was the problem: the player area is flex:1, so a
 * ~104pt slot came straight out of the video, which on a phone-shaped screen
 * cost it a quarter of its width for the whole reel — to hold cards that are on
 * screen for perhaps fifteen seconds of it. Floating costs the video nothing.
 *
 * WHERE IT MAY FLOAT, PRECISELY. `top` is the feed's measured bandTop — the
 * first pixel below the player area — so nothing here can touch the frame no
 * matter how the card is styled. That is the embed-terms rule and it is
 * load-bearing; do not move this above `top` or grow anything upward from it.
 * Below that pixel the card covers the band's chip and author rows, which is
 * fine BECAUSE THE KARAOKE LINE STAYS CLEAR: the tap beat needs the ringed
 * word visible and tappable under the card that is pointing at it, which is
 * why the card is capped at one title line and two body lines rather than
 * allowed to grow into the transcript.
 *
 * pointerEvents="none" ON THE WHOLE LAYER. The cards are read, never pressed,
 * so even while one covers the sound pill a tap lands on the pill rather than
 * on the card. Nothing about this overlay can trap anyone, which is the taste
 * step's standing rule.
 *
 * IT YIELDS TO A HELD BLANK. When a blank stops the video the user is
 * answering, and the card's job is done — "There it is" pointing at a gap the
 * user is already typing into is narration over the event itself. useHeldBlank
 * collapses the whole grading context to the one boolean this needs.
 */

export type CoachCardContent = {
  /** Distinguishes beats for the swap animation and the one urgent style. */
  kind: 'sound' | 'tap' | 'saved' | 'fill';
  title: string;
  body: string;
};

/** In quick, out quicker — the card must never feel like it lingers over the
    band once its beat has passed. */
const SHOW_MS = 220;
const HIDE_MS = 140;

export function WalkthroughCoach({
  coach,
  hint,
  hintText,
  hintEmphatic = false,
  held,
  top,
}: {
  coach: CoachCardContent | null;
  hint: boolean;
  hintText: string;
  /** The full-stop rendering: the walkthrough has paused the video and the
      swipe is the only move left, so the hint stops whispering. */
  hintEmphatic?: boolean;
  /** A blank is holding the video — passed in rather than read here so this
      component stays mountable outside RecallHost in some future screen. */
  held: boolean;
  /** The feed's measured bandTop, or null before the first layout. */
  top: number | null;
}) {
  const reducedMotion = useReducedMotion();

  /**
   * A CARD A HOLD DISMISSED STAYS DISMISSED. The fill card's timer outlives
   * the blank it announces — show at ~0.6s, blank holds at ~2s, timer runs to
   * ~6.6s — so without this latch the card would come back for the timer's
   * remainder after a quick answer, announcing a gap that has already been
   * filled. Keyed by kind: each beat's card appears at most once per feed
   * mount, which is exactly the lifetime of a reel run.
   */
  const dismissedByHold = useRef<Set<CoachCardContent['kind']>>(new Set());
  if (held && coach) dismissedByHold.current.add(coach.kind);
  const shown =
    held || (coach && dismissedByHold.current.has(coach.kind)) ? null : coach;

  /**
   * The card stays MOUNTED through its exit so it can fade rather than blink
   * out: `content` holds the last real card while `visible` animates to 0, and
   * only then is it dropped. A kind change while visible (tap -> saved) swaps
   * the text in place — the beats are one conversation, and a full out-and-in
   * between two sentences of it reads as two interruptions.
   */
  const [content, setContent] = useState<CoachCardContent | null>(shown);
  const visible = useSharedValue(shown ? 1 : 0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    if (shown) {
      setContent(shown);
      visible.value = withTiming(1, { duration: reducedMotion ? 0 : SHOW_MS });
      return;
    }
    visible.value = withTiming(0, { duration: reducedMotion ? 0 : HIDE_MS });
    clearTimer.current = setTimeout(
      () => setContent(null),
      reducedMotion ? 0 : HIDE_MS
    );
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [shown, reducedMotion, visible]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [
      // A small rise and settle rather than a slide: the card appears where it
      // is read, it does not arrive from somewhere.
      { translateY: (1 - visible.value) * 10 },
      { scale: 0.97 + visible.value * 0.03 },
    ],
  }));

  if (top === null) return null;

  return (
    <View pointerEvents="none" style={[styles.layer, { top }]}>
      {content && (
        <Animated.View
          style={[styles.card, content.kind === 'tap' && styles.cardUrgent, cardStyle]}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.title} numberOfLines={1}>
            {content.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {content.body}
          </Text>
        </Animated.View>
      )}
      {!content && hint && <ScrollHint text={hintText} emphatic={hintEmphatic} />}
    </View>
  );
}

/** The swipe hint. A chevron that drifts up, because the gesture is up.
    Emphatic gets a card-weight pill and full-strength text — it appears over
    a video the walkthrough has deliberately stopped, so it must read as the
    instruction it is rather than the whisper the mid-play hint stays. */
function ScrollHint({ text, emphatic = false }: { text: string; emphatic?: boolean }) {
  const y = useSharedValue(0);
  const fade = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    fade.value = withTiming(1, { duration: reducedMotion ? 0 : SHOW_MS });
    if (reducedMotion) return;
    y.value = withRepeat(
      withSequence(
        withTiming(emphatic ? -8 : -6, { duration: 700 }),
        withTiming(0, { duration: 700 })
      ),
      -1,
      false
    );
    return () => cancelAnimation(y);
  }, [reducedMotion, emphatic, y, fade]);
  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: y.value }],
  }));
  return (
    <Animated.View style={[styles.hint, emphatic && styles.hintStrong, style]}>
      <Text style={[styles.hintChevron, emphatic && styles.hintChevronStrong]}>⌃</Text>
      <Text style={[styles.hintText, emphatic && styles.hintTextStrong]}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** Anchored at bandTop and grows DOWNWARD only — see the header note. */
  layer: { left: 0, position: 'absolute', right: 0 },
  card: {
    backgroundColor: 'rgba(16,22,18,0.94)',
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 14,
    borderWidth: 1,
    gap: 3,
    marginHorizontal: 16,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  title: { color: '#5ee6a8', fontSize: 15, fontWeight: '800' },
  body: { color: 'rgba(242,245,243,0.82)', fontSize: 13, lineHeight: 18 },
  /** The tap card carries the reel's one must-not-miss instruction — a
      missed tap costs the next clip its promised blank — so it wears a
      full-strength border while the other beats keep the whisper. Same
      footprint: only the border changes, never the size, per the header's
      rule that nothing may grow toward the transcript. */
  cardUrgent: { borderColor: 'rgba(94,230,168,0.75)', borderWidth: 1.5 },

  /** Centred in the covered chip row, small enough to read as a whisper. */
  hint: { alignItems: 'center', paddingTop: 4 },
  hintChevron: { color: '#5ee6a8', fontSize: 22, fontWeight: '800', lineHeight: 22 },
  hintText: { color: 'rgba(242,245,243,0.6)', fontSize: 13, fontWeight: '600' },
  /** The full-stop variant, drawn with the coach card's own weight. */
  hintStrong: {
    alignSelf: 'center',
    backgroundColor: 'rgba(16,22,18,0.94)',
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  hintChevronStrong: { fontSize: 28, lineHeight: 26 },
  hintTextStrong: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
});
