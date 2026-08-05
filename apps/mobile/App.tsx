// FIRST IMPORT, DELIBERATELY. Installs the platform + catalog seams as a module
// side effect before anything below can read storage. index.js imports it too;
// a module body runs once, so this is free insurance against a reorder there.
import { catalogSource, finishBoot } from './src/platform/boot';

import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { storage } from '@loro/core/storage';
import { getCatalog, isCatalogReady, onCatalogChanged } from '@loro/core/catalog';
import { staticVideos } from '@loro/core/catalog/staticVideos';
import type { SavedWord } from '@loro/core/types';

/**
 * CHECKPOINT C — real persistence.
 *
 * Checkpoints A and B proved that core's code and data RESOLVE on the phone.
 * This one proves the drivers actually STORE: words go through core's real
 * save path into MMKV, and the catalog comes off disk rather than the bundle.
 *
 * Still a harness, not UI. The two things it exists to show are the two things
 * a screenshot cannot fake:
 *
 *   1. a word survives a force-quit          → MMKV persists, not a Map
 *   2. the catalog count goes 8 → 216        → the Supabase loader + the file
 *                                              cache work end to end
 */

/** The first bundled seed clip. Real id, so upgradeTranslation resolves the
    video on every read instead of silently skipping the word. */
const SEED_VIDEO = staticVideos[0];

export default function App() {
  const [words, setWords] = useState<SavedWord[]>([]);
  const [catalogCount, setCatalogCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');

  const readAll = useCallback(() => {
    setWords(storage.getSavedWords());
    setCatalogCount(getCatalog().length);
    setReady(isCatalogReady());
  }, []);

  useEffect(() => {
    // Safe here and not a frame earlier: boot ran at module scope, so the
    // driver is installed and this subscription gets a live channel.
    readAll();
    finishBoot();
    const offWords = storage.onWordsChanged(readAll);
    const offCatalog = onCatalogChanged(readAll);
    return () => {
      offWords();
      offCatalog();
    };
  }, [readAll]);

  const save = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // core's real save path — the same gate, the same verified read-back, the
    // same sync queue the web uses. Nothing about this call is RN-specific.
    const result = storage.saveWord({
      text: trimmed,
      translation: `[${trimmed}]`,
      videoId: SEED_VIDEO.id,
      cueIndex: 0,
    });
    setStatus(
      result.ok
        ? `saved "${trimmed}"`
        : result.blocked
          ? 'blocked by the free-tier limit'
          : 'write FAILED (storage did not read back)'
    );
    if (result.ok) setText('');
    readAll();
  }, [text, readAll]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <StatusBar style="light" />

      <Text style={styles.title}>checkpoint C — persistence</Text>
      <Text style={styles.subtitle}>MMKV + expo-file-system, through @loro/core</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>catalog</Text>
        <Row label="getCatalog().length" value={String(catalogCount)} />
        <Row label="isCatalogReady()" value={String(ready)} />
        <Row label="booted from" value={catalogSource} />
        <Text style={styles.note}>
          {catalogCount > staticVideos.length
            ? 'full snapshot installed'
            : `seed only (${staticVideos.length}) — waiting on the loader`}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>save a word</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="type a Spanish word"
          placeholderTextColor="#4a554e"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={save}
          returnKeyType="done"
        />
        <Pressable style={styles.button} onPress={save}>
          <Text style={styles.buttonText}>save word</Text>
        </Pressable>
        {status !== '' && <Text style={styles.note}>{status}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>getSavedWords() — {words.length}</Text>
        {words.length === 0 ? (
          <Text style={styles.note}>nothing saved yet</Text>
        ) : (
          words.map((word) => (
            <Row
              key={`${word.videoId}:${word.text}`}
              label={word.text}
              value={`box ${word.box}`}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0d0b' },
  content: { paddingHorizontal: 24, paddingTop: 72, paddingBottom: 48, gap: 16 },
  title: { color: '#f2f5f3', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#7d8a83', fontSize: 13, marginBottom: 8 },
  card: { backgroundColor: '#141a16', borderRadius: 16, padding: 16, gap: 8 },
  cardTitle: {
    color: '#7d8a83',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: '#f2f5f3', fontSize: 16, flexShrink: 1, paddingRight: 12 },
  value: { color: '#5ee6a8', fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  note: { color: '#7d8a83', fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: '#0a0d0b',
    borderRadius: 10,
    color: '#f2f5f3',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  button: {
    backgroundColor: '#5ee6a8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#06130d', fontSize: 15, fontWeight: '700' },
});
