import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND } from '../onboarding/brand';
import { usePlayerApi, usePlayerClock } from '../player/PlayerHost';
import { track } from '../platform/analytics';
import { subscribeToFeedback, takeFeedback, videosToday, type FeedbackFrom } from './feedbackBus';

/**
 * "HOW'S LORO SO FAR?" (Radek, 2026-11-18). One tap for the mood, then an
 * optional sentence. feedbackBus.ts decides when the feed asks; the Progress
 * row opens it on demand.
 *
 * Logged as feedback_given { from, mood, text?, videos } — the same table as
 * everything else, read on /analyticsforradek through
 * loro_analytics_app_feedback (migration 20261118000000). "Not now" is
 * mood 'skipped', so asked-vs-answered is countable.
 *
 * NO MOOD-GATED RATING HERE. Sending happy people to the App Store and
 * unhappy ones to a text box is the review gating Apple rejects; the rating
 * sheet has its own moments (platform/rating.ts).
 *
 * In the feed it follows the other cards' contract: its own Modal, the
 * player paused while it is up (and held if the next clip boots under it),
 * resumed on close. In Progress there is no video to touch: `pausePlayer`
 * is false there.
 */
const MOODS = [
  { id: 'meh', emoji: '😕', label: 'Not great' },
  { id: 'ok', emoji: '🙂', label: "It's okay" },
  { id: 'love', emoji: '😍', label: 'Love it' },
] as const;
type Mood = (typeof MOODS)[number]['id'];

const ASK: Record<Mood, string> = {
  meh: "What's not working?",
  ok: 'What would make it better?',
  love: 'What do you like most?',
};

const TEXT_MAX = 500;

