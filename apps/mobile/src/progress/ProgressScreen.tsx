import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  AppState,
  DevSettings,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SavedWord } from '@loro/core/types';
import { storage } from '@loro/core/storage';

import {
  computeStreaks,
  countForDay,
  dayKey,
  distinctWords,
  learnedThisWeek,
  weekStrip,
  type DailyCounts,
} from '@loro/core/progress';
import { requestWordFocus, requestWordsView } from '../vocab/wordsView';
import { onLearnedFace } from '../feed/wordLearned';
import {
  formatTime,
  getPermissionState,
  getPrefs,
  isNotificationSeamAvailable,
  openSystemSettings,
  requestPermission,
  sendTestNotification,
  setEnabled,
  setReminderTime,
  type PermissionState,
} from '../platform/notifications';
import { resetForColdStart } from '../onboarding/flow';
import { SignInCard } from '../auth/SignInCard';
import { DeleteAccountCard } from '../auth/DeleteAccountCard';
import { LegalLinks } from './LegalLinks';
import { getLikedTopics, setLikedTopics } from '../feed/topics';
import { TOPICS } from '../onboarding/copy';
import { TINTS } from '../onboarding/art';
import { track } from '../platform/analytics';
import { getPlan, type Plan } from './plan';
import { LearnedSection, LevelRoad, PassportSection, TodaySection } from './Journal';
import { tierForLearned } from '@loro/core/levels';

/**
 * PROGRESS — redrawn around the week (2026-09-07).
 *
 * WHAT IT USED TO BE: a port of the web's all-time page. Three totals, the
 * six-tier ladder, then "Words you got right" as an unbounded list of every
 * row with a correct answer — which, because a blue blank typed once was
 * filed as known and the same word from three videos was three rows, opened
 * on "de ×3, el, en, que" for every real user. Radek's verdict: "an endless
 * row of words, there has to be a better way". There was, and it was mostly
 * a data problem (see LEVEL_FILL_BOX in core/srs.ts); this screen is the
 * other half.
 *
 * WHAT IT IS NOW (2026-10-02): a travel journal, drawn in Journal.tsx —
 * today and the week as path coins, the passport of countries reached, the
 * words learned this week, the level road. No review pile: the one button
 * is the next city ("4 words to Barcelona") and it opens Words (Radek:
 * "Review 151 words" should be "x words to the y city").
 * Then the settings the page has always carried. The "Words" state bar that
 * used to close the list (lapsed / new / learning / known, as a segmented
 * bar with a legend) is gone: Radek, 2026-09-07, "I don't read anything
 * out of it". Everything it said is said better above — learned and on the
 * way in card 3, ready in card 4 — and its "known" count was the inflated
 * one (state === 'known' includes one-shot fills), so it also disagreed
 * with card 3's "learned" a few lines up. The per-video rows that
 * used to close the page are gone (Radek, 2026-09-07: "take out the
 * videos") — they were the web's, and on a phone they were a list of
 * thumbnails nobody scrolled to.
 *
 * EXPECT EMPTY PANELS, AND THAT IS HONEST RATHER THAN BROKEN. Nothing here
 * fabricates a placeholder to fill the space; every zero is a real zero.
 */

function SectionTitle({
  children,
  right,
}: {
  children: string;
  right?: string;
}) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right !== undefined && <Text style={styles.sectionRight}>{right}</Text>}
    </View>
  );
}

/**
 * DEV ONLY — wipe every loro.* key and cold-start the app.
 *
 * WHY THIS EXISTS AT ALL. storage.isOnboarded() is not just a flag: it also
 * returns true for anyone with saved words or watched videos (storage.ts:
 * 1369-1376). So on a device that has run the feed even once, clearing the
 * flag leaves the gate shut and the onboarding flow untestable. The only
 * honest reset is a real wipe.
 *
 * TWO TAPS, because it destroys the schedule, the saved words, the watch log
 * and the streak. `__DEV__` is inlined by the bundler, so the whole row —
 * component, styles and the DevSettings reference — is dead code eliminated
 * from a production build rather than merely hidden at runtime.
 *
 * DevSettings.reload() is React Native core (no new module) and exists only in
 * dev builds, which is exactly this row's lifetime. The reload is not a
 * nicety: module-level caches and React state still hold the wiped values, so
 * without it the app keeps running on data that no longer exists.
 */
