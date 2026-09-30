import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AUTO_FOCUS_BLANK } from './recall';
import { useRecallAnswer, useRecallSession } from './RecallHost';
import { useTabBarHeight } from '../shell/tabBar';

/**
 * CHECKPOINT F — the answer surface, and THE KEYBOARD DECISION.
 *
 * THE PROBLEM (R1/R2). Everything Loro draws lives in the band at the BOTTOM
 * of the slide (FeedScreen.tsx:351-366) — that is the embed-terms layout, and
 * it is not negotiable. A software keyboard covers exactly that band, so an
 * input rendered inside the karaoke line is invisible the moment it is
 * focused. The reflex fix, a KeyboardAvoidingView around the slide, is WORSE
 * than useless here: the WebView player is a SIBLING of the list, absolutely
 * positioned from a measured box (PlayerHost.tsx:432-437), so it does not move
 * with the band. Lifting the band slides it straight over the player region —
 * the exact violation FeedScreen.tsx:68-71 exists to prevent.
 *
 * THE CHOICE: keep the band still, move the INPUT — and, because of geometry,
 * have the player yield while the keyboard is up.
 *
 * "Put the input above the keyboard" is not on its own a compliant answer, and
 * the reason is arithmetic rather than implementation: the band is ~210pt and
 * an iPhone keyboard is ~336pt, so ANY bar sitting above the keyboard is above
 * the band's top edge, i.e. inside the player area. There is no height that is
 * both visible and clear of the player. Lifting the band and shrinking the
 * player were therefore never two independent options — see
 * LIFT_PLAYER_WHILE_TYPING in recall.ts for which way that is resolved and why.
 *
 * So the blank stays in the line — it shows what you type, which is the whole
 * "fill in the sentence" payoff — and the keyboard-attached input lives here,
 * in a bar pinned directly above the keyboard, OUTSIDE the FlashList.
 *
 * That placement is not just a workaround; it dissolves two of the other
 * risks outright rather than mitigating them:
 *
 *   R5  a TextInput inside a pagingEnabled list can capture the pan, so a
 *       swipe starting on the blank would not scroll the feed. This input is
 *       not in the list, so it cannot compete for the responder at all. The
 *       in-line blank is a plain View and never takes touches.
 *   R6  a focused TextInput in a recycled cell would follow the cell to
 *       another video. This one is mounted once, next to WordSheet, for the
 *       same reason WordSheet was hoisted out (FeedScreen.tsx:151-155).
 *
 * The deviation from the web, stated plainly: there the input IS the blank,
 * because a desktop/mobile browser reflows the viewport around the keyboard
 * and RN does not. Here they are two halves of one control, ~2cm apart.
 */
