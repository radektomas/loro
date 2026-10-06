import { storage } from '@loro/core/storage';
import { cleanWord } from '@loro/core/dictionary';
import { distinctWords } from '@loro/core/progress';
import { countsOnTrip, tripPosition, tripStop, withLevelKnown } from '@loro/core/roadmap';
import { storageDriver } from '../platform/storage';
import { track } from '../platform/analytics';

/**
 * THE TRIP, TOLD IN THE FEED (Radek, 2026-10-04: use Loro's side-of-the-
 * screen moment to tell the user "he can now see the word in Words and
 * train it", and when a city is close). Four moments, all milestones:
 *
 *   firstSave  the first word ever saved — it is waiting in Words.   once ever
 *   firstBlue  the first blue blank typed right — it is on the map.  once ever
 *   oneAway    a blue blank left one word to the next city.          once per city
 *   arrived    a blue blank completed the city.                      once per city
 *
 * RARE ON PURPOSE. The moment is a small Loro rising from the Words tab
 * while the video plays on (LearnedToast's TabMomentView), but it still pulls
 * the eye off the video. Never two within a minute, never two on one video;
 * a moment the throttle swallows is not marked shown, so it can come later.
 * Training in Words needs none of this: the map is right there.
 */

export type TripMomentKind = 'firstSave' | 'firstBlue' | 'oneAway' | 'arrived';

export type TripMoment = {
  kind: TripMomentKind;
  eyebrow: string;
  /** The big line: a word, or the city. */
  word: string;
  line: string;
  /** Under the line: what a tap does. */
  foot: string;
  /** Where a tap lands in Words: on the word you are on, or on the city. */
  land: 'word' | 'city';
};

const KEY_FIRST_SAVE = 'loro.mobile.momentFirstSave';
const KEY_FIRST_BLUE = 'loro.mobile.momentFirstBlue';
/** The furthest stage each per-city moment has been shown for: { oneAway, arrived }. */
const KEY_CITY = 'loro.mobile.momentCity';

const GAP_MS = 60_000;
/** The save chip drops into the Words tab ~1.2 s after the sheet closes
    (WordSheet SavedBadge); Loro rises out of that tab just after it lands. */
const AFTER_SAVE_BADGE_MS = 1500;

const listeners = new Set<(m: TripMoment) => void>();
let lastAt = 0;
let lastVideo: string | null = null;