function DevResetRow() {
  const [armed, setArmed] = useState(false);
  return (
    <Pressable
      onPress={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        resetForColdStart();
        DevSettings.reload();
      }}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.devRow,
        armed && styles.devRowArmed,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.devText, armed && styles.devTextArmed]}>
        {armed
          ? 'Tap again to WIPE all loro.* data and restart'
          : 'DEV · Reset device (cold start)'}
      </Text>
    </Pressable>
  );
}

/**
 * DEV ONLY — fire a reminder five seconds from now.
 *
 * THIS IS A FILMING TOOL AND THAT IS WHY IT LOOKS LIKE NOTHING SPECIAL. It
 * schedules through the same content builder the real 19:00 reminder uses, so
 * what lands on the lock screen is byte-for-byte the product, streak line and
 * due count included. Five seconds is enough to background the app and catch
 * the banner.
 *
 * Dead-code eliminated from production alongside DevResetRow: `__DEV__` is
 * inlined by the bundler, so the guard at the call site removes this too.
 */
function DevNotificationRow() {
  const [sent, setSent] = useState(false);
  return (
    <Pressable
      onPress={() => {
        void sendTestNotification();
        setSent(true);
        setTimeout(() => setSent(false), 6000);
      }}
      accessibilityRole="button"
      style={({ pressed }) => [styles.devRow, pressed && styles.pressed]}
    >
      <Text style={styles.devText}>
        {sent ? 'Scheduled. Background the app…' : 'DEV · Send test notification (5s)'}
      </Text>
    </Pressable>
  );
}

/** 30-minute granularity. Fine enough to matter, coarse enough that setting it
    is two or three taps rather than a scrub. */
const TIME_STEP_MINUTES = 30;
const MINUTES_IN_DAY = 24 * 60;

/**
 * YOUR FEED (Radek, 2026-10-06: change the onboarding topics any time — in
 * Settings, not in the feed's shelf menu, which felt like a weird place).
 * The same six topics, in their onboarding colours. Each tap saves; the
 * reels re-rank the next time the Feed tab is opened (feed/topics.ts bus).
 */
function TopicsSection() {
  const [liked, setLiked] = useState<string[]>(getLikedTopics);
  /**
   * A tap saves at once, so the only thing missing was being TOLD so
   * (Radek, 2026-10-06: "does it really work when you click it?"). The line's
   * room is always reserved and only its opacity moves: a line that appeared
   * would push the card taller, the jump the tiles were rebuilt to avoid.
   */
  const savedShown = useSharedValue(0);
  const savedStyle = useAnimatedStyle(() => ({ opacity: savedShown.value }));
  const toggle = (id: string) => {
    savedShown.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    const next = liked.includes(id) ? liked.filter((t) => t !== id) : [...liked, id];
    setLiked(next);
    setLikedTopics(next);
    track('topics_changed', { topics: next.join(',') });
  };
  return (
    <View style={styles.section}>
      <SectionTitle>Your feed</SectionTitle>
      <View style={styles.card}>
        <Text style={styles.notifTitle}>What you love watching</Text>
        {/* One sentence whatever is picked: a line that swapped wording on the
            first tap changed the card's height and shoved the grid (Radek,
            2026-10-06: "I click something and it changes position"). */}
        <Text style={styles.notifBody}>
          Two in every five reels come from what you pick. Everything else still shows up.
        </Text>
        <View style={styles.topicChips}>
          {TOPICS.options.map((t) => (
            <TopicToggle
              key={t.id}
              label={t.label}
              colour={TOPIC_TINT[t.id] ?? '#5ee6a8'}
              on={liked.includes(t.id)}
              onPress={() => toggle(t.id)}
            />
          ))}
        </View>
        <Animated.Text style={[styles.topicSaved, savedStyle]}>
          Saved. Your reels update when you go back to the feed.
        </Animated.Text>
      </View>
    </View>
  );
}

