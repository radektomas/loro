import { createContext, useContext } from 'react';

/**
 * The measured height of the bottom tab bar, published so anything pinned to
 * the keyboard can correct for it.
 *
 * WHY THIS EXISTS. A keyboard's reported height is measured from the WINDOW's
 * bottom edge. The recall answer bar is absolutely positioned inside the feed,
 * which lives inside the shell's screens container — and that container's
 * bottom edge is the TOP of the tab bar, not the window's. So `bottom:
 * keyboardHeight` parks the bar exactly one tab-bar-height too high, which is
 * the gap between the input and the keyboard. Subtracting this closes it.
 *
 * Measured rather than assumed: the bar's height is its content plus
 * insets.bottom, which differs across devices, and a constant would be wrong
 * on most of them.
 *
 * ITS OWN MODULE, NOT Shell.tsx, to avoid an import cycle — Shell imports
 * FeedScreen, which reaches RecallBar, which needs this value.
 */
export const TabBarHeightContext = createContext(0);

export const useTabBarHeight = () => useContext(TabBarHeightContext);

/**
 * A WORD JUST LANDED IN WORDS (Radek, 2026-10-04: the save badge sat on the
 * subtitles). The feed's save chip drops into the Words tab and calls this
 * as it lands; the shell bounces the tab and shows "+1". A plain bus, not
 * context, for the same import-cycle reason as above: the chip lives deep in
 * the feed, the tab in Shell.
 */
const wordsTabListeners = new Set<() => void>();

export function pulseWordsTab(): void {
  for (const listener of wordsTabListeners) listener();
}

export function subscribeToWordsTabPulse(listener: () => void): () => void {
  wordsTabListeners.add(listener);
  return () => {
    wordsTabListeners.delete(listener);
  };
}
