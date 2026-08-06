import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
 * HIDE_PLAYER_WHILE_TYPING in recall.ts for which way that is resolved and why.
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
  const { entry, keyboardHeight, setAnswer, submit, skip } = useRecallSession();
  const answer = useRecallAnswer();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const tabBarHeight = useTabBarHeight();

  // R6, belt and braces: the host dismisses the keyboard on grade and on plan
  // change, but the input's own focus is this component's to drop.
  useEffect(() => {
    if (!entry) inputRef.current?.blur();
  }, [entry]);

  if (!entry) return null;

  const canSubmit = answer.trim().length > 0;
  // The bar is the other half of the blank in the line, so it carries the same
  // accent — a blue blank must not prompt with a green Check button.
  const isLevel = entry.kind === 'level';
  const accent = isLevel ? '#57b3f2' : '#5ee6a8';

  return (
    <View
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
            keyboardHeight > 0 || tabBarHeight > 0 ? 10 : insets.bottom + 10,
        },
      ]}
    >
      {/* The prompt is the word's own gloss — meaning -> Spanish, the same
          direction and the same source the web uses for its placeholder
          (SubtitleTrack.tsx:357). The sentence translation stays visible in
          the band below the line; this is the word-level cue. */}
      <Text style={styles.prompt} numberOfLines={2}>
        {/* Level blanks say so, because the two ask for different things: a
            green blank is a word YOU chose to learn, a blue one is practice
            at your tier. */}
        {isLevel && <Text style={{ color: accent }}>Level practice · </Text>}
        {entry.word.translation}
      </Text>

      <View style={styles.row}>
        <TextInput
          ref={inputRef}
          value={answer}
          onChangeText={setAnswer}
          onSubmitEditing={submit}
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
          style={[styles.input, { borderBottomColor: accent }]}
        />
        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Check answer"
          hitSlop={6}
          style={({ pressed }) => [
            styles.check,
            { backgroundColor: accent },
            !canSubmit && styles.checkOff,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.checkText}>✓</Text>
        </Pressable>
        <Pressable
          onPress={skip}
          accessibilityRole="button"
          accessibilityLabel="Skip and reveal"
          hitSlop={6}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#111613',
    borderTopColor: 'rgba(242,245,243,0.12)',
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  prompt: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  input: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderBottomColor: '#5ee6a8',
    borderBottomWidth: 2,
    borderRadius: 8,
    color: '#f2f5f3',
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  check: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  checkOff: { opacity: 0.4 },
  checkText: { color: '#06130d', fontSize: 17, fontWeight: '800' },
  skip: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  skipText: { color: 'rgba(242,245,243,0.6)', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