export function RecallBar() {
  // keyboardHeight is tracked by the host, not here — the same number decides
  // whether the player has to yield, and one source avoids the two disagreeing.
  const { entry, keyboardHeight, setBarHeight, setAnswer, submit, skip, replay } =
    useRecallSession();
  const answer = useRecallAnswer();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const tabBarHeight = useTabBarHeight();

  // R6, belt and braces: the host dismisses the keyboard on grade and on plan
  // change, but the input's own focus is this component's to drop.
  useEffect(() => {
    if (!entry) inputRef.current?.blur();
  }, [entry]);

  /**
   * THE CHECK BUTTON ARRIVES WITH THE FIRST LETTER (2026-09-30 polish:
   * "the full bar feels a bit oldschool"). A dimmed ✓ sitting there from the
   * start read as a form; springing it in when there is something to check
   * reads as the app answering the user.
   */
  const canSubmit = answer.trim().length > 0;
  const ready = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(ready, {
      toValue: canSubmit ? 1 : 0,
      friction: 6,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [canSubmit, ready]);
  // The card rises in when a blank opens rather than appearing.
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    rise.setValue(0);
    if (!entry) return;
    Animated.timing(rise, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entry, rise]);

  if (!entry) return null;

  // The bar is the other half of the blank in the line, so it carries the same
  // accent — a blue blank must not prompt with a green Check button.
  const isLevel = entry.kind === 'level';
  const accent = isLevel ? '#57b3f2' : '#5ee6a8';

  return (
    <Animated.View
      onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
      style={[
        styles.bar,
        {
          /**
           * FLUSH ON THE KEYBOARD, not floating above it.
           *
           * keyboardHeight is measured from the WINDOW's bottom edge, but this
           * bar is positioned inside the shell's screens container, whose
           * bottom edge is the TOP of the tab bar. Using the raw height left a
           * gap exactly one tab-bar tall. Subtracting closes it; the clamp
           * keeps the bar in place if the layout has not been measured yet.
           */
          bottom: Math.max(0, keyboardHeight - tabBarHeight),
          /**
           * With the keyboard down the bar rests on the tab bar, which already
           * carries the home-indicator inset — adding it again would double the
           * gap. Only fall back to the inset when there is no tab bar to sit on.
           */
          paddingBottom:
            keyboardHeight > 0 || tabBarHeight > 0 ? 8 : insets.bottom + 8,
        },
      ]}
    >
      {/* THE CARD: floating, rounded, lit faintly in the blank's own colour,
          instead of a full-width strip under a hairline. The bar's outer
          geometry (bottom, measured height) is unchanged — only what is
          drawn inside it. */}
      {/* The card fades and settles in; the BAR behind it stays solid and
          still (see styles.bar) — it hides the player's bottom edge while the
          player slides up out of the keyboard's way. */}
      <Animated.View
        style={[
          styles.card,
          { borderColor: `${accent}55`, shadowColor: accent },
          {
            opacity: rise,
            transform: [{ scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
          },
        ]}
      >
      {/* The prompt is the word's own gloss — meaning -> Spanish, the same
          direction and the same source the web uses for its placeholder
          (SubtitleTrack.tsx:357). The sentence translation stays visible in
          the band below the line; this is the word-level cue. */}
      <View style={styles.promptRow}>
        {/* Level blanks say so, because the two ask for different things: a
            green blank is a word YOU chose to learn, a blue one is practice
            at your tier. */}
        <View style={[styles.kindChip, { backgroundColor: `${accent}22` }]}>
          <View style={[styles.kindDot, { backgroundColor: accent }]} />
          <Text style={[styles.kindText, { color: accent }]}>{isLevel ? 'Level' : 'Your word'}</Text>
        </View>
        <Text style={styles.prompt} numberOfLines={2}>
          {entry.word.translation}
        </Text>
      </View>

      <View style={styles.row}>
        {/* F3 — hear the line again. Seeks back to the cue's start and plays;
            the hold re-engages at the word's end on its own, with the typed
            text intact. Lives HERE because the moment you need to re-hear the
            sentence is while you are answering it. */}
        {replay && (
          <Pressable
            onPress={replay}
            accessibilityRole="button"
            accessibilityLabel="Replay the sentence"
            hitSlop={6}
            style={({ pressed }) => [styles.replay, pressed && styles.pressed]}
          >
            <Text style={styles.replayText}>↺</Text>
          </Pressable>
        )}
        {/*
          UNCONTROLLED, keyed by the blank. A controlled input round-trips
          every keystroke through React state and writes it back into the
          native field, and on iOS that is the flicker and caret stutter in
          the typing ("a liiiittle bit janky"). The field owns its text now;
          onChangeText still reports every change (the slot and the grade
          read it), and a new blank remounts the field empty — the host
          clears the answer on the same change (AnswerLayer).
        */}
        <TextInput
          key={`${entry.kind}-${entry.cueIndex}-${entry.word.text}`}
          ref={inputRef}
          defaultValue=""
          onChangeText={setAnswer}
          selectionColor={accent}
          cursorColor={accent}
          // The event's own text is the native field's content AT the return
          // key — pushed through setAnswer first so the grade reads the full
          // word even when the final keystrokes' change events are still
          // queued behind a busy JS thread (the first-word wrong-grade bug).
          onSubmitEditing={(event) => {
            setAnswer(event.nativeEvent.text);
            submit();
          }}
          // R7: false until the keyboard-in vs re-seat overlap is measured.
          // See AUTO_FOCUS_BLANK.
          autoFocus={AUTO_FOCUS_BLANK}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          // 'submit' fires onSubmitEditing and KEEPS focus. blurOnSubmit is the
          // deprecated spelling of this (TextInput.d.ts:760). Grading dismisses
          // the keyboard itself, so letting the return key blur would drop it
          // and re-raise it on a rejected empty submit.
          submitBehavior="submit"
          placeholder="Type the missing word"
          placeholderTextColor="rgba(242,245,243,0.35)"
          accessibilityLabel={
            isLevel
              ? 'Type the level word you just heard'
              : 'Type the missing Spanish word'
          }
          style={styles.input}
        />
        {/* ✓ and ✕ sit 8pt apart, and ✕ grades WRONG unconditionally — so
            their hitSlops must not meet in the gap. A symmetric 6pt on both
            overlapped by 4pt, and the later sibling (skip) won the overlap:
            a tap a few points right of the check mark discarded a correctly
            typed answer as wrong. The slop stays generous on every edge that
            does not face the other button. */}
        <Animated.View
          style={{
            opacity: ready.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ scale: ready.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
          }}
        >
          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Check answer"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 2 }}
            style={({ pressed }) => [
              styles.check,
              { backgroundColor: accent },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.checkText}>✓</Text>
          </Pressable>
        </Animated.View>
        <Pressable
          onPress={skip}
          accessibilityRole="button"
          accessibilityLabel="Skip and reveal"
          hitSlop={{ top: 6, bottom: 6, left: 2, right: 6 }}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>✕</Text>
        </Pressable>
      </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * Pinned to the keyboard's top edge, full width, and SOLID — the feed's
   * own ground. While typing the player slides up out of the way
   * (LIFT_PLAYER_WHILE_TYPING) and WKWebView repaints as it moves; a
   * see-through margin around the card showed that repaint as a glitch
   * "behind" the card (Radek, 2026-09-30). The solid ground hides it, as
   * the old full-width strip did.
   */
  bar: {
    backgroundColor: '#0a0d0b',
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  card: {
    backgroundColor: '#151c18',
    borderRadius: 22,
    borderWidth: 1,
    paddingBottom: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
  },
  promptRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 6 },
  kindChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  kindDot: { borderRadius: 999, height: 6, width: 6 },
  kindText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  prompt: {
    color: 'rgba(242,245,243,0.72)',
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  input: {
    color: '#f2f5f3',
    flex: 1,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 0.2,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  check: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  checkText: { color: '#06130d', fontSize: 18, fontWeight: '900' },
  skip: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  replay: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  replayText: { color: 'rgba(242,245,243,0.75)', fontSize: 18, fontWeight: '700' },
  skipText: { color: 'rgba(242,245,243,0.55)', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
