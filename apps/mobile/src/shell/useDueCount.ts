import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { storage } from '@loro/core/storage';
import { wordsInVideos } from '../feed/launchReview';

/**
 * HOW MANY WORDS ARE READY — for the bubble on the Words tab.
 *
 * Radek, 2026-09-07: "show how many words he can review, in the words tile
 * down in the middle a small number in a bubble". The number is the SAME
 * count the Words tab's card prints ("N words ready to review"): saved
 * entries whose dueAt has passed, not folded per word. Folding here and not
 * there would put two different numbers a tap apart.
 *
 * It has to move on its own: a grade in the feed drops it, a save adds to it
 * (after the first interval), and time alone raises it as words fall due —
 * so it listens to storage, ticks once a minute, and re-reads on foreground,
 * because the app may have slept through a whole day of words coming due.
 */
const TICK_MS = 60_000;

/**
 * Since 2026-10-04 (Radek: "in the down bar a small pill with a number of
 * the words to review") it counted words open on the path to TRAIN. Since
 * 2026-11-24 nothing is trained first — the feed asks saved words on its
 * own — so it counts your words in today's videos (launchReview
 * wordsInVideos): the same number Loro says on the Words tab, beside the
 * Play that lands on them.
 */
function countDue(now = Date.now()): number {
  return wordsInVideos(now).length;
}

export function useDueCount(): number {
  const [count, setCount] = useState(countDue);

  useEffect(() => {
    const refresh = () => setCount(countDue());
    const unsub = storage.onWordsChanged(refresh);
    const tick = setInterval(refresh, TICK_MS);
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      unsub();
      clearInterval(tick);
      app.remove();
    };
  }, []);

  return count;
}
