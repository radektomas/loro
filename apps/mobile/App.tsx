import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BOX_INTERVALS_MS, MAX_BOX, normalizeAnswer } from '@loro/core/srs';
import { getCatalog, isCatalogReady } from '@loro/core/catalog';
import { staticVideos } from '@loro/core/catalog/staticVideos';

/**
 * CHECKPOINT A — does the phone import @loro/core?
 *
 * Proves the workspace wiring end to end: that Metro follows the `file:`
 * symlink out of this project, resolves core's "./*": "./src/*.ts" exports
 * pattern, transforms core's raw TypeScript, and honours its extension-ed
 * internal imports. @loro/core/srs is the narrowest possible probe for that —
 * one type-only import, no JSON, no third-party package.
 *
 * CHECKPOINT B — does core's CATALOG resolve, with its data outside the package?
 *
 * Two further mechanisms, neither exercised by checkpoint A, and kept in
 * separate cards so an on-device failure says which one broke:
 *
 *  1. WATCHFOLDERS. catalog/staticVideos.ts imports
 *     '../../../../data/videos.json' — four levels up out of packages/core,
 *     landing at <repoRoot>/data/. Metro serves nothing outside projectRoot
 *     unless a watch folder covers it, so this only resolves because
 *     metro.config.js sets watchFolders = [repoRoot]. A break here reads
 *     "Unable to resolve ../../../../data/videos.json".
 *
 *  2. THE IMPORT ATTRIBUTE. That same import carries `with { type: 'json' }`,
 *     which core needs so its modules load under `node --test`. Metro's babel
 *     has to at least PARSE the attribute. A break here is a syntax error
 *     naming staticVideos.ts, not a resolution error.
 *
 * getCatalog() is read BEFORE any initCatalog call on purpose: core's resting
 * state is the seed set, not [], and this screen is the on-device proof of
 * that invariant — it must print the same 8 the seed has.
 *
 * DELIBERATELY NOT IMPORTED: @loro/core/catalog/localVideos, which adds
 * data/embedVideos.json — 7.2MB of embed transcripts that RN will fetch from
 * Supabase instead of bundling. The seed alone proves both mechanisms; pulling
 * localVideos would prove nothing further and inflate the bundle ~7MB.
 */

/** The real accent-folding used to grade every typed recall answer. */
const SAMPLES = ['¡Están!', 'Qué', 'niño', 'ACUERDO'] as const;

/**
 * Read at module scope, exactly as core's own consumers do, and before
 * anything calls initCatalog — so `resting` IS the seed.
 */
const resting = getCatalog();
const seed = staticVideos[0];
const firstLine = seed.cues[0].words.map((w) => w.text).join(' ');

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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <StatusBar style="light" />

      <Text style={styles.title}>@loro/core is on the phone</Text>
      <Text style={styles.subtitle}>checkpoints A + B — imported from packages/core</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>A · normalizeAnswer()</Text>
        {SAMPLES.map((sample) => (
          <Row key={sample} label={sample} value={normalizeAnswer(sample)} />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>A · Leitner schedule</Text>
        <Row label="boxes" value={String(BOX_INTERVALS_MS.length)} />
        <Row label="MAX_BOX" value={String(MAX_BOX)} />
        <Row
          label="box 1 → box 6"
          value={`${BOX_INTERVALS_MS[1] / 60_000}min → ${
            BOX_INTERVALS_MS[MAX_BOX] / 86_400_000
          }d`}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>B · seed from ../../../../data</Text>
        <Row label="staticVideos.length" value={String(staticVideos.length)} />
        <Row label="getCatalog().length" value={String(resting.length)} />
        <Row label="isCatalogReady()" value={String(isCatalogReady())} />
        <Row label="resting === seed" value={String(resting.length === staticVideos.length)} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>B · first seed video</Text>
        {/* Video has no title field — creator is the display label, and the
            first cue's words are real transcript content out of the JSON. */}
        <Row label="creator" value={seed.creator} />
        <Row label="level" value={seed.level} />
        <Row label="author.kind" value={seed.author.kind} />
        <Row label="cues" value={String(seed.cues.length)} />
        <Row label="dictionary" value={String(Object.keys(seed.dictionary).length)} />
        <Text style={styles.id}>{seed.id}</Text>
        <Text style={styles.line}>{firstLine}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0a0d0b',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 96,
    paddingBottom: 48,
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
  id: {
    color: '#7d8a83',
    fontSize: 11,
    marginTop: 4,
  },
  line: {
    color: '#f2f5f3',
    fontSize: 15,
    fontStyle: 'italic',
  },
});
