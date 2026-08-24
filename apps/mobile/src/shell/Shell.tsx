import { memo, useCallback, useEffect, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { subscribeToNotificationRoute } from '../platform/notifications';
import { enableRecallForSession } from '../feed/recall';
import { FeedScreen } from '../feed/FeedScreen';
import { VocabScreen } from '../vocab/VocabScreen';
import { ProgressScreen } from '../progress/ProgressScreen';
import { FeedIcon, ProgressIcon, WordsIcon } from './TabIcons';
import { TabBarHeightContext } from './tabBar';

/**
 * The app shell: three tabs, hand-rolled.
 *
 * NO NAVIGATION LIBRARY, AND THAT IS A DECISION RATHER THAN A SHORTCUT.
 * @react-navigation/bottom-tabs and expo-router both list react-native-screens
 * as a peer dependency — a native module, so either one costs an EAS rebuild.
 * What they would buy is a back stack, deep linking and native screen
 * detachment, and this app currently wants none of the three: three sibling
 * tabs, no history, deep links deferred. react-native-screens exists precisely
 * to detach inactive screens natively, which is the one behaviour that would
 * destroy the persistent WebView. Installing it and configuring it off would be
 * the whole integration.
 *
 * ALL THREE TABS STAY MOUNTED; the inactive ones are display:'none'. Unmounting
 * the feed would throw away its scroll position and its measured player box on
 * every tab switch, and the box is what tells PlayerHost where to draw. Vocab
 * and Progress are cheap to keep alive — both read MMKV synchronously and
 * subscribe to storage.onWordsChanged, so they stay current while hidden and
 * need no refresh-on-focus.
 *
 * WHAT MAKES THIS SAFE FOR THE PLAYER is that PlayerHost is ABOVE this
 * component (App.tsx), not inside a tab. Switching tabs cannot unmount the
 * WebView, so the page's sound and rate state survive untouched. The feed tab
 * hides and pauses the player on blur; see FeedScreen.
 */

type TabKey = 'feed' | 'vocab' | 'progress';

type IconProps = { color: string; active: boolean };

const TABS: {
  key: TabKey;
  label: string;
  Icon: (props: IconProps) => ReactElement;
}[] = [
  { key: 'feed', label: 'Feed', Icon: FeedIcon },
  { key: 'vocab', label: 'Words', Icon: WordsIcon },
  { key: 'progress', label: 'Progress', Icon: ProgressIcon },
];

const ACTIVE = '#5ee6a8';
const INACTIVE = 'rgba(242,245,243,0.42)';

/**
 * ALL THREE TABS RE-RENDER ON EVERY SWITCH, and one of them never needed to.
 *
 * Switching sets state HERE, so React re-renders all three children — including
 * the one whose `active` did not change. Going Feed → Words re-rendered the
 * whole Progress tree (its stats, its week strip, its per-video rows) for no
 * reason at all. Memoised, that tab is skipped entirely; the two whose `active`
 * genuinely flipped still render, as they must.
 *
 * This only works because onGoToFeed below is stable — a fresh closure per
 * render would fail every comparison and quietly undo it.
 */
const Feed = memo(FeedScreen);
const Vocab = memo(VocabScreen);
const Progress = memo(ProgressScreen);

export function Shell() {
  const [tab, setTab] = useState<TabKey>('feed');
  const insets = useSafeAreaInsets();
  /** Published so the recall answer bar can sit flush on the keyboard — see
      tabBar.tsx for why it cannot just use the raw keyboard height. */
  const [tabBarHeight, setTabBarHeight] = useState(0);
  /** Stable, so the memoised screens above can actually skip a render. */
  const goToFeed = useCallback(() => setTab('feed'), []);

  /**
   * A TAPPED NOTIFICATION LANDS IN REVIEW, NOT THE FEED.
   *
   * This IS the routing layer. There is no navigator to wait on: the app is
   * three sibling tabs behind a useState, so "route to review" is the same pair
   * of calls the Review buttons in Progress and Words already make.
   *
   * enableRecallForSession is kept as the declared entry point into a review
   * session. With RECALL_ENABLED now true the arm is a no-op behaviourally
   * (see the note in recall.ts), but the call stays so this route reads the
   * same as the Review buttons in Progress and Words.
   *
   * COLD START IS HANDLED BY SUBSCRIBING, not by a second code path.
   * subscribeToNotificationRoute drains a route parked before anything mounted,
   * which covers both a launch-from-notification and a tap that arrived during
   * onboarding, when this component was not rendered at all.
   */
  useEffect(
    () =>
      subscribeToNotificationRoute(() => {
        enableRecallForSession();
        setTab('feed');
      }),
    []
  );

  return (
    <TabBarHeightContext.Provider value={tabBarHeight}>
    <View style={styles.root}>
      {/* Every tab rendered, inactive ones hidden. `display:'none'` keeps the
          native views alive with their state — and takes them out of the flex
          layout, so the visible one gets the whole area. A conditional render
          would drop that state instead. */}
      <View style={styles.screens}>
        <View style={[styles.screen, tab !== 'feed' && styles.hidden]}>
          <Feed active={tab === 'feed'} />
        </View>
        <View style={[styles.screen, tab !== 'vocab' && styles.hidden]}>
          <Vocab active={tab === 'vocab'} onGoToFeed={goToFeed} />
        </View>
        <View style={[styles.screen, tab !== 'progress' && styles.hidden]}>
          <Progress active={tab === 'progress'} onGoToFeed={goToFeed} />
        </View>
      </View>

      <View
        style={[styles.bar, { paddingBottom: insets.bottom + 6 }]}
        onLayout={(event) => setTabBarHeight(event.nativeEvent.layout.height)}
      >
        {TABS.map((entry) => {
          const selected = tab === entry.key;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setTab(entry.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={entry.label}
              style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            >
              {/* Selected state is carried three ways — colour, stroke weight
                  inside the icon, and label weight — so it survives a
                  colour-blind reading. */}
              <entry.Icon color={selected ? ACTIVE : INACTIVE} active={selected} />
              <Text style={[styles.label, selected && styles.labelOn]}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
    </TabBarHeightContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0a0d0b', flex: 1 },
  /** The area above the tab bar. The slide measures its player box inside
      this, and this starts at the top of the window — which is why the box's
      coordinates still line up with the absolutely-positioned WebView now that
      PlayerHost sits at app root. */
  screens: { flex: 1 },
  screen: { flex: 1 },
  hidden: { display: 'none' },
  bar: {
    backgroundColor: '#0d110f',
    borderTopColor: 'rgba(242,245,243,0.10)',
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingTop: 6,
  },
  tab: { alignItems: 'center', flex: 1, gap: 4, paddingVertical: 4 },
  tabPressed: { opacity: 0.6 },
  label: { color: INACTIVE, fontSize: 11, fontWeight: '600' },
  labelOn: { color: ACTIVE, fontWeight: '800' },
});
