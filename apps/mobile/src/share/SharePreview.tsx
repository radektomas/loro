import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { CityShareCard, type CityCardWord } from './CityShareCard';
import { CARD_ENTER } from './PostcardLayer';

/**
 * DEV PREVIEW OF THE CITY CARD (Radek, 2026-10-06: judge the look before the
 * share flow is built). Two fixed test postcards from the dev menu, one per
 * kind of arrival (Radek: "give me 2 test postcards ... city to city and
 * country to country"): Bogotá to Medellín inside Colombia, and Cartagena
 * to Quito across a border. Sample words, so they look the same on any
 * install. Tap anywhere to close.
 */
export type TestCard = 'city' | 'country';
const listeners = new Set<(kind: TestCard) => void>();
export function devShowCityCard(kind: TestCard): void {
  for (const l of listeners) l(kind);
}

const SAMPLE: CityCardWord[] = [
  { word: 'tiempo', meaning: 'time' },
  { word: 'ciudad', meaning: 'city' },
  { word: 'gente', meaning: 'people' },
  { word: 'hoy', meaning: 'today' },
  { word: 'vida', meaning: 'life' },
  { word: 'camino', meaning: 'way' },
  { word: 'barrio', meaning: 'neighbourhood' },
  { word: 'fiesta', meaning: 'party' },
  { word: 'cerca', meaning: 'near' },
  { word: 'lleno', meaning: 'full' },
];

/** TRIP indexes: Medellín (from Bogotá) and Quito (from Cartagena). */
const TEST_STAGE: Record<TestCard, number> = { city: 16, country: 18 };

function cardData(kind: TestCard) {
  return { stage: TEST_STAGE[kind], words: SAMPLE, arrivedAt: Date.now(), learnedTotal: 164 };
}

export function SharePreviewHost() {
  const [data, setData] = useState<ReturnType<typeof cardData> | null>(null);
  const { width, height } = useWindowDimensions();
  useEffect(() => {
    const show = (kind: TestCard) => setData(cardData(kind));
    listeners.add(show);
    return () => {
      listeners.delete(show);
    };
  }, []);
  if (!data) return null;
  // As big as the screen allows at 9:16, with room for the hint.
  const cardW = Math.min(width - 40, ((height - 120) * 9) / 16);
  return (
    <Modal visible transparent animationType="none" onRequestClose={() => setData(null)}>
      <Animated.View entering={FadeIn.duration(260)} style={styles.fill}>
        <Pressable style={styles.scrim} onPress={() => setData(null)}>
          <Animated.View entering={CARD_ENTER}>
            <CityShareCard {...data} width={cardW} />
          </Animated.View>
          <Animated.Text entering={FadeIn.duration(320).delay(380)} style={styles.hint}>
            Preview · tap to close
          </Animated.Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.85)', flex: 1, justifyContent: 'center' },
  hint: { color: 'rgba(242,245,243,0.5)', fontSize: 12, fontWeight: '700', marginTop: 14 },
});
