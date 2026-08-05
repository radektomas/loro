import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { BOX_INTERVALS_MS, MAX_BOX, normalizeAnswer } from '@loro/core/srs';

/**
 * CHECKPOINT A — does the phone import @loro/core?
 *
 * The only job of this screen is to prove the workspace wiring end to end
 * before any real screen exists: that Metro follows the `file:` symlink out of
 * this project, resolves core's "./*": "./src/*.ts" exports pattern, transforms
 * core's raw TypeScript, and honours its extension-ed internal imports.
 *
 * It imports from @loro/core/srs SPECIFICALLY, and nothing else. srs.ts has one
 * import, it is type-only, and it reaches no JSON and no third-party package —
 * so if this screen renders, the failure surface is exactly the four mechanisms
 * above and nothing more.
 *
 * @loro/core/catalog and @loro/core/storage are deliberately NOT imported here.
 * Those pull data/videos.json from outside the package, which needs Metro's
 * watchFolders and possibly the import-attributes babel plugin. That is
 * checkpoint B, kept separate so a failure says WHICH mechanism broke instead
 * of just "it doesn't build".
 */

/** The real accent-folding used to grade every typed recall answer. */
const SAMPLES = ['¡Están!', 'Qué', 'niño', 'ACUERDO'] as const;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export default function App() {
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <Text style={styles.title}>@loro/core is on the phone</Text>
      <Text style={styles.subtitle}>checkpoint A — srs.ts, imported from packages/core</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>normalizeAnswer()</Text>
        {SAMPLES.map((sample) => (
          <Row key={sample} label={sample} value={normalizeAnswer(sample)} />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Leitner schedule</Text>
        <Row label="boxes" value={String(BOX_INTERVALS_MS.length)} />
        <Row label="MAX_BOX" value={String(MAX_BOX)} />
        <Row
          label="box 1 → box 6"
          value={`${BOX_INTERVALS_MS[1] / 60_000}min → ${
            BOX_INTERVALS_MS[MAX_BOX] / 86_400_000
          }d`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0a0d0b',
    paddingHorizontal: 24,
    paddingTop: 96,
    gap: 16,
  },
  title: {
    color: '#f2f5f3',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#7d8a83',
    fontSize: 13,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#141a16',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  cardTitle: {
    color: '#7d8a83',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: '#f2f5f3',
    fontSize: 16,
  },
  value: {
    color: '#5ee6a8',
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
