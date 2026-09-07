import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { splitFunctionWords } from '@loro/core/progress';
import { BRAND } from '../onboarding/brand';
import { usePlayerApi } from '../player/PlayerHost';
import { subscribeToDayDone, type DayDoneRaise } from './dayDone';
import { subscribeToReviewEnd, type ReviewSessionEnd } from './reviewSession';

/**
 * THE DAY-DONE CARD — the app's first ending — and, since 2026-09-07, the
 * review session's too. ONE CARD, TWO FACES, because they are the same
 * moment ("you're done") with different arithmetic, and because a session
 * whose last answer also finishes the day must say both on one card, not
 * stack two.
 *
 *   day      raised through dayDone.ts after the celebration for the
 *            answer that completed today's goal: the day is done, what
 *            today added up to (answers, streak), the words that did it.
 *   session  raised through reviewSession.ts when the session hit its size
 *            or the feed ran out of the user's words: N of M right, the
 *            words with a tick or a cross, and the day-done line when the
 *            session earned it.
 *
 * Then one button to carry on and one to go and look.
 *
 * PRESENTATION IS NotificationPrompt's SHELL — a card over a dimmed backdrop,
 * onObscurePlayer while up (the embed-terms rule: nothing floats over a
 * visible player). The player is PAUSED on the way in, not merely hidden:
 * the video resumed 600ms after the grade, and a win that plays over
 * someone else's sentence is not a moment. "Keep going" resumes it.
 *
 * THE CHIPS NAME CONTENT WORDS ONLY. "de" and "que" were real answers and
 * counted toward the goal, but on a card they read as padding; they are
 * summed into one line instead (splitFunctionWords), the same treatment the
 * Progress page gives the week.
 */
const MAX_CHIPS = 8;

type Raise =
  | { kind: 'day'; day: DayDoneRaise }
  | { kind: 'session'; session: ReviewSessionEnd };

function streakLineFor(streak: number): string {
  return streak >= 2
    ? `${streak} days in a row 🔥`
    : 'Day one of a streak. Tomorrow makes two.';
}

