import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cleanWord } from '@loro/core/dictionary';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BRAND } from '../onboarding/brand';
import { usePlayerApi } from '../player/PlayerHost';
import { requestWordFocus, requestWordsView } from '../vocab/wordsView';
import { subscribeToWordLearned, type WordLearnedRaise } from './wordLearned';
import { subscribeToTripMoment, type TripMoment } from './tripMoments';

/**
 * THE WORD-LEARNED MOMENT — Loro comes in from the side and says it.
 *
 * Radek, 2026-09-18: not in the subtitles; "somewhere like from the side of
 * the screen as Loro is saying it, we have the full screen above with the
 * video". So this is over the frame area: the parrot slides in from the
 * right edge at mid-height with a speech bubble — the word, its meaning,
 * the running count — holds for a couple of seconds and slides back out.
 *
 * Two hosts, one view. The FEED (LearnedToast) listens to the bus and
 * yields the player; the Words tab's FLASHCARD (WordVideoPanel) renders
 * LearnedMomentView directly on its graded face, where the frame is
 * already gone. "The Loro should pop up from the right side also when
 * you're on the Words page" — same animation, same bubble, same tap.
 *
 * THE FRAME IS NOT DRAWN OVER. Nothing may be painted on a playing YouTube
 * player (the embed's terms, see the layout note in PlayerHost), which is
 * why the cards pause and hide it while they are up. The feed host does the
 * same, for a shorter time and behind a lighter dim: onObscurePlayer hides
 * the player (the slide's poster shows through), the clip pauses, and play
 * resumes the instant the moment ends. A tap on the bubble opens the Words
 * tab on the Learned face; a tap anywhere else ends the moment early.
 */
export const LEARNED_MOMENT_MS = 2600;
const OUT_MS = 260;

type Leave = 'done' | 'words';

/** The moment itself: animation, hold, and the two taps. Host-agnostic. */
/** What the bubble says. The word-learned moment and the trip moments share one view. */
export type MomentContent = {
  eyebrow: string;
  word: string;
  meaning: string;
  foot: string;
  opened?: { text: string; translation: string } | null;
  a11y: string;
};

/** The word-learned moment, short enough for the small bubble. */
function learnedTabContent(raise: WordLearnedRaise): MomentContent {
  return {
    eyebrow: '¡Palabra aprendida!',
    word: cleanWord(raise.text),
    meaning: raise.translation,
    foot: `${raise.learned} learned · tap to see them`,
    a11y: `${cleanWord(raise.text)} learned. ${raise.learned} words learned. Opens your learned words.`,
  };
}

/** The word-learned moment, as bubble content. */
function learnedContent(raise: WordLearnedRaise): MomentContent {
  return {
    eyebrow: '¡Palabra aprendida!',
    word: cleanWord(raise.text),
    meaning: raise.translation,
    foot: `${raise.learned} learned${raise.week > 1 ? ` · ${raise.week} this week` : ''} · tap to see them`,
    opened: raise.opened,
    a11y: `${cleanWord(raise.text)} learned. ${raise.learned} words learned. Opens your learned words.`,
  };
}

export function LearnedMomentView({
  raise,
  onDone,
  onWords,
  bandTop,
}: {
  raise: WordLearnedRaise;
  onDone: () => void;
  onWords?: () => void;
  bandTop?: number | null;
}) {
  const content = useMemo(() => learnedContent(raise), [raise]);
  return <MomentView content={content} onDone={onDone} onWords={onWords} bandTop={bandTop} />;
}

