import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import type { Cue, Word } from '@loro/core/types';
import { usePlayerClock } from '../player/PlayerHost';
import { buildCueSpans, cueIndexAt, wordIndexAt } from './subtitles';

/**
 * Karaoke subtitles for the active slide.
 *
 * THE 60fps PATH, and where each piece runs:
 *
 *   UI thread, every frame   extrapolate the clock from the anchor, find the
 *                            cue and word indices, write them to shared values
 *   UI thread, every frame   each word's highlight style reads wordIndex
 *   JS thread, ~3x/second    ONLY when the cue index changes, re-render the
 *                            line of words
 *
 * Nothing crosses to JS per frame, and nothing crosses the WebView bridge at
 * all — the clock is the local anchor plus elapsed time. That is the whole
 * point of the optimistic model: the web reads video.currentTime in a rAF loop
 * and RN cannot afford the equivalent RPC.
 *
 * The web calls setWordIndex EVERY frame and lets React bail on an unchanged
 * value. That would be a wasted render pass here, so the change detection is
 * explicit: the word highlight never touches React at all, and the cue does so
 * only on a real transition.
 *
 * NO BLANKS. Checkpoint D proves the highlight follows speech and nothing more.
 * The blank hold, its 0.05s re-seat and the typed input are checkpoint F.
 */
export function Karaoke({
  cues,
  language,
  active,
  onWordTap,
}: {
  cues: Cue[];
  language: string;
  /** Only the slide that owns the player runs its loop. A background slide
      reading the shared clock would highlight against another video's time. */
  active: boolean;
  /**
   * Tapping a word opens the save sheet. Only the ACTIVE slide renders words at
   * all (cueIndex stays -1 otherwise), so this can never fire for a background
   * slide — the guard is structural rather than a check.
   */
  onWordTap?: (word: Word, cueIndex: number) => void;
}) {
  const { anchorTime, anchorAt, isPlaying, rate } = usePlayerClock();
  const spans = useMemo(() => buildCueSpans(cues), [cues]);

  const cueIndexSv = useSharedValue(-1);
  const wordIndexSv = useSharedValue(-1);
  const [cueIndex, setCueIndex] = useState(-1);

  // A new video: drop the previous one's indices before the first frame runs.
  useEffect(() => {
    cueIndexSv.value = -1;
    wordIndexSv.value = -1;
    setCueIndex(-1);
  }, [spans, cueIndexSv, wordIndexSv]);

  const frame = useFrameCallback(() => {
    'worklet';
    // The same arithmetic as the JS-side extrapolate(), deliberately duplicated
    // rather than called: this must not leave the UI thread.
    //
    // THE RATE FACTOR IS WHAT KEEPS WORDS ON THE BEAT AT NON-1x SPEEDS. Wall
    // clock is not media clock below 1x — at 0.5x an unscaled model advances
    // twice as fast as the speech, so the highlight reaches the end of the line
    // while the speaker is halfway through it, then snaps back on the next
    // anchor. Multiplying here is the entire fix, and at rate 1 it is a no-op.
    const t = isPlaying.value
      ? anchorTime.value + ((Date.now() - anchorAt.value) / 1000) * rate.value
      : anchorTime.value;

    const ci = cueIndexAt(spans, t, cueIndexSv.value);
    if (ci !== cueIndexSv.value) cueIndexSv.value = ci;

    const wi = wordIndexAt(spans, ci, t);
    if (wi !== wordIndexSv.value) wordIndexSv.value = wi;
  }, false);

  useEffect(() => {
    frame.setActive(active);
  }, [active, frame]);

  // The only JS hop, and only on a real cue transition.
  useAnimatedReaction(
    () => cueIndexSv.value,
    (next, previous) => {
      if (next !== previous) runOnJS(setCueIndex)(next);
    },
    []
  );

  const cue = cueIndex >= 0 ? cues[cueIndex] : null;

  return (
    <View style={styles.track}>
      {cue ? (
        <>
          <View style={styles.line}>
            {cue.words.map((word, index) => (
              <KaraokeWord
                key={`${cueIndex}-${index}`}
                text={word.text}
                index={index}
                current={wordIndexSv}
                onPress={
                  onWordTap ? () => onWordTap(word, cueIndex) : undefined
                }
              />
            ))}
          </View>
          <Text style={styles.translation}>
            {cue.translations[language] ?? cue.translations.en ?? ''}
          </Text>
        </>
      ) : (
        // Reserve the height so the band — and therefore the player box above
        // it — never resizes mid-playback. The web file's note applies: a
        // stable frame beats a few pixels of extra player.
        <View style={styles.placeholder} />
      )}
    </View>
  );
}

/**
 * One word. Its highlight is an animated style reading a shared value, so the
 * transition happens entirely on the UI thread — this component never
 * re-renders while the cue is on screen.
 */
function KaraokeWord({
  text,
  index,
  current,
  onPress,
}: {
  text: string;
  index: number;
  current: { value: number };
  onPress?: () => void;
}) {
  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: current.value === index ? '#5ee6a8' : 'transparent',
  }));
  const textStyle = useAnimatedStyle(() => ({
    color: current.value === index ? '#06130d' : '#f2f5f3',
  }));

  /**
   * Pressable OUTSIDE the animated view, so the touch target is the word's own
   * padded box and the highlight styling stays untouched — the highlight is a
   * UI-thread animated style and must not be re-rendered by press state.
   *
   * `hitSlop` widens the target without widening the layout: the words wrap as
   * a line of text, so growing the box would re-flow the line mid-playback.
   */
  return (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={6}>
      <Animated.View style={[styles.word, boxStyle]}>
        <Animated.Text style={[styles.wordText, textStyle]}>{text}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Matches the web's min-h-[11rem]: sized for the common worst case (a
  // three-line cue plus a two-line translation), not the average.
  track: { minHeight: 176, justifyContent: 'flex-end', paddingHorizontal: 16 },
  placeholder: { height: 176 },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  word: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  wordText: { fontSize: 26, fontWeight: '700', lineHeight: 34 },
  translation: {
    marginTop: 8,
    paddingHorizontal: 6,
    fontSize: 16,
    lineHeight: 23,
    color: 'rgba(242,245,243,0.7)',
  },
});
