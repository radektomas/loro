import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { storageDriver } from '../platform/storage';
import { track } from '../platform/analytics';

/**
 * "WHAT'S HOLDING YOU BACK?" (Radek, 2026-10-08: "if somebody doesn't want to
 * pay, we put feedback there to tell us what we can do better").
 *
 * Asked at the one moment the answer is real: right after someone tapped
 * the button and closed Apple's sheet. They wanted it enough to tap; the
 * reason they backed out is the thing analytics cannot see (the trails only
 * say "cancelled"). Once per device, skippable, one tap to answer.
 */
const KEY = 'loro.mobile.paywallFeedbackAsked';
const TEXT_MAX = 280;

const REASONS = [
  { id: 'price', label: 'Too expensive' },
  { id: 'no_subscription', label: "I don't want a subscription" },
  { id: 'not_sure', label: 'Not sure it works for me yet' },
  { id: 'try_more', label: 'I want to try more first' },
  { id: 'other', label: 'Something else…' },
] as const;

export function paywallFeedbackDue(): boolean {
  try {
    return storageDriver.local.getItem(KEY) === null;
  } catch {
    return false;
  }
}

export function markPaywallFeedbackAsked(): void {
  try {
    storageDriver.local.setItem(KEY, '1');
  } catch {}
}

export function PaywallFeedback({ packageId, onClose }: { packageId: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [thanks, setThanks] = useState(false);

  const send = (reason: string, note?: string) => {
    track('paywall_feedback', {
      reason,
      packageId,
      ...(note ? { text: note.slice(0, TEXT_MAX) } : {}),
    });
    setThanks(true);
    setTimeout(onClose, 1300);
  };
  const skip = () => {
    track('paywall_feedback', { reason: 'skipped', packageId });
    onClose();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={thanks ? undefined : skip} accessibilityLabel="Skip" />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.dock} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.duration(320)}
          exiting={SlideOutDown.duration(240)}
          style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
        >
          {thanks ? (
            <Animated.View entering={FadeIn.duration(220)} style={styles.thanks}>
              <Text style={styles.thanksTitle}>Thanks, this really helps</Text>
              <Text style={styles.body}>Every answer is read, and it shapes what Loro becomes.</Text>
            </Animated.View>
          ) : writing ? (
            <>
              <Text style={styles.title}>What would make Loro worth it?</Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Tell us in a sentence"
                placeholderTextColor="rgba(242,245,243,0.35)"
                style={styles.input}
                multiline
                maxLength={TEXT_MAX}
                autoFocus
              />
              <Pressable
                onPress={() => send('other', text.trim())}
                disabled={!text.trim()}
                accessibilityRole="button"
                style={({ pressed }) => [styles.send, !text.trim() && styles.sendOff, pressed && styles.pressed]}
              >
                <Text style={styles.sendText}>Send</Text>
              </Pressable>
              <Pressable onPress={skip} hitSlop={8} style={styles.skip} accessibilityRole="button">
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>What's holding you back?</Text>
              <Text style={styles.body}>One tap. It helps us make Loro better.</Text>
              <View style={styles.options}>
                {REASONS.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => (r.id === 'other' ? setWriting(true) : send(r.id))}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                  >
                    <Text style={styles.optionText}>{r.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={skip} hitSlop={8} style={styles.skip} accessibilityRole="button">
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
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
  title: { color: '#f2f5f3', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { color: 'rgba(242,245,243,0.6)', fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  options: { gap: 8, marginTop: 16 },
  option: {
    backgroundColor: 'rgba(242,245,243,0.06)',
    borderColor: 'rgba(242,245,243,0.1)',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionPressed: { backgroundColor: 'rgba(94,230,168,0.14)', borderColor: 'rgba(94,230,168,0.5)' },
  optionText: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  input: {
    backgroundColor: 'rgba(242,245,243,0.06)',
    borderColor: 'rgba(242,245,243,0.12)',
    borderRadius: 14,
    borderWidth: 1,
    color: '#f2f5f3',
    fontSize: 15,
    marginTop: 14,
    minHeight: 90,
    paddingHorizontal: 14,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  send: { alignItems: 'center', backgroundColor: '#5ee6a8', borderRadius: 14, marginTop: 12, paddingVertical: 14 },
  sendOff: { opacity: 0.4 },
  sendText: { color: '#06130d', fontSize: 16, fontWeight: '900' },
  pressed: { opacity: 0.75 },
  skip: { alignItems: 'center', paddingVertical: 12 },
  skipText: { color: 'rgba(242,245,243,0.5)', fontSize: 14, fontWeight: '700' },
  thanks: { alignItems: 'center', paddingBottom: 12, paddingTop: 8 },
  thanksTitle: { color: '#5ee6a8', fontSize: 19, fontWeight: '800' },
});