/** Loro from the side with a bubble: the animation, the hold, the two taps. */
export function MomentView({
  content,
  onDone,
  onWords,
  bandTop,
}: {
  content: MomentContent;
  /**
   * Where the feed's band starts (FeedScreen's measured bandTop). Given, the
   * moment lives in the band UNDER the video and the video keeps playing
   * (Radek, 2026-10-04: "make it so the video doesn't stop") — nothing may
   * be drawn over a playing YouTube player, so it stays below it. Absent
   * (the Words tab's flashcard), it sits mid-screen as before.
   */
  bandTop?: number | null;
  /** The moment ended on its own or by a tap on the dim: carry on. */
  onDone: () => void;
  /** The bubble was tapped: show the learned words. Absent = same as done. */
  onWords?: () => void;
}) {
  const slide = useSharedValue(0); // 0 = off the right edge, 1 = in
  const bubble = useSharedValue(0);
  /** The dark layer, faded in first so nothing below changes with a cut. */
  const dim = useSharedValue(0);
  /** Idle bob while he talks, so he is never a sticker. */
  const bob = useSharedValue(0);
  /** The little hop as he leaves. */
  const hop = useSharedValue(0);
  const inBand = bandTop !== undefined && bandTop !== null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingRef = useRef<Leave | null>(null);

  const finish = useCallback(() => {
    const how = leavingRef.current ?? 'done';
    leavingRef.current = null;
    if (how === 'words' && onWords) onWords();
    else onDone();
  }, [onDone, onWords]);

  const leave = useCallback(
    (how: Leave) => {
      if (leavingRef.current) return;
      leavingRef.current = how;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // The bubble folds first, he hops, then slides away; the dark layer
      // goes with him.
      cancelAnimation(bob);
      bubble.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.cubic) });
      hop.value = withSequence(withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 170 }));
      dim.value = withDelay(120, withTiming(0, { duration: OUT_MS }));
      slide.value = withDelay(
        110,
        withTiming(0, { duration: OUT_MS, easing: Easing.in(Easing.cubic) }, (done) => {
          if (done) runOnJS(finish)();
        })
      );
    },
    [bubble, slide, dim, hop, bob, finish]
  );

  useEffect(() => {
    leavingRef.current = null;
    slide.value = 0;
    bubble.value = 0;
    dim.value = 0;
    hop.value = 0;
    bob.value = 0;
    // The calm first: the layer fades in, THEN Loro arrives — a softer spring,
    // less swing — and the bubble pops just after him.
    dim.value = withTiming(1, { duration: 160 });
    slide.value = withDelay(110, withSpring(1, { damping: 18, stiffness: 140 }));
    bubble.value = withDelay(260, withSpring(1, { damping: 15, stiffness: 190 }));
    bob.value = withDelay(
      700,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 650, easing: Easing.inOut(Easing.quad) })
        ),
        -1
      )
    );
    timer.current = setTimeout(() => leave('done'), LEARNED_MOMENT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      cancelAnimation(bob);
    };
  }, [content, slide, bubble, dim, bob, hop, leave]);

  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value * (inBand ? 0.8 : 0.55) }));
  const parrotStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (1 - slide.value) * 180 },
      { translateY: -bob.value * 5 - hop.value * 12 },
      { rotate: `${(1 - slide.value) * -4 + bob.value * 2}deg` },
    ],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: bubble.value,
    transform: [{ scale: 0.85 + bubble.value * 0.15 }, { translateX: (1 - bubble.value) * 24 }],
  }));

  return (
    <View style={[styles.layer, inBand && { top: bandTop as number }]}>
      {/* A tap anywhere ends the moment and whatever was happening carries on. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => leave('done')} accessibilityLabel="Continue">
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
      </Pressable>

      <View style={[styles.stage, inBand && styles.stageBand]} pointerEvents="box-none">
        <Animated.View style={[styles.bubbleWrap, bubbleStyle]}>
          <Pressable
            onPress={() => leave('words')}
            accessibilityRole="button"
            accessibilityLabel={content.a11y}
            style={({ pressed }) => [styles.bubble, pressed && styles.pressed]}
          >
            <Text style={styles.eyebrow}>{content.eyebrow}</Text>
            <Text style={styles.word}>{content.word}</Text>
            <Text style={styles.meaning} numberOfLines={3}>
              {content.meaning}
            </Text>
            <Text style={styles.count}>{content.foot}</Text>
            {content.opened && (
              <View style={styles.opened}>
                <Text style={styles.openedLabel}>Next up</Text>
                <Text style={styles.openedWord} numberOfLines={1}>
                  {cleanWord(content.opened.text)}
                  <Text style={styles.openedMeaning}>  {content.opened.translation}</Text>
                </Text>
              </View>
            )}
          </Pressable>
          <View style={styles.tail} />
        </Animated.View>

        <Animated.View style={[styles.parrotWrap, parrotStyle]} pointerEvents="none">
          <Image
            source={BRAND.parrot}
            style={styles.parrot}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Loro the parrot"
          />
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * THE SMALL ONE, FROM THE WORDS TAB (Radek, 2026-10-04: "still too big ...
 * he will pop up from there [the Words button] and be smaller"). The feed's
 * moments: a small Loro rises out of the middle tab with a compact bubble
 * pointing down at it — the word went THERE — while the video plays on
 * above, untouched and undimmed. Tap the bubble for Words; otherwise he
 * dips back into the tab.
 */
const TAB_MOMENT_MS = 3200;
const RISE = 58;

export function TabMomentView({
  content,
  onDone,
  onWords,
}: {
  content: MomentContent;
  onDone: () => void;
  onWords?: () => void;
}) {
  const rise = useSharedValue(0);
  const pop = useSharedValue(0);
  const bob = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingRef = useRef<Leave | null>(null);

  const finish = useCallback(() => {
    const how = leavingRef.current ?? 'done';
    leavingRef.current = null;
    if (how === 'words' && onWords) onWords();
    else onDone();
  }, [onDone, onWords]);

  const leave = useCallback(
    (how: Leave) => {
      if (leavingRef.current) return;
      leavingRef.current = how;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      cancelAnimation(bob);
      pop.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.cubic) });
      rise.value = withDelay(
        90,
        withTiming(0, { duration: 240, easing: Easing.in(Easing.cubic) }, (done) => {
          if (done) runOnJS(finish)();
        })
      );
    },
    [rise, pop, bob, finish]
  );

  useEffect(() => {
    leavingRef.current = null;
    rise.value = 0;
    pop.value = 0;
    bob.value = 0;
    rise.value = withSpring(1, { damping: 15, stiffness: 160 });
    pop.value = withDelay(200, withSpring(1, { damping: 14, stiffness: 210 }));
    bob.value = withDelay(
      650,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 600, easing: Easing.inOut(Easing.quad) })
        ),
        -1
      )
    );
    timer.current = setTimeout(() => leave('done'), TAB_MOMENT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      cancelAnimation(bob);
    };
  }, [content, rise, pop, bob, leave]);

  const loroStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - rise.value) * RISE - bob.value * 3 }, { rotate: `${bob.value * 3 - 1.5}deg` }],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ translateY: (1 - pop.value) * 10 }, { scale: 0.8 + pop.value * 0.2 }],
  }));

  return (
    <View style={styles.tabLayer} pointerEvents="box-none">
      <Animated.View style={[styles.tabBubbleWrap, bubbleStyle]}>
        <Pressable
          onPress={() => leave('words')}
          accessibilityRole="button"
          accessibilityLabel={content.a11y}
          style={({ pressed }) => [styles.tabBubble, pressed && styles.pressed]}
        >
          <Text style={styles.tabEyebrow}>{content.eyebrow}</Text>
          <Text style={styles.tabWord} numberOfLines={1}>
            {content.word}
          </Text>
          <Text style={styles.tabLine} numberOfLines={2}>
            {content.meaning}
          </Text>
          <Text style={styles.tabFoot}>{content.foot}</Text>
        </Pressable>
        <View style={styles.tabTail} />
      </Animated.View>
      {/* A clip at the bottom edge, so he comes OUT of the tab, not through it. */}
      <View style={styles.tabClip} pointerEvents="none">
        <Animated.View style={loroStyle}>
          <Image source={BRAND.parrot} style={styles.tabLoro} resizeMode="contain" />
        </Animated.View>
      </View>
    </View>
  );
}

