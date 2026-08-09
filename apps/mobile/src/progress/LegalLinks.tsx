import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { API_BASE_URL } from '../platform/config';

/**
 * Privacy policy and terms, linked from the bottom of Progress.
 *
 * App Store review expects a privacy policy reachable from inside an app that
 * holds accounts (it is a required field in App Store Connect either way), and
 * docs/rn-port-map.md flagged these two web pages as "App Store wants URLs;
 * link out to the web pages" — this is that. Shown to everyone, signed in or
 * not: the policy governs anonymous use too.
 *
 * OPENED IN-APP, not handed to Safari. The opposite of AuthorLine, which uses
 * Linking.openURL precisely BECAUSE a YouTube channel link should leave for
 * the real YouTube app. Legal pages are ours and the reader should come back,
 * so they get the in-app browser — and expo-web-browser is already a
 * dependency for the auth session, so this costs no new module.
 */

/**
 * The web deployment's origin, which is also where the legal pages live.
 *
 * Falls back to the canonical host rather than rendering a broken link: an
 * unset EXPO_PUBLIC_API_ORIGIN is a supported resting state everywhere else
 * in the app (config.ts), but a compliance link that silently goes nowhere is
 * not. The www host is deliberate — the apex 308-redirects to it.
 */
const WEB_ORIGIN = API_BASE_URL || 'https://www.getloro.app';

const LINKS: readonly { label: string; path: string }[] = [
  { label: 'Privacy', path: '/privacy' },
  { label: 'Terms', path: '/terms' },
];

export function LegalLinks() {
  return (
    <View style={styles.row}>
      {LINKS.map((link, i) => (
        <View key={link.path} style={styles.item}>
          {i > 0 && <Text style={styles.separator}>·</Text>}
          <Pressable
            onPress={() => {
              void WebBrowser.openBrowserAsync(`${WEB_ORIGIN}${link.path}`);
            }}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            hitSlop={8}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Text style={styles.link}>{link.label}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  item: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  separator: { color: 'rgba(242,245,243,0.25)', fontSize: 12 },
  link: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 12,
    fontWeight: '600',
  },
  pressed: { opacity: 0.6 },
});
