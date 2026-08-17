import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiUrl } from '@loro/core/platform';
import { getSession, signOut } from '@loro/core/auth';
import { storageDriver } from '../platform/storage';
import { requestAppReset } from '../platform/appReset';
import { useSession } from './useSession';

/**
 * The destructive zone — GDPR erasure and App Store guideline 5.1.1(v), which
 * requires any app that creates accounts to let the user delete one from
 * INSIDE the app. Ported from the web's components/DeleteAccountCard.tsx and
 * kept deliberately close to it: same enumeration, same type-your-email
 * confirmation, same handling of the shared sign-in.
 *
 * Renders only for a signed-in user, directly under SignInCard in both places
 * that card mounts: Progress, where the app keeps its account UI, and the
 * hard paywall's account sheet — a lapsed subscriber must still be able to
 * delete their account, and the wall is the only screen they can reach.
 *
 * IDENTITY IS THE BEARER TOKEN, NEVER A BODY. The route reads the user id from
 * the verified JWT and never parses a body (app/api/account/delete/route.ts),
 * so there is nothing here to smuggle a foreign user id into.
 */

type Phase = 'idle' | 'confirming' | 'deleting' | 'kept';

/**
 * Everything Loro, plus the Supabase session, out of device storage.
 *
 * Swept by PREFIX rather than a hand-kept key list, matching the web card's
 * reasoning: every Loro key starts 'loro.' or 'loro:' and Supabase's own keys
 * start 'sb-', so a key added later is covered the day it ships. The catalog
 * deliberately lives outside the 'loro.' namespace (platform/catalog.ts), so
 * this costs no re-download — a deleted account still has an app to open.
 */
function wipeLocalState(): void {
  for (const prefix of ['loro.', 'loro:', 'sb-']) {
    storageDriver.clearByPrefix(prefix);
  }
}