export function DayDoneCard({
  onObscurePlayer,
  onGoToProgress,
}: {
  /** Raised while the card is up, so the WebView fades and the slide's poster
      carries the frame underneath — same contract as NotificationPrompt. */
  onObscurePlayer: (obscured: boolean) => void;
  onGoToProgress?: () => void;
}) {
  const api = usePlayerApi();
  const [raise, setRaise] = useState<Raise | null>(null);

  useEffect(() => subscribeToDayDone((day) => setRaise({ kind: 'day', day })), []);
  useEffect(
    () => subscribeToReviewEnd((session) => setRaise({ kind: 'session', session })),
    []
  );

  const open = raise !== null;
  useEffect(() => {
    onObscurePlayer(open);
    if (open) api.pause();
    // Lower it on unmount too — a tab switch must not leave the player hidden.
    return () => onObscurePlayer(false);
  }, [open, onObscurePlayer, api]);

  if (!raise) return null;

  const keepGoing = () => {
    setRaise(null);
    api.play();
  };
  const seeProgress = () => {
    setRaise(null);
    onGoToProgress?.();
  };

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Image
          source={BRAND.parrotWaving}
          style={styles.art}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Loro the parrot, waving"
        />
        {raise.kind === 'day' ? <DayFace raise={raise.day} /> : <SessionFace end={raise.session} />}

        <Pressable
          onPress={keepGoing}
          accessibilityRole="button"
          accessibilityLabel="Keep going"
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>{raise.kind === 'day' ? 'Keep going' : 'Keep watching'}</Text>
        </Pressable>

        {onGoToProgress && (
          <Pressable
            onPress={seeProgress}
            accessibilityRole="button"
            accessibilityLabel="See my progress"
            style={({ pressed }) => [styles.later, pressed && styles.pressed]}
          >
            <Text style={styles.laterText}>See my progress</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DayFace({ raise }: { raise: DayDoneRaise }) {
  const { content, small } = splitFunctionWords(raise.words);
  const chips = content.slice(0, MAX_CHIPS);
  const moreContent = content.length - chips.length;

  return (
    <>
      <Text style={styles.title}>¡Día hecho!</Text>
      <Text style={styles.gloss}>day done</Text>
      <Text style={styles.body}>
        {raise.count} {raise.count === 1 ? 'word' : 'words'} right today.{' '}
        {streakLineFor(raise.streak)}
      </Text>

      {(chips.length > 0 || small.length > 0) && (
        <View style={styles.chips} accessibilityLabel="Today's words">
          {chips.map((word) => (
            <View key={`${word.videoId}:${word.text}`} style={styles.chip}>
              <Text style={styles.chipText}>{word.text}</Text>
            </View>
          ))}
          {moreContent > 0 && (
            <View style={[styles.chip, styles.chipQuiet]}>
              <Text style={[styles.chipText, styles.chipTextQuiet]}>
                +{moreContent} more
              </Text>
            </View>
          )}
          {small.length > 0 && (
            <View style={[styles.chip, styles.chipQuiet]}>
              <Text style={[styles.chipText, styles.chipTextQuiet]}>
                +{small.length} small {small.length === 1 ? 'word' : 'words'}
              </Text>
            </View>
          )}
        </View>
      )}
    </>
  );
}

/**
 * The session face. Every answered word is shown — right in mint, missed
 * crossed and quiet — because a review's whole point is which ones came
 * back; there is no "small words" fold here, the user chose to review them.
 * A session the feed cut short says so, so "3 of 3" under a goal of 5 does
 * not read as the app giving up early.
 */
function SessionFace({ end }: { end: ReviewSessionEnd }) {
  const shown = end.words.slice(0, MAX_CHIPS);
  const more = end.words.length - shown.length;
  const short = end.reason === 'ranOut' && end.answered < end.size;

  return (
    <>
      <Text style={styles.title}>¡Sesión hecha!</Text>
      <Text style={styles.gloss}>session done</Text>
      <Text style={styles.body}>
        {end.correct} of {end.answered} right.
        {short ? ' That was every word of yours in a video right now.' : ''}
      </Text>
      {end.dayDone && (
        <Text style={styles.dayLine}>
          ¡Día hecho! · {streakLineFor(end.dayDone.streak)}
        </Text>
      )}

      <View style={styles.chips} accessibilityLabel="This session's words">
        {shown.map((word, i) => (
          <View
            key={`${i}:${word.text}`}
            style={[styles.chip, !word.correct && styles.chipMissed]}
          >
            <Text style={[styles.chipText, !word.correct && styles.chipTextMissed]}>
              {word.correct ? '✓' : '✗'} {word.text}
            </Text>
          </View>
        ))}
        {more > 0 && (
          <View style={[styles.chip, styles.chipQuiet]}>
            <Text style={[styles.chipText, styles.chipTextQuiet]}>+{more} more</Text>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  /** NotificationPrompt's backdrop verbatim: fills the feed area above the
      tab bar, opaque enough to read against the paused frame. */
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,13,11,0.86)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  card: {
    backgroundColor: '#141a17',
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    width: '100%',
  },
  /** The waving art is 375x420; 96pt tall keeps its ratio at ~86 wide. */
  art: { alignSelf: 'center', height: 96, marginBottom: 10, width: 86 },
  title: {
    color: '#5ee6a8',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 32,
    textAlign: 'center',
  },
  /** The gloss under the Spanish, the way a subtitle sits under a line — the
      title is doing double duty as copy and as vocabulary. */
  gloss: {
    color: 'rgba(242,245,243,0.45)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
  body: {
    color: 'rgba(242,245,243,0.8)',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 12,
    textAlign: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginTop: 14,
  },
  chip: {
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipQuiet: { backgroundColor: 'rgba(242,245,243,0.08)' },
  chipMissed: { backgroundColor: 'rgba(248,113,113,0.14)' },
  chipText: { color: '#5ee6a8', fontSize: 14, fontWeight: '700' },
  chipTextQuiet: { color: 'rgba(242,245,243,0.6)', fontWeight: '600' },
  chipTextMissed: { color: '#f87171' },
  /** The day, when the session earned it: one mint line under the score. */
  dayLine: {
    color: '#5ee6a8',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 8,
    textAlign: 'center',
  },
  cta: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 14,
    marginTop: 20,
    paddingVertical: 13,
  },
  ctaText: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  later: { alignItems: 'center', marginTop: 4, paddingVertical: 12 },
  laterText: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: { opacity: 0.7 },
});
