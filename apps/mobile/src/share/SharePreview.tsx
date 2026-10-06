import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { storage } from '@loro/core/storage';
import { cleanWord } from '@loro/core/dictionary';
import { buildRoadmap, cityArrivals, splitCities, tripPosition, withLevelKnown } from '@loro/core/roadmap';
import { CityShareCard, type CityCardWord } from './CityShareCard';

/**
 * DEV PREVIEW OF THE CITY CARD (Radek, 2026-10-06: judge the look before the
 * share flow is built). The dev menu raises it; it draws the card for the
 * city you are in, from your own trip. Still in Madrid, or nothing learned
 * there yet: Sevilla with a few sample words, so the look can be judged on
 * a fresh install. Tap anywhere to close.
 */
const listeners = new Set<() => void>();
export function devShowCityCard(): void {
  for (const l of listeners) l();
}

const SAMPLE: CityCardWord[] = [
  { word: 'tiempo', meaning: 'time' },
  { word: 'ciudad', meaning: 'city' },
  { word: 'gente', meaning: 'people' },
  { word: 'hoy', meaning: 'today' },
  { word: 'vida', meaning: 'life' },
];

function cardData() {
  const trip = withLevelKnown(storage.getSavedWords(), storage.getLevelKnownWords()).words;
  const pos = tripPosition(trip);
  const stage = Math.max(1, pos.stage);
  const cities = splitCities(buildRoadmap(trip));
  const before = (cities[stage - 1] ?? []).filter((n) => n.status === 'done');
  const words = before.map((n) => ({ word: cleanWord(n.word.text), meaning: n.word.translation }));
  const learnedTotal = cities.flat().filter((n) => n.status === 'done').length;
  return {
    stage,
    words: words.length > 0 ? words : SAMPLE,
    arrivedAt: cityArrivals(trip)[stage] ?? Date.now(),
    learnedTotal: Math.max(learnedTotal, words.length > 0 ? 0 : 12),
  };
}

export function SharePreviewHost() {
  const [data, setData] = useState<ReturnType<typeof cardData> | null>(null);
  const { width, height } = useWindowDimensions();
  useEffect(() => {
    const show = () => setData(cardData());
    listeners.add(show);
    return () => {
      listeners.delete(show);
    };
  }, []);
  if (!data) return null;
  // As big as the screen allows at 9:16, with room for the hint.
  const cardW = Math.min(width - 40, ((height - 120) * 9) / 16);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setData(null)}>
      <Pressable style={styles.scrim} onPress={() => setData(null)}>
        <CityShareCard {...data} width={cardW} />
        <Text style={styles.hint}>Preview · tap to close</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.85)', flex: 1, justifyContent: 'center' },
  hint: { color: 'rgba(242,245,243,0.5)', fontSize: 12, fontWeight: '700', marginTop: 14 },
});