/** The feed's host: the bus, the tab gate, and the player yield. */
export function LearnedToast({
  active,
  onObscurePlayer,
  onGoToWords,
  bandTop,
  fromTab,
}: {
  /** The band's top: given, the moments sit under the video and it keeps playing. */
  bandTop?: number | null;
  /** The small moment, rising from the Words tab (TabMomentView). The video plays on. */
  fromTab?: boolean;
  /** Only the visible feed shows it — the Words tab's flashcard has its
      own host, and a raise from there must not pause and replay a hidden
      feed player. */
  active: boolean;
  onObscurePlayer: (obscured: boolean) => void;
  onGoToWords?: () => void;
}) {
  const api = usePlayerApi();
  const [raise, setRaise] = useState<WordLearnedRaise | null>(null);
  /** A trip milestone (tripMoments). A word-learned moment wins if both arrive. */
  const [trip, setTrip] = useState<TripMoment | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(
    () =>
      subscribeToWordLearned((next) => {
        if (activeRef.current) setRaise(next);
      }),
    []
  );
  useEffect(
    () =>
      subscribeToTripMoment((next) => {
        if (activeRef.current) setTrip((cur) => cur ?? next);
      }),
    []
  );
  const tripContent = useMemo<MomentContent | null>(
    () =>
      trip
        ? { eyebrow: trip.eyebrow, word: trip.word, meaning: trip.line, foot: trip.foot, a11y: `${trip.eyebrow} ${trip.word}. ${trip.line}` }
        : null,
    [trip]
  );

  const open = raise !== null || trip !== null;
  // Under the video (bandTop known), the video plays on: nothing to hide,
  // nothing to pause. Without it, the old contract: yield and pause.
  const inBand = fromTab || (bandTop !== undefined && bandTop !== null);
  useEffect(() => {
    if (inBand) return;
    onObscurePlayer(open);
    if (open) api.pause();
    return () => onObscurePlayer(false);
  }, [open, onObscurePlayer, api, inBand]);

  const done = useCallback(() => {
    setRaise(null);
    setTrip(null);
    if (!inBand) api.play();
  }, [api, inBand]);
  const words = useCallback(() => {
    setRaise(null);
    if (onGoToWords) {
      requestWordsView('learned');
      onGoToWords();
    } else {
      api.play();
    }
  }, [api, onGoToWords]);

  /** A trip moment's tap: Words, on the word you are on or on the city. */
  const tripWords = useCallback(() => {
    const land = trip?.land;
    setTrip(null);
    if (onGoToWords) {
      if (land === 'word') requestWordFocus();
      onGoToWords();
    } else {
      api.play();
    }
  }, [api, onGoToWords, trip]);

  if (fromTab) {
    const content = raise ? learnedTabContent(raise) : tripContent;
    if (!content) return null;
    return <TabMomentView content={content} onDone={done} onWords={raise ? words : tripWords} />;
  }
  if (raise) return <LearnedMomentView raise={raise} onDone={done} onWords={words} bandTop={bandTop} />;
  if (tripContent) return <MomentView content={tripContent} onDone={done} onWords={tripWords} bandTop={bandTop} />;
  return null;
}