export function FeedbackCard({
  kind,
  blocked = false,
  pausePlayer = false,
  onObscurePlayer,
}: {
  /** Which ask this card hosts (feedbackBus.takeFeedback). */
  kind: FeedbackFrom;
  /** Something else owns the screen (another card, the walkthrough, another
      tab): a waiting ask stays waiting until this goes false. */
  blocked?: boolean;
  pausePlayer?: boolean;
  onObscurePlayer?: (obscured: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const api = usePlayerApi();
  const { isPlaying } = usePlayerClock();
  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState<Mood | null>(null);
  const [text, setText] = useState('');
  const [thanks, setThanks] = useState(false);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const tryOpen = useCallback(() => {
    if (blockedRef.current || !takeFeedback(kind)) return;
    setMood(null);
    setText('');
    setThanks(false);
    track('feedback_shown', { from: kind, videos: videosToday() });
    setOpen(true);
  }, [kind]);

  useEffect(() => subscribeToFeedback(tryOpen), [tryOpen]);
  // A waiting ask shows the moment the screen is free.
  useEffect(() => {
    if (!blocked) tryOpen();
  }, [blocked, tryOpen]);

  useEffect(() => {
    if (!pausePlayer) return;
    onObscurePlayer?.(open);
    if (open) api.pause();
    return () => onObscurePlayer?.(false);
  }, [open, pausePlayer, onObscurePlayer, api]);

  const hold = useCallback(() => api.pause(), [api]);
  useAnimatedReaction(
    () => isPlaying.value,
    (playing) => {
      if (playing && open && pausePlayer) runOnJS(hold)();
    },
    [open, pausePlayer, hold]
  );

  if (!open) return null;

  const close = () => {
    setOpen(false);
    if (pausePlayer) api.play();
  };

  const send = (chosen: Mood | 'skipped', note?: string) => {
    const clean = note?.trim().slice(0, TEXT_MAX);
    track('feedback_given', {
      from: kind,
      mood: chosen,
      videos: videosToday(),
      ...(clean ? { text: clean } : {}),
    });
    if (chosen === 'skipped') {
      close();
      return;
    }
    setThanks(true);
    setTimeout(close, 1400);
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => send(mood ?? 'skipped', text)}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.scrim}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={thanks ? undefined : () => send(mood ?? 'skipped', text)}
            accessibilityLabel="Close"
          />
        </Animated.View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.dock}
          pointerEvents="box-none"
        >
          <Animated.View entering={SlideInDown.duration(320)} style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            {thanks ? (
              <Animated.View entering={FadeIn.duration(220)} style={styles.thanks}>
                <Text style={styles.thanksTitle}>¡Gracias!</Text>
                <Text style={styles.body}>Every message is read, and it shapes what Loro becomes.</Text>
              </Animated.View>
            ) : mood === null ? (
              <>
                <Image source={BRAND.parrot} style={styles.art} resizeMode="contain" accessibilityLabel="Loro the parrot" />
                <Text style={styles.title}>How's Loro so far?</Text>
                <Text style={styles.body}>One tap. It helps make Loro better.</Text>
                <View style={styles.moods}>
                  {MOODS.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => setMood(m.id)}
                      accessibilityRole="button"
                      accessibilityLabel={m.label}
                      style={({ pressed }) => [styles.mood, pressed && styles.moodPressed]}
                    >
                      <Text style={styles.moodEmoji}>{m.emoji}</Text>
                      <Text style={styles.moodLabel}>{m.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={() => send('skipped')} hitSlop={8} style={styles.skip} accessibilityRole="button">
                  <Text style={styles.skipText}>Not now</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.picked}>{MOODS.find((m) => m.id === mood)?.emoji}</Text>
                <Text style={styles.title}>{ASK[mood]}</Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder="A bug, a video, an idea…"
                  placeholderTextColor="rgba(242,245,243,0.35)"
                  style={styles.input}
                  multiline
                  maxLength={TEXT_MAX}
                  autoFocus
                />
                <Pressable
                  onPress={() => send(mood, text)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.send, pressed && styles.pressed]}
                >
                  <Text style={styles.sendText}>Send</Text>
                </Pressable>
                <Text style={styles.hint}>Optional. Send works without it.</Text>
              </>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const MINT = '#5ee6a8';
const INK = '#f2f5f3';

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.6)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  dock: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#141a17',
    borderColor: 'rgba(242,245,243,0.08)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  art: { alignSelf: 'center', height: 72, marginBottom: 10, width: 48 },
  title: { color: INK, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { color: 'rgba(242,245,243,0.6)', fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  moods: { flexDirection: 'row', gap: 10, marginTop: 18 },
  mood: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.06)',
    borderColor: 'rgba(242,245,243,0.1)',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 14,
  },
  moodPressed: { backgroundColor: 'rgba(94,230,168,0.14)', borderColor: 'rgba(94,230,168,0.5)' },
  moodEmoji: { fontSize: 34 },
  moodLabel: { color: INK, fontSize: 13, fontWeight: '700', marginTop: 6 },
  picked: { fontSize: 36, marginBottom: 6, textAlign: 'center' },
  input: {
    backgroundColor: 'rgba(242,245,243,0.06)',
    borderColor: 'rgba(242,245,243,0.12)',
    borderRadius: 14,
    borderWidth: 1,
    color: INK,
    fontSize: 15,
    marginTop: 14,
    minHeight: 96,
    paddingHorizontal: 14,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  send: { alignItems: 'center', backgroundColor: MINT, borderRadius: 14, marginTop: 12, paddingVertical: 14 },
  sendText: { color: '#06130d', fontSize: 16, fontWeight: '900' },
  pressed: { opacity: 0.75 },
  hint: { color: 'rgba(242,245,243,0.35)', fontSize: 12, marginTop: 10, textAlign: 'center' },
  skip: { alignItems: 'center', paddingVertical: 12 },
  skipText: { color: 'rgba(242,245,243,0.5)', fontSize: 14, fontWeight: '700' },
  thanks: { alignItems: 'center', paddingBottom: 12, paddingTop: 8 },
  thanksTitle: { color: MINT, fontSize: 22, fontWeight: '900' },
});
