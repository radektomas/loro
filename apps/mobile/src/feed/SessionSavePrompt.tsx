import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { onAuthChange, signInWithMagicLink } from '@loro/core/auth';
import { storage } from '@loro/core/storage';
import {
  isAppleSignInAvailable,
  startAppleSignIn,
  startGoogleSignIn,
} from '../auth/providers';
import {
  snoozeSessionSavePrompt,
  subscribeToSessionSavePrompt,
} from './saveProgressAsk';

/**
 * The session-complete "save your progress" card — the third prompt moment
 * documented in core's savePrompt.ts. Shown after the celebration for the
 * grade that emptied the due queue, raised by RecallHost via
 * maybeAskToSaveProgress(); the timing, snooze and once-per-process rules all
 * live upstream of this component.
 *
 * PRESENTATION IS NotificationPrompt's SHELL (a card over a dimmed backdrop,
 * onObscurePlayer while up — the embed-terms rule: nothing floats over a
 * visible player) with SavePromptCard's SIGN-IN INTERIOR (Google, Apple where
 * available, magic link; providers.ts owns the flows and the cancelled flag —
 * an abandoned Apple sheet is normal, never an error banner).
 *
 * "Not now" writes only the device snooze — equal visual weight, genuinely
 * free, and the vocab card's two-ask budget is untouched. Sign-in completing
 * (any route, including a magic link handled by the global deep-link
 * listener) retires the card via onAuthChange; the sync engine marks the
 * pending prompt converted, never this UI.
 */

const COPY = {
  cs: {
    title: 'Hotovo — všechna slovíčka zopakována!',
    body: 'Tvůj postup zatím žije jen v tomhle telefonu. S účtem přežije nové zařízení i promazání dat.',
    google: 'Pokračovat přes Google',
    apple: 'Pokračovat přes Apple',
    emailPlaceholder: 'tvůj e-mail',
    sendLink: 'Poslat přihlašovací odkaz',
    sending: 'Odesílám…',
    sent: 'Hotovo — koukni do e-mailu. Odkaz otevři v tomhle telefonu.',
    later: 'Teď ne',
    error: 'Něco se nepovedlo.',
  },
  en: {
    title: 'Session done — every word reviewed!',
    body: "Your progress lives only on this phone for now. With an account it survives a new phone — and isn't lost if the app's data is cleared.",
    google: 'Continue with Google',
    apple: 'Continue with Apple',
    emailPlaceholder: 'your email',
    sendLink: 'Email me a sign-in link',
    sending: 'Sending…',
    sent: 'Done — check your email. Open the link on this phone.',
    later: 'Not now',
    error: 'Something went wrong.',
  },
} as const;

export function SessionSavePrompt({
  onObscurePlayer,
}: {
  /** Raised while the card is up, so the WebView fades and the slide's poster
      carries the frame underneath — same contract as NotificationPrompt. */
  onObscurePlayer: (obscured: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const t = COPY[storage.getLanguage() === 'cs' ? 'cs' : 'en'];

  useEffect(() => subscribeToSessionSavePrompt(() => setOpen(true)), []);

  // Sign-in completing — here, or via a magic link handled by the global
  // deep-link listener — retires the card.
  useEffect(
    () =>
      onAuthChange((session) => {
        if (session) setOpen(false);
      }),
    []
  );

  useEffect(() => {
    let live = true;
    void isAppleSignInAvailable().then((ok) => {
      if (live) setAppleAvailable(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    onObscurePlayer(open);
    // Lower it on unmount too — a tab switch must not leave the player hidden.
    return () => onObscurePlayer(false);
  }, [open, onObscurePlayer]);

  const handleMagicLink = useCallback(async () => {
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    const res = await signInWithMagicLink(email);
    setSending(false);
    if (res.ok) setSent(true);
    else setError(res.error ?? t.error);
  }, [email, sending, t]);

  const handleProvider = useCallback(
    async (which: 'google' | 'apple') => {
      if (busy) return;
      setBusy(which);
      setError(null);
      const res =
        which === 'google' ? await startGoogleSignIn() : await startAppleSignIn();
      setBusy(null);
      if (!res.ok && !res.cancelled) setError(res.error ?? t.error);
    },
    [busy, t]
  );

  if (!open) return null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.title}>{t.title}</Text>
        <Text style={styles.body}>{sent ? t.sent : t.body}</Text>

        {!sent && (
          <>
            <Pressable
              onPress={() => void handleProvider('google')}
              disabled={busy !== null}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.provider,
                pressed && styles.pressed,
                busy !== null && styles.disabled,
              ]}
            >
              {busy === 'google' ? (
                <ActivityIndicator color="#f2f5f3" size="small" />
              ) : (
                <Text style={styles.providerText}>{t.google}</Text>
              )}
            </Pressable>

            {appleAvailable && (
              <Pressable
                onPress={() => void handleProvider('apple')}
                disabled={busy !== null}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.provider,
                  pressed && styles.pressed,
                  busy !== null && styles.disabled,
                ]}
              >
                {busy === 'apple' ? (
                  <ActivityIndicator color="#f2f5f3" size="small" />
                ) : (
                  <Text style={styles.providerText}>{t.apple}</Text>
                )}
              </Pressable>
            )}

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t.emailPlaceholder}
              placeholderTextColor="rgba(242,245,243,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel={t.emailPlaceholder}
              style={styles.input}
              onSubmitEditing={() => void handleMagicLink()}
              returnKeyType="go"
            />
            <Pressable
              onPress={() => void handleMagicLink()}
              disabled={sending || !email.trim()}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.cta,
                pressed && styles.pressed,
                (sending || !email.trim()) && styles.disabled,
              ]}
            >
              <Text style={styles.ctaText}>{sending ? t.sending : t.sendLink}</Text>
            </Pressable>

            {error && <Text style={styles.error}>{error}</Text>}
          </>
        )}

        {/* EQUAL WEIGHT, not a buried link — dismissing is genuinely free.
            Writes only the 7-day device snooze; no prompt record is burned. */}
        <Pressable
          onPress={() => {
            snoozeSessionSavePrompt();
            setOpen(false);
          }}
          accessibilityRole="button"
          accessibilityLabel={t.later}
          style={({ pressed }) => [styles.later, pressed && styles.pressed]}
        >
          <Text style={styles.laterText}>{t.later}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** NotificationPrompt's backdrop verbatim: fills the feed area above the
      tab bar, opaque enough to read against a moving video. */
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
    marginBottom: 14,
    marginTop: 10,
    textAlign: 'center',
  },
  provider: {
    alignItems: 'center',
    backgroundColor: '#1e2622',
    borderRadius: 14,
    marginBottom: 8,
    minHeight: 46,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  providerText: { color: '#f2f5f3', fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: '#1e2622',
    borderRadius: 14,
    color: '#f2f5f3',
    fontSize: 14,
    marginBottom: 8,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cta: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 14,
    paddingVertical: 12,
  },
  ctaText: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  later: { alignItems: 'center', marginTop: 4, paddingVertical: 12 },
  laterText: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 14,
    fontWeight: '600',
  },
  error: { color: '#f87171', fontSize: 12, lineHeight: 17, marginTop: 10 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