const styles = StyleSheet.create({
  layer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  dim: { backgroundColor: '#0a0d0b' },
  /** Mid-height of the area, which is where the frame is. */
  stage: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: '34%',
  },
  /** In the band: near its top, just under the video. */
  stageBand: { top: 14 },
  /** The small moment: the bottom of the feed, centred over the Words tab. */
  tabLayer: { alignItems: 'center', bottom: 0, left: 0, position: 'absolute', right: 0 },
  tabBubbleWrap: { alignItems: 'center', marginBottom: -2 },
  tabBubble: {
    backgroundColor: '#f2f5f3',
    borderRadius: 16,
    maxWidth: 236,
    paddingHorizontal: 12,
    paddingVertical: 9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  tabEyebrow: { color: '#1d9a63', fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  tabWord: { color: '#0a0d0b', fontSize: 17, fontWeight: '900', marginTop: 1 },
  tabLine: { color: 'rgba(10,13,11,0.7)', fontSize: 12, fontWeight: '700', lineHeight: 16, marginTop: 2 },
  tabFoot: { color: 'rgba(10,13,11,0.45)', fontSize: 10, fontWeight: '800', marginTop: 4 },
  tabTail: {
    backgroundColor: '#f2f5f3',
    height: 12,
    marginTop: -6,
    transform: [{ rotate: '45deg' }],
    width: 12,
  },
  tabClip: { alignItems: 'center', height: 50, overflow: 'hidden', width: 60 },
  tabLoro: { height: 50, marginTop: 4, width: 34 },
  bubbleWrap: { alignItems: 'flex-end', flexDirection: 'row', flexShrink: 1, marginLeft: 20 },
  bubble: {
    backgroundColor: '#f2f5f3',
    borderRadius: 20,
    maxWidth: 250,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.9 },
  /** The bubble's tail, pointing at the parrot. */
  tail: {
    backgroundColor: '#f2f5f3',
    height: 14,
    marginBottom: 26,
    marginLeft: -7,
    transform: [{ rotate: '45deg' }],
    width: 14,
  },
  eyebrow: {
    color: '#1d9a63',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  word: { color: '#06130d', fontSize: 24, fontWeight: '800', marginTop: 2 },
  meaning: { color: 'rgba(6,19,13,0.7)', fontSize: 15, marginTop: 1 },
  count: { color: 'rgba(6,19,13,0.55)', fontSize: 12, fontWeight: '600', marginTop: 8 },
  /** The path's unlock (roadmap.ts), under the count. */
  opened: {
    backgroundColor: 'rgba(6,19,13,0.08)',
    borderRadius: 10,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  openedLabel: { color: 'rgba(6,19,13,0.55)', fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  openedWord: { color: '#06130d', fontSize: 15, fontWeight: '800', marginTop: 1 },
  openedMeaning: { color: 'rgba(6,19,13,0.6)', fontSize: 13, fontWeight: '600' },
  /** The parrot is 282x420; 150 tall keeps its ratio at ~100 wide. It
      starts past the right edge and settles with its back to it. */
  parrotWrap: { marginLeft: 6, marginRight: -18 },
  parrot: { height: 150, width: 100 },
});
