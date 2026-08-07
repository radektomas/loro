import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { signInWithMagicLink, signOut } from '@loro/core/auth';
import { authEnabled } from '../platform/supabaseInit';
import {
  isAppleSignInAvailable,
  startAppleSignIn,
  startGoogleSignIn,
} from './providers';
import { useSession } from './useSession';

/**
 * The one place mobile invites sign-in — the port of components/SignInCard.tsx.
 *
 * IT IS NEVER A GATE, and that framing is the product decision the web's card
 * documents: anonymous users get a soft "back up & sync" offer, signed-in users
 * get a quiet status row, and everything in the app works either way. Renders
 * nothing at all when Supabase is unconfigured.
 *
 * WHY IT LIVES ON PROGRESS. Signing in is pitched as protecting progress, so
 * the progress screen is where the promise pays off — the same reasoning core's
 * DEFAULT_AUTH_DESTINATION ('/progress') encodes for the web. Mobile has no
 * Profile screen and inventing one to mirror the web's second mount point would
 * be adding a tab to hold a single card.
 */

const GOOGLE_LABEL = 'Continue with Google';
const APPLE_LABEL = 'Continue with Apple';

function Divider() {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>OR</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

/** Apple's mark, drawn as text. The real button component ships in
    expo-apple-authentication, but it brings its own fixed styling that would
    sit oddly beside the other two rows; guideline 4.8 requires the option, not
    a specific control. */
function ProviderButton({
  label,
  glyph,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.provider,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#f2f5f3" size="small" />
      ) : (
        <>
          <Text style={styles.providerGlyph}>{glyph}</Text>
          <Text style={styles.providerText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function SignInCard() {
  const { session, ready } = useSession();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  /**
   * Resolved once, asynchronously, and defaults to hidden. A button that
   * appears a beat late is a non-event; one that appears and then fails
   * because the native module is missing is not.
   */
  useEffect(() => {
    let live = true;
    void isAppleSignInAvailable().then((ok) => {
      if (live) setAppleAvailable(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  const handleMagicLink = useCallback(async () => {
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    const res = await signInWithMagicLink(email);
    setSending(false);
    if (res.ok) setSent(true);
    else setError(res.error ?? 'Something went wrong.');
  }, [email, sending]);

  const handleProvider = useCallback(
    async (which: 'google' | 'apple') => {
      if (busy) return;
      setBusy(which);
      setError(null);
      const res =
        which === 'google' ? await startGoogleSignIn() : await startAppleSignIn();
      setBusy(null);
      // Backing out of the system sheet is a normal action, not a failure —
      // showing an error banner for it would be scolding the user for
      // changing their mind.
      if (!res.ok && !res.cancelled) {
        setError(res.error ?? 'Something went wrong.');
      }
    },
    [busy]
  );

  if (!authEnabled || !ready) return null;

  // --- Signed in: quiet status, and a way out.
  if (session) {
    return (
      <View style={[styles.card, styles.statusRow]}>
        <View style={styles.tick}>
          <Text style={styles.tickText}>✓</Text>
        </View>
        <View style={styles.statusBody}>
          <Text style={styles.statusTitle}>Synced</Text>
          <Text style={styles.statusSub} numberOfLines={1}>
            {session.user.email ?? 'Backed up across your devices'}
          </Text>
        </View>
        <Pressable
          onPress={() => void signOut()}
          accessibilityRole="button"
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  // --- Link sent: the terminal state of the magic-link flow.
  if (sent) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          We sent a sign-in link to {email.trim()}.
          {'\n'}
          {/* NOT a nicety — the client uses PKCE, so the code verifier lives
              in THIS device's storage and only this device can complete the
              exchange. Opening the link on a laptop fails in a way that reads
              as a broken link, so the copy has to pre-empt it. */}
          <Text style={styles.bodyStrong}>Open it on this phone</Text> — a link
          opened on another device can&apos;t finish signing you in.
        </Text>
      </View>
    );
  }

  // --- Anonymous, collapsed: a soft offer.
  if (!open) {
    return (
      <View style={[styles.card, styles.statusRow]}>
        <View style={styles.statusBody}>
          <Text style={styles.statusTitle}>Back up &amp; sync</Text>
          <Text style={styles.statusSub}>
            Keep your words if you switch phones. Optional.
          </Text>
        </View>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.smallCta, pressed && styles.pressed]}
        >
          <Text style={styles.smallCtaText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  // --- Anonymous, expanded: the three methods.
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>Back up &amp; sync across devices</Text>
        <Pressable
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <ProviderButton
        label={GOOGLE_LABEL}
        glyph="G"
        busy={busy === 'google'}
        disabled={busy !== null}
        onPress={() => void handleProvider('google')}
      />

      {appleAvailable && (
        <ProviderButton
          label={APPLE_LABEL}
          glyph=""
          busy={busy === 'apple'}
          disabled={busy !== null}
          onPress={() => void handleProvider('apple')}
        />
      )}

      <Divider />

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@email.com"
        placeholderTextColor="rgba(242,245,243,0.35)"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        accessibilityLabel="Email for a sign-in link"
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
        <Text style={styles.ctaText}>
          {sending ? 'Sending…' : 'Email me a link'}
        </Text>
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#141a17', borderRadius: 18, padding: 16 },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  statusBody: { flex: 1, gap: 2, minWidth: 0 },
  statusTitle: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  statusSub: { color: 'rgba(242,245,243,0.55)', fontSize: 12, lineHeight: 17 },
  tick: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  tickText: { color: '#5ee6a8', fontSize: 16, fontWeight: '800' },
  signOut: { color: 'rgba(242,245,243,0.55)', fontSize: 12, fontWeight: '600' },

  headRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { color: '#f2f5f3', flex: 1, fontSize: 15, fontWeight: '700' },
  close: { color: 'rgba(242,245,243,0.55)', fontSize: 15, paddingLeft: 12 },
  body: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  bodyStrong: { color: '#f2f5f3', fontWeight: '700' },

  provider: {
    alignItems: 'center',
    backgroundColor: '#1e2622',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 8,
    minHeight: 46,
    paddingVertical: 12,
  },
  providerGlyph: { color: '#f2f5f3', fontSize: 15, fontWeight: '800' },
  providerText: { color: '#f2f5f3', fontSize: 14, fontWeight: '700' },

  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginVertical: 10,
  },
  dividerLine: {
    backgroundColor: 'rgba(242,245,243,0.1)',
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: 'rgba(242,245,243,0.4)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },

  input: {
    backgroundColor: '#1e2622',
    borderRadius: 14,
    color: '#f2f5f3',
    fontSize: 14,
    marginBottom: 8,
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
  smallCta: {
    backgroundColor: '#5ee6a8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  smallCtaText: { color: '#06130d', fontSize: 13, fontWeight: '800' },

  error: { color: '#f87171', fontSize: 12, lineHeight: 17, marginTop: 10 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