export function DeleteAccountCard() {
  const { session, ready } = useSession();
  const [phase, setPhase] = useState<Phase>('idle');
  const [typedEmail, setTypedEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Double-submit guard that does not wait on a state flush.
  const inFlight = useRef(false);

  const email = session?.user.email ?? '';
  const emailMatches =
    typedEmail.trim().toLowerCase() === email.trim().toLowerCase();

  const close = useCallback(() => {
    if (phase === 'deleting') return; // no backing out mid-flight
    setPhase('idle');
    setTypedEmail('');
    setError(null);
  }, [phase]);

  /**
   * Sign out, wipe, remount. Used by both exits — a full delete and the
   * shared-sign-in case — because the local half is identical either way.
   */
  const finish = useCallback(async () => {
    await signOut();
    wipeLocalState();
    requestAppReset();
  }, []);

  const handleDelete = useCallback(async () => {
    if (!emailMatches || inFlight.current) return;
    inFlight.current = true;
    setPhase('deleting');
    setError(null);
    try {
      const current = await getSession();
      const token = current?.access_token;
      if (!token) throw new Error('no session');

      const res = await fetch(apiUrl('/api/account/delete'), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as {
        authDeleted?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? 'Deletion failed.');
        setPhase('confirming');
        return;
      }

      // Loro's data is gone either way. authDeleted: false means the
      // cross-product guard found this sign-in in use by another product on
      // the shared Supabase project — say so rather than claiming a full
      // erasure that did not happen.
      if (body.authDeleted === false) {
        setPhase('kept');
        return;
      }
      await finish();
    } catch {
      setError('Deletion failed.');
      setPhase('confirming');
    } finally {
      inFlight.current = false;
    }
  }, [emailMatches, finish]);

  if (!ready || !session) return null;

  // --- Terminal: Loro data deleted, shared sign-in intentionally kept.
  if (phase === 'kept') {
    return (
      <View style={styles.card}>
        <Text style={styles.keptTitle}>Your Loro data is deleted</Text>
        <Text style={styles.body}>
          Your learning progress, saved words and profile are gone. Your
          sign-in is shared with other services and is removed separately —
          nothing about your Loro use remains attached to it.
        </Text>
        <Pressable
          onPress={() => void finish()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  // --- Collapsed: one quiet way in.
  if (phase === 'idle') {
    return (
      <View style={styles.zone}>
        <Text style={styles.zoneTitle}>Danger zone</Text>
        <Text style={styles.zoneBody}>
          Permanently delete your account and everything Loro stores about you.
          This cannot be undone.
        </Text>
        <Pressable
          onPress={() => setPhase('confirming')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.dangerGhost, pressed && styles.pressed]}
        >
          <Text style={styles.dangerGhostText}>Delete account…</Text>
        </Pressable>
      </View>
    );
  }

  // --- Confirming / deleting.
  const busy = phase === 'deleting';
  return (
    <View style={styles.zone}>
      <Text style={styles.zoneTitle}>Delete account?</Text>
      <Text style={styles.zoneBody}>This permanently deletes:</Text>
      <View style={styles.list}>
        <Text style={styles.listItem}>• your learning progress and streaks</Text>
        <Text style={styles.listItem}>• your saved words and review history</Text>
        <Text style={styles.listItem}>• your profile and any uploads</Text>
        <Text style={styles.listItem}>• your follows and account details</Text>
      </View>
      <Text style={styles.irreversible}>This cannot be undone.</Text>

      <Text style={styles.label}>
        Type <Text style={styles.labelStrong}>{email}</Text> to confirm
      </Text>
      <TextInput
        value={typedEmail}
        onChangeText={setTypedEmail}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder={email}
        placeholderTextColor="rgba(242,245,243,0.3)"
        style={styles.input}
        accessibilityLabel="Type your email to confirm deletion"
      />

      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Pressable
        onPress={() => void handleDelete()}
        disabled={!emailMatches || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !emailMatches || busy }}
        style={({ pressed }) => [
          styles.dangerSolid,
          (!emailMatches || busy) && styles.dangerDisabled,
          pressed && styles.pressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.dangerSolidText}>Delete my account</Text>
        )}
      </Pressable>
      <Pressable
        onPress={close}
        disabled={busy}
        accessibilityRole="button"
        style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const DANGER = '#ff6b5e';

const styles = StyleSheet.create({
  card: { backgroundColor: '#141a17', borderRadius: 18, padding: 16 },
  zone: {
    backgroundColor: 'rgba(255,107,94,0.05)',
    borderColor: 'rgba(255,107,94,0.25)',
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  zoneTitle: { color: DANGER, fontSize: 14, fontWeight: '700' },
  zoneBody: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  list: { gap: 4, marginTop: 8 },
  listItem: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 12,
    lineHeight: 18,
  },
  irreversible: {
    color: DANGER,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
  },
  label: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 12,
    marginTop: 14,
  },
  labelStrong: { color: '#f2f5f3', fontWeight: '700' },
  input: {
    backgroundColor: '#0f1411',
    borderColor: 'rgba(242,245,243,0.15)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#f2f5f3',
    fontSize: 14,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: { color: DANGER, fontSize: 12, marginTop: 8 },
  dangerGhost: {
    alignItems: 'center',
    borderColor: 'rgba(255,107,94,0.4)',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 10,
  },
  dangerGhostText: { color: DANGER, fontSize: 12, fontWeight: '700' },
  dangerSolid: {
    alignItems: 'center',
    backgroundColor: DANGER,
    borderRadius: 999,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 46,
    paddingVertical: 12,
  },
  dangerDisabled: { opacity: 0.4 },
  dangerSolidText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  cancel: { alignItems: 'center', marginTop: 8, paddingVertical: 12 },
  cancelText: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 13,
    fontWeight: '600',
  },
  keptTitle: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  body: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  doneButton: {
    alignItems: 'center',
    backgroundColor: '#1e2622',
    borderRadius: 999,
    marginTop: 14,
    paddingVertical: 12,
  },
  doneText: { color: '#f2f5f3', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