export function subscribeToTripMoment(listener: (m: TripMoment) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function flag(key: string): boolean {
  try {
    return storageDriver.local.getItem(key) !== null;
  } catch {
    return true; // can't read: assume shown, never nag
  }
}
function setFlag(key: string): void {
  try {
    storageDriver.local.setItem(key, '1');
  } catch {}
}
function cityShown(): { oneAway: number; arrived: number } {
  try {
    const raw = storageDriver.local.getItem(KEY_CITY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { oneAway: -1, arrived: -1 };
}
function setCityShown(v: { oneAway: number; arrived: number }): void {
  try {
    storageDriver.local.setItem(KEY_CITY, JSON.stringify(v));
  } catch {}
}

/** Show it, unless the throttle says not now. True when shown. */
function emit(moment: TripMoment, videoId: string | null): boolean {
  if (listeners.size === 0) return false;
  const now = Date.now();
  if (now - lastAt < GAP_MS) return false;
  if (videoId !== null && videoId === lastVideo) return false;
  lastAt = now;
  lastVideo = videoId;
  track('trip_moment', { kind: moment.kind });
  for (const l of listeners) l(moment);
  return true;
}

/**
 * A moment is on screen now (or just was). The notifications ask waits for
 * the next right answer instead of landing on top of it (Radek, 2026-10-06:
 * the first blue word's "it's on your map" arrived together with the
 * notifications card).
 */
export function tripMomentRecent(withinMs = 5000): boolean {
  return lastAt > 0 && Date.now() - lastAt < withinMs;
}

/** Where the trip stands — read before a blue answer, compared after it. */
export function tripSnapshot(): { stage: number; learnedHere: number; size: number } {
  return tripPosition(withLevelKnown(storage.getSavedWords(), storage.getLevelKnownWords()).words);
}

/** A word was saved from the feed (a verified write). */
export function noteWordSaved(text: string, videoId: string | null): void {
  if (flag(KEY_FIRST_SAVE)) return;
  // Only a true first word: someone who saved before this existed has
  // already met Words, and "your first word" would be untrue.
  const first = distinctWords(storage.getSavedWords()).length === 1;
  if (!first) {
    setFlag(KEY_FIRST_SAVE);
    return;
  }
  setTimeout(() => {
    const shown = emit(
      {
        kind: 'firstSave',
        eyebrow: '¡Tu primera palabra!',
        word: cleanWord(text),
        line: "It's waiting in Words. Train it there and your trip begins in Madrid.",
        foot: 'Tap to train it',
        land: 'word',
      },
      videoId
    );
    if (shown) setFlag(KEY_FIRST_SAVE);
  }, AFTER_SAVE_BADGE_MS);
}

/** A blue blank was typed right; `before` is tripSnapshot() from just before it. */
export function noteBlueRight(
  text: string,
  videoId: string | null,
  before: { stage: number; learnedHere: number; size: number }
): void {
  const after = tripSnapshot();
  const moved = after.stage !== before.stage || after.learnedHere !== before.learnedHere;
  if (!moved) return;
  const shownCity = cityShown();

  if (after.stage > before.stage && after.stage > shownCity.arrived) {
    const city = tripStop(after.stage).label;
    if (
      emit(
        {
          kind: 'arrived',
          eyebrow: '¡Llegaste!',
          word: city,
          line: `${cleanWord(text)} was the last word you needed. Come see your map.`,
          foot: 'Tap to open your map',
          land: 'city',
        },
        videoId
      )
    ) {
      setCityShown({ ...shownCity, arrived: after.stage });
    }
    return;
  }

  const left = after.size - after.learnedHere;
  if (left === 1 && before.size - before.learnedHere > 1 && after.stage > shownCity.oneAway) {
    const next = tripStop(after.stage + 1).city;
    if (
      emit(
        {
          kind: 'oneAway',
          eyebrow: 'Almost there',
          word: `1 word to ${next}`,
          line: `${cleanWord(text)} counted on your trip. One more and you fly to ${next}.`,
          foot: 'Tap to see your next word',
          land: 'word',
        },
        videoId
      )
    ) {
      setCityShown({ ...shownCity, oneAway: after.stage });
    }
    return;
  }

  if (!flag(KEY_FIRST_BLUE) && countsOnTrip(text)) {
    if (
      emit(
        {
          kind: 'firstBlue',
          eyebrow: '¡Lo sabías!',
          word: cleanWord(text),
          line: "It's on your map now, in blue. Words you already know fill your cities too.",
          foot: 'Tap to see it',
          land: 'city',
        },
        videoId
      )
    ) {
      setFlag(KEY_FIRST_BLUE);
    }
  }
}

/** DEV: show each trip moment with made-up words, ignoring the throttle and the flags. */
export function devRaiseTripMoment(kind: TripMomentKind): void {
  const pos = tripSnapshot();
  const next = tripStop(pos.stage + 1).city;
  const samples: Record<TripMomentKind, TripMoment> = {
    firstSave: { kind, eyebrow: '¡Tu primera palabra!', word: 'esposa', line: "It's waiting in Words. Train it there and your trip begins in Madrid.", foot: 'Tap to train it', land: 'word' },
    firstBlue: { kind, eyebrow: '¡Lo sabías!', word: 'tiempo', line: "It's on your map now, in blue. Words you already know fill your cities too.", foot: 'Tap to see it', land: 'city' },
    oneAway: { kind, eyebrow: 'Almost there', word: `1 word to ${next}`, line: `tiempo counted on your trip. One more and you fly to ${next}.`, foot: 'Tap to see your next word', land: 'word' },
    arrived: { kind, eyebrow: '¡Llegaste!', word: next, line: 'tiempo was the last word you needed. Come see your map.', foot: 'Tap to open your map', land: 'city' },
  };
  for (const l of listeners) l(samples[kind]);
}
