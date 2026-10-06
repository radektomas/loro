import { storage } from '@loro/core/storage';
import { cleanWord } from '@loro/core/dictionary';
import { buildRoadmap, cityArrivals, splitCities, withLevelKnown } from '@loro/core/roadmap';
import type { CityCardWord } from './CityShareCard';

/**
 * What the postcard for arriving at `stage` says, from the user's own trip:
 * the words they learned in the city they just left, when they got here, and
 * how many words the whole trip holds.
 */
export function postcardFor(stage: number): { stage: number; words: CityCardWord[]; arrivedAt: number; learnedTotal: number } {
  const trip = withLevelKnown(storage.getSavedWords(), storage.getLevelKnownWords()).words;
  const cities = splitCities(buildRoadmap(trip));
  const words = (cities[stage - 1] ?? [])
    .filter((n) => n.status === 'done')
    .map((n) => ({ word: cleanWord(n.word.text), meaning: n.word.translation }));
  const learnedTotal = cities.flat().filter((n) => n.status === 'done').length;
  return { stage, words, arrivedAt: cityArrivals(trip)[stage] ?? Date.now(), learnedTotal };
}
