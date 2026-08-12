import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND } from '../onboarding/brand';
import {
  requestPermission,
  snoozePermissionAsk,
  subscribeToPermissionPrompt,
} from '../platform/notifications';

/**
 * THE IN-APP EXPLAINER, and the only thing in the app that leads to the iOS
 * permission prompt.
 *
 * WHY IT EXISTS AT ALL, since it is one more tap than just asking. iOS gives an
 * app exactly one system prompt per install: once denied, every later
 * requestPermissionsAsync resolves denied without showing anything, and the
 * only way back is the user finding Settings on their own. So the system prompt
 * is a single non-renewable resource, and this sheet is what stops it being
 * spent on someone with no idea what they are being asked for.
 *
 * WHEN IT APPEARS: after the celebration for the user's FIRST correct answer,
 * raised by RecallHost. Never on launch, never during onboarding. By that point
 * the user has felt the thing the notification is about, which is the whole
 * argument for the ordering.
 *
 * "Not now" NEVER CALLS THROUGH. It records a snooze and closes, so the system
 * prompt is still unspent a week later.
 *
 * IT HIDES THE PLAYER WHILE IT IS UP, via onObscurePlayer. Everything Loro
 * draws stays below the player or the player yields; that is the embed-terms
 * rule the whole feed layout exists to satisfy, and a card floating over the
 * frame would break it. Same contract RecallBar already uses for the keyboard.
 */
export function NotificationPrompt({
  onObscurePlayer,
}: {
  /** Raised while the card is up, so the WebView fades and the slide's poster
      carries the frame underneath. */
  onObscurePlayer: (obscured: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeToPermissionPrompt(() => setOpen(true)), []);

  useEffect(() => {
    onObscurePlayer(open);
    // Lower it on unmount too: a tab switch or a reset must not leave the
    // player permanently hidden behind a card that is no longer there.
    return () => onObscurePlayer(false);
  }, [open, onObscurePlayer]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setBusy(false);
  };

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Image
          source={BRAND.parrot}
          style={styles.art}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Loro the parrot"
        />
        <Text style={styles.title}>Get a nudge when your words are ready</Text>
        <Text style={styles.body}>
          One short reminder a day, at a time you pick. No spam, and you can turn
          it off in Progress whenever you like.
        </Text>

        <Pressable
          disabled={busy}
          onPress={() => {
            // Synchronously inside the handler, and only on this branch. This
            // is the one call that spends the system prompt.
            setBusy(true);
            void requestPermission().then(close, close);
          }}
          accessibilityRole="button"
          accessibilityLabel="Allow notifications"
          style={({ pressed }) => [
            styles.allow,
            (pressed || busy) && styles.pressed,
          ]}
        >
          <Text style={styles.allowText}>Allow</Text>
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={() => {
            snoozePermissionAsk();
            close();
          }}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          style={({ pressed }) => [styles.later, pressed && styles.pressed]}
        >
          <Text style={styles.laterText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Fills the feed area above the tab bar. Opaque enough to read the card
      against a moving video, not so opaque that the slide disappears. */
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
    borderRadius: 20,
    padding: 22,
    width: '100%',
  },
  art: { alignSelf: 'center', height: 96, marginBottom: 14, width: 64 },
  title: {
    color: '#f2f5f3',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 26,
    textAlign: 'center',
  },
  body: {
    color: 'rgba(242,245,243,0.66)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    textAlign: 'center',
  },
  allow: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 14,
    marginTop: 20,
    paddingVertical: 13,
  },
  allowText: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  later: { alignItems: 'center', marginTop: 4, paddingVertical: 12 },
  laterText: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: { opacity: 0.7 },
});
