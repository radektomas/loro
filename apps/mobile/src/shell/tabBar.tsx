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