/**
 * One topic. NOTHING ABOUT IT CHANGES SIZE: every tile is half the row and
 * the same height, and the tick ring is always drawn, so a tap only changes
 * colour. The earlier chips grew a "✓ " prefix on tap, and in a wrapping row
 * a wider chip pushed its neighbours onto the next line. Colour eases on one
 * 0→1 clock, as the onboarding cards do (onboarding/chrome.tsx ChoiceCard).
 */
function TopicToggle({
  label,
  colour,
  on,
  onPress,
}: {
  label: string;
  colour: string;
  on: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const sel = useSharedValue(on ? 1 : 0);
  const press = useSharedValue(0);
  const pop = useSharedValue(1);
  useEffect(() => {
    sel.value = withTiming(on ? 1 : 0, { duration: reduced ? 0 : 220, easing: Easing.out(Easing.cubic) });
    if (on && !reduced) {
      pop.value = withSequence(
        withTiming(1.2, { duration: 110, easing: Easing.out(Easing.quad) }),
        withSpring(1, { damping: 9, stiffness: 260 })
      );
    }
  }, [on, reduced, sel, pop]);
  const tile = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], ['rgba(242,245,243,0.05)', `${colour}24`]),
    borderColor: interpolateColor(sel.value, [0, 1], ['rgba(242,245,243,0.10)', `${colour}99`]),
    transform: [{ scale: 1 - press.value * 0.03 }],
  }));
  const text = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], ['rgba(242,245,243,0.85)', colour]),
  }));
  const ring = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], [`${colour}00`, colour]),
    borderColor: interpolateColor(sel.value, [0, 1], ['rgba(242,245,243,0.25)', colour]),
    transform: [{ scale: pop.value }],
  }));
  const mark = useAnimatedStyle(() => ({
    opacity: sel.value,
    transform: [{ scale: 0.5 + sel.value * 0.5 }],
  }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(1, { duration: reduced ? 0 : 90 });
      }}
      onPressOut={() => {
        press.value = withTiming(0, { duration: reduced ? 0 : 160 });
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={styles.topicCell}
    >
      <Animated.View style={[styles.topicChip, tile]}>
        <Animated.View style={[styles.topicTick, ring]}>
          <Animated.Text style={[styles.topicTickMark, mark]}>✓</Animated.Text>
        </Animated.View>
        <Animated.Text style={[styles.topicChipText, text]} numberOfLines={2}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/** The onboarding tiles' colours (onboarding/steps.tsx TOPIC_ART + art.tsx TINTS). */
const TOPIC_TINT: Record<string, string> = {
  travel: TINTS.sky,
  food: TINTS.amber,
  love: TINTS.rose,
  money: TINTS.mint,
  funny: TINTS.violet,
  mind: TINTS.mint,
};

/**
 * The notification settings, and the app's only place to change them.
 *
 * NO DATE PICKER COMPONENT. @react-native-community/datetimepicker is a NATIVE
 * module, so adding it costs an EAS rebuild for a control this screen needs
 * exactly one of. A stepper over 30-minute increments is built from the
 * Pressables already here, needs no rebuild, and is easier to hit on camera
 * than a spinner.
 *
 * THREE PERMISSION STATES, ALL SURFACED. A toggle that silently does nothing
 * because iOS said no is the worst version of this screen, so a denial says so
 * and offers the only route back, which is Settings.
 */
function NotificationsSection() {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [prefs, setPrefs] = useState(getPrefs);

  const refreshPermission = useCallback(() => {
    void getPermissionState().then(setPermission);
  }, []);

  // Re-read on every foreground: the user may have just come back from iOS
  // Settings, which is the one place this can change behind our back.
  useEffect(() => {
    refreshPermission();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  const granted = permission === 'granted';
  const denied = permission === 'denied';
  const on = granted && prefs.enabled;

  const shiftTime = (delta: number) => {
    const total =
      (prefs.hour * 60 + prefs.minute + delta * TIME_STEP_MINUTES + MINUTES_IN_DAY) %
      MINUTES_IN_DAY;
    const hour = Math.floor(total / 60);
    const minute = total % 60;
    setReminderTime(hour, minute);
    setPrefs((current) => ({ ...current, hour, minute }));
  };

  const toggle = (next: boolean) => {
    // Turning it on with no answer from iOS yet is a legitimate second route to
    // the system prompt, for anyone who said "Not now" in the feed. Turning it
    // off never asks anything.
    if (next && permission === 'undetermined') {
      void requestPermission().then((state) => {
        setPermission(state);
        if (state === 'granted') {
          setEnabled(true);
          setPrefs((current) => ({ ...current, enabled: true }));
        }
      });
      return;
    }
    setEnabled(next);
    setPrefs((current) => ({ ...current, enabled: next }));
  };

  // Nothing until the first permission read lands, which is one tick. Rendering
  // a default-off toggle first would flash the wrong state at anyone who has
  // already allowed it.
  //
  // Nothing either on a binary whose notification module is missing: a toggle
  // that cannot do anything is worse than no toggle, and "Open Settings" would
  // send the user somewhere that cannot help them.
  if (permission === null || !isNotificationSeamAvailable()) return null;

  return (
    <View style={styles.section}>
      <SectionTitle>Notifications</SectionTitle>
      <View style={styles.card}>
        <View style={styles.notifRow}>
          <View style={styles.notifLabel}>
            <Text style={styles.notifTitle}>Daily reminder</Text>
            <Text style={styles.notifBody}>
              {denied
                ? 'Turned off in iOS Settings'
                : on
                  ? 'One nudge a day, plus a gentle one in the evening if the day is still open'
                  : 'Off. No reminders are sent'}
            </Text>
          </View>
          <Switch
            value={on}
            onValueChange={toggle}
            disabled={denied}
            accessibilityLabel="Daily reminder"
            trackColor={{ false: 'rgba(242,245,243,0.16)', true: '#5ee6a8' }}
            thumbColor="#f2f5f3"
            ios_backgroundColor="rgba(242,245,243,0.16)"
          />
        </View>

        {on && (
          <View style={styles.timeRow}>
            <Text style={styles.notifTitle}>Time</Text>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => shiftTime(-1)}
                accessibilityRole="button"
                accessibilityLabel="Earlier"
                hitSlop={8}
                style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
              >
                <Text style={styles.stepButtonText}>−</Text>
              </Pressable>
              <Text
                style={styles.stepValue}
                accessibilityRole="text"
                accessibilityLabel={`Reminder at ${formatTime(prefs.hour, prefs.minute)}`}
              >
                {formatTime(prefs.hour, prefs.minute)}
              </Text>
              <Pressable
                onPress={() => shiftTime(1)}
                accessibilityRole="button"
                accessibilityLabel="Later"
                hitSlop={8}
                style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
              >
                <Text style={styles.stepButtonText}>+</Text>
              </Pressable>
            </View>
          </View>
        )}

        {denied && (
          <Pressable
            onPress={openSystemSettings}
            accessibilityRole="button"
            accessibilityHint="Opens this app's page in iOS Settings"
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          >
            <Text style={styles.ctaText}>Open Settings</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function ProgressScreen({
  active,
  onGoToFeed,
  onGoToWords,
}: {
  active: boolean;
  onGoToFeed: () => void;
  /** The learned card's door to the Words tab's Learned face. */
  onGoToWords?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [words, setWords] = useState<SavedWord[]>(() => storage.getSavedWords());
  const [watchedIds, setWatchedIds] = useState<string[]>(() =>
    storage.getWatchedVideoIds()
  );
  const [recallDays, setRecallDays] = useState<string[]>(() =>
    storage.getCorrectRecallDays()
  );
  const [dailyCounts, setDailyCounts] = useState<DailyCounts>(() =>
    storage.getDailyCorrect()
  );
  /** Read on the way in, like everything else: the answer can only change
      by re-running onboarding, which reloads the app. */
  const [plan, setPlan] = useState<Plan>(getPlan);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => {
      setWords(storage.getSavedWords());
      setWatchedIds(storage.getWatchedVideoIds());
      setRecallDays(storage.getCorrectRecallDays());
      setDailyCounts(storage.getDailyCorrect());
      setPlan(getPlan());
    };
    // onWordsChanged covers saved words, the watch log, recall days, the
    // daily tally and the level meter — core lists all five as its watched
    // keys (storage.ts).
    const unsub = storage.onWordsChanged(refresh);
    if (!active) return unsub;
    // Re-read on the way IN only. Leaving the tab used to re-read and
    // re-render a screen that was about to be hidden; the subscription
    // above keeps it current while it is.
    refresh();
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearInterval(tick);
      unsub();
    };
  }, [active]);


  /**
   * The totals, and they are the Words tab's. `learned` is onLearnedFace
   * over DISTINCT words — earned from memory OR filed as known, not
   * slipped — because Radek wants ONE number everywhere (2026-09-18:
   * "progress words learned need to be definitely unified"; the Learned
   * pile said 80 while this said 60). One-shot level fills are demoted on
   * read (core demoteLegacyLevelFill), so they do not creep back in.
   * `learning` is the pipeline: saved, not yet learned, not slipped.
   */
  const totals = useMemo(() => {
    const distinct = distinctWords(words);
    let learned = 0;
    let learning = 0;
    for (const w of distinct) {
      if (onLearnedFace(w)) learned++;
      else if (w.state === 'learning' || w.state === 'new') learning++;
    }
    return { learned, learning };
  }, [words]);

  const streaks = useMemo(() => computeStreaks(recallDays, now), [recallDays, now]);
  const week = useMemo(
    () => weekStrip(recallDays, now, streaks.frozen),
    [recallDays, now, streaks.frozen]
  );
  const todayCount = useMemo(
    () => countForDay(dailyCounts, dayKey(now)),
    [dailyCounts, now]
  );
  const learnedWeek = useMemo(() => learnedThisWeek(words, now), [words, now]);


  const empty = words.length === 0 && watchedIds.length === 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title}>Progress</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {empty ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing to show yet</Text>
            <Text style={styles.emptyBody}>
              Watch videos, save words, and recall them — your progress shows up
              here.
            </Text>
            <Pressable
              onPress={onGoToFeed}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            >
              <Text style={styles.ctaText}>Go to the feed</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* THE JOURNAL (Journal.tsx): today and the week, the passport,
                the words of the week, the level road. One column, no boxes. */}
            <TodaySection
              plan={plan}
              count={todayCount}
              streaks={streaks}
              week={week}
              words={words}
              onWords={
                onGoToWords
                  ? () => {
                      requestWordFocus();
                      onGoToWords();
                    }
                  : undefined
              }
              onFeed={onGoToFeed}
            />
            <PassportSection words={words} onOpen={onGoToWords} />
            <LearnedSection
              week={learnedWeek}
              onTheWay={totals.learning}
              allTime={totals.learned}
              onSeeAll={
                onGoToWords
                  ? () => {
                      requestWordsView('learned');
                      onGoToWords();
                    }
                  : undefined
              }
            />
            <LevelRoad learned={totals.learned} />

            <Text style={styles.footNote}>
              {watchedIds.length} {watchedIds.length === 1 ? 'video' : 'videos'}{' '}
              watched
            </Text>
          </>
        )}

        {/* ABOVE the account block, not inside it. SignIn -> Delete -> Legal is
            a deliberate descending-commitment run and slotting a settings
            control between them would split it. Outside the empty/populated
            branch because reminders matter most to someone who has just started
            and has nothing on this screen yet. */}
        {/* Settings, set apart from the journal: tools, not progress. */}
        <View style={styles.settingsHead}>
          <Text style={styles.settingsTitle}>SETTINGS</Text>
        </View>
        <NotificationsSection />
        <TopicsSection />

        {/* Outside the empty/populated split for the same reason as the reset
            row: the offer to back up progress is worth making whether or not
            there is a full page of it, and a brand-new user who signs in here
            takes the merge-up path with an empty local cache, which is the
            cheapest possible version of it. Placed last so it never pushes the
            actual progress down the screen. */}
        <View style={styles.signIn}>
          <SignInCard />
        </View>

        {/* Directly under the account card, mirroring the web's placement.
            Renders itself away when signed out, so an anonymous user is never
            offered the deletion of an account they do not have. */}
        <View style={styles.deleteAccount}>
          <DeleteAccountCard />
        </View>

        {/* Last thing on the page, shown to everyone — the policy covers
            anonymous use too, so this is not gated on a session. */}
        <View style={styles.legal}>
          <LegalLinks />
        </View>

        {/* Outside the empty/populated split on purpose: the reset is most
            useful precisely when the panels are empty and you are re-running
            onboarding. */}
        {/* Hidden rather than left to no-op when the seam is missing: a filming
            tool that silently does nothing is a worse debugging experience than
            a button that is not there. */}
        {__DEV__ && isNotificationSeamAvailable() && <DevNotificationRow />}
        {__DEV__ && <DevResetRow />}
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0a0d0b', flex: 1 },
  header: {
    backgroundColor: '#0a0d0b',
    borderBottomColor: 'rgba(242,245,243,0.08)',
    borderBottomWidth: 1,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  title: { color: '#f2f5f3', fontSize: 22, fontWeight: '800' },
  scroll: { padding: 16, paddingBottom: 32 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 48 },
  emptyTitle: { color: '#f2f5f3', fontSize: 17, fontWeight: '700' },
  emptyBody: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
    textAlign: 'center',
  },
  signIn: { marginTop: 4 },
  deleteAccount: { marginTop: 12 },
  legal: { marginTop: 20 },
  section: { marginBottom: 22 },
  sectionHead: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: 'rgba(242,245,243,0.5)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  sectionRight: {
    color: '#5ee6a8',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  card: { backgroundColor: '#141a17', borderRadius: 18, padding: 16 },
  settingsHead: {
    borderTopColor: 'rgba(242,245,243,0.08)',
    borderTopWidth: 1,
    marginBottom: 14,
    marginTop: 6,
    paddingTop: 22,
  },
  settingsTitle: { color: 'rgba(242,245,243,0.4)', fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  tripTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  tripText: { flex: 1 },
  tripKicker: { color: '#5ee6a8', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  tripCity: { color: '#f2f5f3', fontSize: 24, fontWeight: '900', letterSpacing: -0.4 },
  tripPill: {
    backgroundColor: 'rgba(94,230,168,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tripPillText: { color: '#5ee6a8', fontSize: 12, fontWeight: '800' },
  tripChevron: { color: 'rgba(242,245,243,0.35)', fontSize: 26, fontWeight: '300', marginLeft: -4 },
  tripTrack: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 999,
    height: 8,
    marginTop: 14,
    overflow: 'hidden',
  },
  tripFill: { backgroundColor: '#5ee6a8', borderRadius: 999, height: '100%' },
  tripNext: { color: 'rgba(242,245,243,0.7)', fontSize: 13, fontWeight: '700', marginTop: 8 },
  cardAccent: {
    backgroundColor: 'rgba(94,230,168,0.12)',
    borderColor: 'rgba(94,230,168,0.25)',
    borderWidth: 1,
  },
  cardBody: { color: 'rgba(242,245,243,0.7)', fontSize: 13, lineHeight: 19 },
  cardFoot: {
    color: 'rgba(242,245,243,0.4)',
    fontSize: 12,
    marginTop: 8,
  },
  cardFootInline: {
    color: 'rgba(242,245,243,0.4)',
    fontSize: 12,
    fontWeight: '600',
  },
  bigNumber: { color: '#f2f5f3', fontSize: 24, fontWeight: '800' },
  bigNumberDone: { color: '#5ee6a8' },
  bigNumberUnit: { fontSize: 15, fontWeight: '700' },

  /** TODAY. Open reads as the page's accent card; done goes calm mint. */
  todayOpen: {
    borderColor: 'rgba(94,230,168,0.25)',
    borderWidth: 1,
  },
  todayDone: {
    backgroundColor: 'rgba(94,230,168,0.10)',
    borderColor: 'rgba(94,230,168,0.35)',
    borderWidth: 1,
  },
  todayHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  /** flex:1 with a right alignment so a long pace label wraps under itself
      instead of shoving the number off the row. */
  planLine: {
    color: 'rgba(242,245,243,0.45)',
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    paddingTop: 6,
    textAlign: 'right',
  },
  dots: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    marginTop: 14,
  },
  dot: {
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 999,
    height: 18,
    width: 18,
  },
  dotSmall: { height: 13, width: 13 },
  dotOn: { backgroundColor: '#5ee6a8' },
  dotDone: { backgroundColor: '#5ee6a8' },
  dotsExtra: {
    color: '#5ee6a8',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    marginLeft: 2,
  },

  /** THIS WEEK. The old Streak card's styles, kept name for name. */
  streakCardAlive: {
    borderColor: 'rgba(242,193,78,0.35)',
    borderWidth: 1,
  },
  streakHead: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  streakFlame: { fontSize: 30 },
  streakHeadText: { flex: 1 },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  weekDay: { alignItems: 'center', gap: 6 },
  weekDot: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.07)',
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  weekDotOn: { backgroundColor: '#f2c14e' },
  /** A frozen day: the streak survived it, so it is drawn as kept, not
      missed — ice blue, with the flake. */
  weekDotFrozen: { backgroundColor: 'rgba(87,179,242,0.25)' },
  weekIce: { color: '#57b3f2', fontSize: 13, fontWeight: '900' },
  streakSide: { alignItems: 'flex-end', gap: 4 },
  freezeNote: { color: 'rgba(242,245,243,0.4)', fontSize: 11, fontWeight: '700' },
  freezeNoteReady: { color: '#57b3f2' },
  weekDotToday: { borderColor: '#f2f5f3', borderWidth: 2 },
  weekDotFuture: { opacity: 0.35 },
  weekTick: { color: '#2a1f06', fontSize: 14, fontWeight: '900' },
  weekLabel: {
    color: 'rgba(242,245,243,0.45)',
    fontSize: 11,
    fontWeight: '700',
  },
  weekLabelToday: { color: '#f2f5f3' },
  weekLabelFuture: { opacity: 0.5 },
  streakFootRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  /** cardFoot carries its own marginTop for the stacked cards; in this row the
      two labels must sit on one baseline. */
  streakFootReset: { marginTop: 0 },
  streakToday: {
    color: 'rgba(242,245,243,0.5)',
    fontSize: 12,
    fontWeight: '700',
  },
  streakTodayDone: { color: '#f2c14e' },

  /** LEARNED THIS WEEK. */
  learnedEmptyTitle: {
    color: '#f2f5f3',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  /** The week's words as one mint sentence — a list, not a set of tokens. */
  learnedWords: {
    color: '#5ee6a8',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 8,
  },
  learnedMore: { color: 'rgba(242,245,243,0.5)', fontWeight: '600' },
  allTimeRow: {
    borderTopColor: 'rgba(242,245,243,0.08)',
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 10,
  },
  allTime: {
    color: 'rgba(242,245,243,0.45)',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    lineHeight: 17,
  },
  allTimeStrong: { color: 'rgba(242,245,243,0.8)', fontWeight: '700' },
  seeAll: { marginTop: 10 },
  seeAllText: { color: '#5ee6a8', fontSize: 14, fontWeight: '700' },

  /** LEVEL. */
  tier: {
    backgroundColor: '#141a17',
    borderRadius: 16,
    marginBottom: 6,
    marginTop: 6,
    padding: 12,
  },
  tierCurrent: {
    backgroundColor: 'rgba(87,179,242,0.12)',
    borderColor: 'rgba(87,179,242,0.35)',
    borderWidth: 1,
  },
  tierRowCurrent: {
    borderColor: 'rgba(87,179,242,0.35)',
    borderWidth: 1,
  },
  tierHead: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  tierBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.07)',
    borderRadius: 999,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  tierBadgeCurrent: { backgroundColor: '#57b3f2' },
  tierBadgeDone: { backgroundColor: 'rgba(94,230,168,0.18)' },
  tierBadgeText: { color: 'rgba(242,245,243,0.35)', fontSize: 11 },
  tierBadgeTextCurrent: { color: '#06130d', fontSize: 11 },
  tierBadgeTextDone: { color: '#5ee6a8', fontSize: 12, fontWeight: '800' },
  tierText: { flex: 1 },
  tierName: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  tierLocked: { color: 'rgba(242,245,243,0.4)' },
  tierMeaning: { color: 'rgba(242,245,243,0.45)', fontSize: 12, marginTop: 1 },
  tierHintInline: {
    color: 'rgba(87,179,242,0.85)',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  meterTrack: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    height: 5,
    marginTop: 12,
    overflow: 'hidden',
  },
  meterFill: { backgroundColor: '#57b3f2', height: '100%' },
  ladderToggle: { alignSelf: 'flex-start', marginTop: 10 },
  ladderToggleText: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 12,
    fontWeight: '700',
  },

  footNote: {
    color: 'rgba(242,245,243,0.35)',
    fontSize: 12,
    paddingTop: 4,
    textAlign: 'center',
  },
  /** One settings line: label block on the left, control hard right. */
  notifRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
  },
  /** flex:1 is what makes the body wrap instead of shoving the switch off the
      row on a narrow device. */
  notifLabel: { flex: 1 },
  notifTitle: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  topicChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  /** Two equal columns: 47% + grow absorbs the 8pt gap on any width. */
  topicCell: { flexBasis: '47%', flexGrow: 1 },
  topicChip: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    height: 52,
    paddingHorizontal: 11,
  },
  topicTick: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  topicSaved: { color: '#5ee6a8', fontSize: 12, fontWeight: '600', lineHeight: 16, marginTop: 12 },
  topicTickMark: { color: '#06130d', fontSize: 11, fontWeight: '900' },
  topicChipText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 17 },
  notifBody: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  timeRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(242,245,243,0.08)',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 14,
  },
  stepper: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  stepButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  stepButtonText: { color: '#5ee6a8', fontSize: 19, fontWeight: '800' },
  /** Tabular numerals and a fixed width so the row does not twitch as the
      digits change under a repeated tap. */
  stepValue: {
    color: '#f2f5f3',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    textAlign: 'center',
    width: 54,
  },
  devRow: {
    alignItems: 'center',
    borderColor: 'rgba(248,113,113,0.3)',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 28,
    paddingVertical: 11,
  },
  devRowArmed: {
    backgroundColor: 'rgba(248,113,113,0.14)',
    borderColor: '#f87171',
  },
  devText: { color: 'rgba(248,113,113,0.75)', fontSize: 12, fontWeight: '700' },
  devTextArmed: { color: '#f87171' },
  cta: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 14,
    marginTop: 14,
    paddingVertical: 12,
  },
  ctaText: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  /** The done state's button: present, not pressing. */
  ctaQuiet: {
    alignItems: 'center',
    borderColor: 'rgba(242,245,243,0.16)',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
    paddingVertical: 11,
  },
  ctaQuietText: { color: 'rgba(242,245,243,0.8)', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
