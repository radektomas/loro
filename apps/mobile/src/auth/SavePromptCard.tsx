import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getSession, onAuthChange, signInWithMagicLink } from '@loro/core/auth';
import { storage } from '@loro/core/storage';
import { savePromptVariant } from '@loro/core/savePrompt';
import { authEnabled } from '../platform/supabaseInit';
import {
  isAppleSignInAvailable,
  startAppleSignIn,
  startGoogleSignIn,
} from './providers';

/**
 * The one account nudge Loro ever shows — port of components/SavePromptSheet.
 *
 * "Save the progress you already have", never a signup gate. The RULES ARE NOT
 * REIMPLEMENTED: savePromptVariant in core decides, so web and mobile ask at
 * exactly the same moments and a threshold change lands on both.
 *
 * MOUNTED ONLY BY THE VOCAB SCREEN. The feed is the product and is never
 * interrupted — core encodes the same rule defensively (surface !== 'vocab'
 * returns null), so even a mistaken mount elsewhere decides "show nothing".
 * That belt-and-braces is why this is passed 'vocab' explicitly rather than
 * inferred.
 *
 * CONVERSION IS NOT RECORDED HERE. A pending prompt is marked converted by the
 * sync engine when the session actually arrives (storage.ts syncSavePrompt),
 * because the magic link may complete minutes later; recording optimistically
 * on button press would count everyone who opened Google and changed their
 * mind.
 *
 * Rendered as a card rather than a modal sheet: it sits at the top of the word
 * list, so it is impossible to miss and equally impossible to be trapped by.
 */

const COPY = {
  cs: {
    title1: (n: number) =>
      `Máš uložených ${n} slovíček. Ulož si je, ať o ně nepřijdeš.`,
    title2: (n: number) =>
      `Už máš ${n} slovíček. Poslední připomínka — pak se už nezeptáme.`,
    body: 'S účtem tvoje slovíčka a postup přežijí i nové zařízení — a neztratí se, když se data v telefonu promažou.',
    google: 'Pokračovat přes Google',
    apple: 'Pokračovat přes Apple',
    emailPlaceholder: 'tvůj e-mail',
    sendLink: 'Poslat přihlašovací odkaz',
    sending: 'Odesílám…',
    sent: 'Hotovo — koukni do e-mailu. Odkaz otevři v tomhle telefonu.',
    skip: 'Pokračovat bez účtu',
    error: 'Něco se nepovedlo.',
  },
  en: {
    title1: (n: number) => `You have ${n} saved words. Keep them safe.`,
    title2: (n: number) =>
      `${n} words saved. Last reminder — we won't ask again.`,
    body: "With an account your words and progress survive a new phone — and aren't lost if the app's data is cleared.",
    google: 'Continue with Google',
    apple: 'Continue with Apple',
    emailPlaceholder: 'your email',
    sendLink: 'Email me a sign-in link',
    sending: 'Sending…',
    sent: 'Done — check your email. Open the link on this phone.',
    skip: 'Continue without an account',
    error: 'Something went wrong.',
  },
} as const;

export function SavePromptCard() {
  const [variant, setVariant] = useState<1 | 2 | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  // The catalog carries cs/de/en/fr glosses but the UI is English; Czech is
  // the one localized copy set (de/fr fall back to English, as elsewhere).
  const t = COPY[storage.getLanguage() === 'cs' ? 'cs' : 'en'];

  useEffect(() => {
    if (!authEnabled) return;
    let cancelled = false;
    void getSession().then((session) => {
      if (cancelled) return;
      // GRANTED words don't count. The starter deck hands out 9 and the first
      // prompt fires at 10, so counting them would trip the ask on a
      // beginner's first real save. Same counter as the free-tier ceiling, so
      // the two gates can never drift apart.
      const savedCount = storage.getCountedSavedWords();
      const v = savePromptVariant(storage.getSavePromptState(), {
        signedIn: session !== null,
        savedCount,
        surface: 'vocab',
      });
      if (v) {
        storage.recordSavePromptShown(v, savedCount);
        setWordCount(savedCount);
        setVariant(v);
      }
    });
    // Sign-in completing — here, or via a magic link handled by the global
    // deep-link listener — retires the card. The sync engine marks the
    // pending prompt converted.
    const off = onAuthChange((session) => {
      if (session) setVariant(null);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    let live = true;
    void isAppleSignInAvailable().then((ok) => {
      if (live) setAppleAvailable(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (variant === null) return;
    storage.recordSavePromptOutcome(variant, 'dismissed');
    setVariant(null);
  }, [variant]);

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

  if (variant === null) return null;

  if (sent) {
    return (
      <View style={styles.card}>
        <Text style={styles.body}>{t.sent}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {variant === 1 ? t.title1(wordCount) : t.title2(wordCount)}
      </Text>
      <Text style={styles.body}>{t.body}</Text>

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

      {/* EQUAL WEIGHT, not a buried link. A hidden skip juices signups
          short-term and wrecks retention; dismissing is genuinely free. */}
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
      >
        <Text style={styles.skipText}>{t.skip}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#141a17',
    borderColor: 'rgba(94,230,168,0.2)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 18,
    padding: 16,
  },
  title: { color: '#f2f5f3', fontSize: 15, fontWeight: '700', lineHeight: 21 },
  body: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
    marginTop: 6,
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
  skip: { alignItems: 'center', marginTop: 4, paddingVertical: 12 },
  skipText: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 13,
    fontWeight: '600',
  },
  error: { color: '#f87171', fontSize: 12, lineHeight: 17, marginTop: 10 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
