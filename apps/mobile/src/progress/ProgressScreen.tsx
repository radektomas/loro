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
import type { SavedWord } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { formatDue } from '@loro/core/srs';
import {
  computeStreaks,
  type Streaks,
  countForDay,
  dayKey,
  distinctWords,
  dueCount,
  isLearned,
  learnedThisWeek,
  nextDueAt,
  splitFunctionWords,
  weekStrip,
  type DailyCounts,
  type WeekDay,
} from '@loro/core/progress';
import { launchReview, launchReviewOfWord } from '../feed/launchReview';
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
import { getPlan, type Plan } from './plan';
import { ReviewPicker } from './ReviewPicker';
import { TIERS, tierFor, type LevelState } from '@loro/core/levels';

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
 * WHAT IT IS NOW, top to bottom — the order is the order of the questions a
 * returning user asks:
 *   1. TODAY      how far along today's goal am I, and what do I do next.
 *                 The goal comes from the onboarding "how often" answer
 *                 (plan.ts), which the app collected and then never read.
 *   2. THIS WEEK  the streak and the week strip, against the plan's days.
 *   3. LEARNED    how many words crossed into known this week, and the
 *                 words themselves on one line. Learned means learned
 *                 (core/progress.ts isLearned): right on two different
 *                 days, never "typed once".
 *   4. REVIEW     what is ready, and a button that asks WHICH word, then
 *                 lands on it (ReviewPicker).
 *   5. LEVEL      one row with the meter; the full ladder on request.
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

/** Words named before "+N more" — enough to see the week, not the record. */
const LEARNED_PREVIEW = 12;

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
 * TODAY — the goal, as dots you fill.
 *
 * Dots rather than a ring: a ring needs react-native-svg (a native module,
 * an EAS rebuild) or a stack of clipped Views, and a row of `goal` circles
 * is the same information at a glance with none of that. It also scales
 * the right way — a 3-word plan is three big dots, a 10-word plan ten small
 * ones — so the target is legible as a count, not just a fraction.
 *
 * THE BUTTON DOES WHAT THE CARD SAYS. With words ready it launches a review
 * that lands on one (launchReview, shared with Words and the reminder);
 * with nothing due it opens the feed, where blue blanks count too. Once the
 * day is done the button goes quiet — a finished day should not nag.
 */
function TodayCard({
  plan,
  count,
  due,
  onReview,
  onFeed,
}: {
  plan: Plan;
  count: number;
  due: number;
  onReview: () => void;
  onFeed: () => void;
}) {
  const goal = plan.wordsPerDay;
  const done = count >= goal;
  const remaining = Math.max(0, goal - count);
  const dots = Array.from({ length: goal }, (_, i) => i < count);

  const body = done
    ? count > goal
      ? `${count} right today. Everything past ${goal} is a bonus.`
      : `${count} right today. Anything more is a bonus.`
    : due > 0
      ? `${remaining} more ${remaining === 1 ? 'word' : 'words'} and today is done. ` +
        `${due} ${due === 1 ? 'is' : 'are'} ready to review.`
      : `${remaining} more ${remaining === 1 ? 'word' : 'words'} and today is done. ` +
        'Any blank in any video counts.';

  return (
    <View style={[styles.card, done ? styles.todayDone : styles.todayOpen]}>
      <View style={styles.todayHead}>
        <Text style={[styles.bigNumber, done && styles.bigNumberDone]}>
          {done ? 'Día hecho ✓' : `${count} of ${goal}`}
          {!done && <Text style={styles.bigNumberUnit}> words</Text>}
        </Text>
        <Text style={styles.planLine}>
          {plan.paceLabel ? `Your plan: ${plan.paceLabel}` : 'Daily goal'}
        </Text>
      </View>

      <View
        style={styles.dots}
        accessibilityRole="progressbar"
        accessibilityLabel={`${count} of ${goal} words today`}
        accessibilityValue={{ min: 0, max: goal, now: Math.min(count, goal) }}
      >
        {dots.map((filled, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              goal > 6 && styles.dotSmall,
              filled && styles.dotOn,
              done && filled && styles.dotDone,
            ]}
          />
        ))}
        {count > goal && <Text style={styles.dotsExtra}>+{count - goal}</Text>}
      </View>

      <Text style={styles.cardBody}>{body}</Text>

      <Pressable
        onPress={due > 0 ? onReview : onFeed}
        accessibilityRole="button"
        accessibilityHint={
          due > 0
            ? 'Opens the feed on a word that is ready to review'
            : 'Opens the feed'
        }
        style={({ pressed }) => [
          done ? styles.ctaQuiet : styles.cta,
          pressed && styles.pressed,
        ]}
      >
        <Text style={done ? styles.ctaQuietText : styles.ctaText}>
          {due > 0
            ? done
              ? `Review ${due} more`
              : `Review ${due} ${due === 1 ? 'word' : 'words'}`
            : done
              ? 'Keep watching'
              : 'Open the feed'}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * THIS WEEK — the streak and the strip, against the plan.
 *
 * The strip is the same one the old Streak card drew (core's weekStrip:
 * local days, DST-safe, Monday-first — tested). What changed is the line
 * under it: "4 of 7 days" is the plan's promise read back, which the app
 * collected in onboarding and then never mentioned again. A plan already
 * met this week says so rather than reading "5 of 3".
 *
 * TODAY IS THE CALL TO ACTION. When today is not yet filled the card says so;
 * once it is, it goes quiet. No animation: this screen is a summary the user
 * scrolls, not a moment — the moment is the day-done card in the feed.
 */
function WeekCard({
  streaks,
  week,
  plan,
}: {
  streaks: Streaks;
  week: WeekDay[];
  plan: Plan;
}) {
  const todayDone = week.some((d) => d.isToday && d.active);
  const alive = streaks.current > 0;
  const practised = week.filter((d) => d.active).length;
  const planMet = practised >= plan.daysPerWeek;
  /** The freeze, said once: spent this week (a ❄ in the strip), or ready. */
  const frozenThisWeek = week.some((d) => d.frozen);

  return (
    <View style={[styles.card, alive && styles.streakCardAlive]}>
      <View style={styles.streakHead}>
        <Text style={styles.streakFlame}>{alive ? '🔥' : '·'}</Text>
        <View style={styles.streakHeadText}>
          <Text style={styles.bigNumber}>
            {streaks.current}{' '}
            <Text style={styles.bigNumberUnit}>
              {streaks.current === 1 ? 'day' : 'days'}
            </Text>
          </Text>
          <Text style={styles.cardBody}>
            {alive ? 'in a row' : 'Finish a day’s goal to start a streak.'}
          </Text>
        </View>
        <View style={styles.streakSide}>
          <Text style={styles.cardFootInline}>Longest {streaks.longest}</Text>
          {alive && (
            <Text style={[styles.freezeNote, streaks.freezeAvailable && styles.freezeNoteReady]}>
              {frozenThisWeek
                ? '❄ Freeze used'
                : streaks.freezeAvailable
                  ? '❄ Freeze ready'
                  : '❄ Freeze back next week'}
            </Text>
          )}
        </View>
      </View>

      <View
        style={styles.weekRow}
        accessibilityRole="image"
        accessibilityLabel={`This week: practised on ${week
          .filter((d) => d.active)
          .map((d) => d.label)
          .join(', ') || 'no days yet'}`}
      >
        {week.map((day) => (
          <View key={day.key} style={styles.weekDay}>
            <View
              style={[
                styles.weekDot,
                day.active && styles.weekDotOn,
                day.frozen && styles.weekDotFrozen,
                day.isToday && styles.weekDotToday,
                day.isFuture && styles.weekDotFuture,
              ]}
            >
              {day.active && <Text style={styles.weekTick}>✓</Text>}
              {day.frozen && <Text style={styles.weekIce}>❄</Text>}
            </View>
            <Text
              style={[
                styles.weekLabel,
                day.isToday && styles.weekLabelToday,
                day.isFuture && styles.weekLabelFuture,
              ]}
            >
              {day.label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.streakFootRow}>
        <Text style={[styles.cardFoot, styles.streakFootReset, planMet && styles.streakTodayDone]}>
          {planMet
            ? `${practised} ${practised === 1 ? 'day' : 'days'} · plan done ✓`
            : `${practised} of ${plan.daysPerWeek} days` +
              (plan.paceLabel ? ` · ${plan.paceLabel}` : '')}
        </Text>
        <Text style={[styles.streakToday, todayDone && styles.streakTodayDone]}>
          {todayDone ? "Today's done ✓" : 'Today is open'}
        </Text>
      </View>
    </View>
  );
}

/**
 * LEARNED THIS WEEK — one number, then the words on one line.
 *
 * The first version was chips: one pill per word with its gloss inside,
 * "+N more", and the glue folded into a "+2 small words · aquí, me" pill.
 * Radek, on device: "super chaotic, I don't read anything from it". He was
 * right — four kinds of pill and two type sizes for what is a count and a
 * list. So: the count in the same big figure the Today and Review cards
 * use, the words as a single sentence in mint, and one quiet all-time line
 * with two numbers. Content words come first and the glue ("me", "de")
 * trails, still in the list — it was earned — but not called out.
 *
 * "Learned" is still core's isLearned (right on two different days), and
 * the empty state says so, because a user who sees a smaller number than
 * last update deserves to know why.
 */
function LearnedCard({
  week,
  onTheWay,
  allTime,
}: {
  week: SavedWord[];
  /** Saved, not yet learned, not slipped — the pipeline. */
  onTheWay: number;
  allTime: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const { content, small } = splitFunctionWords(week);
  const ordered = [...content, ...small];
  const shown = showAll ? ordered : ordered.slice(0, LEARNED_PREVIEW);
  const hidden = ordered.length - shown.length;

  return (
    <View style={styles.card}>
      {week.length === 0 ? (
        <>
          <Text style={styles.learnedEmptyTitle}>Nothing learned yet this week</Text>
          <Text style={styles.cardBody}>
            Get a word right on two different days and it lands here.
            {onTheWay > 0 ? ` ${onTheWay} on the way.` : ''}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.bigNumber}>
            {week.length}
            <Text style={styles.bigNumberUnit}>
              {' '}
              {week.length === 1 ? 'word' : 'words'} learned
            </Text>
          </Text>
          <Text style={styles.learnedWords}>
            {shown.map((w) => w.text).join(' · ')}
            {hidden > 0 && (
              <Text
                style={styles.learnedMore}
                onPress={() => setShowAll(true)}
                accessibilityRole="button"
              >
                {'  '}+{hidden} more
              </Text>
            )}
          </Text>
        </>
      )}
      <View style={styles.allTimeRow}>
        <Text style={styles.allTime}>
          All time · <Text style={styles.allTimeStrong}>{allTime}</Text> learned ·{' '}
          <Text style={styles.allTimeStrong}>{onTheWay}</Text> on the way
        </Text>
      </View>
    </View>
  );
}

/**
 * LEVEL — one row, the ladder on request.
 *
 * The six-tier ladder used to take a third of the screen for a number that
 * both real users maxed inside two weeks. The current tier and its meter
 * are what a returning user looks for; the whole ladder is a tap away, so
 * the names (which teach — they are real Spanish) are not lost.
 */
function LevelSection({ levelState }: { levelState: LevelState }) {
  const [showLadder, setShowLadder] = useState(false);
  const atTop = levelState.level >= TIERS.length;
  const tier = tierFor(levelState.level);

  return (
    <View style={styles.section}>
      <SectionTitle>Level</SectionTitle>
      <View style={[styles.card, styles.tierCurrent]}>
        <View style={styles.tierHead}>
          <View style={[styles.tierBadge, styles.tierBadgeCurrent]}>
            <Text style={[styles.tierBadgeText, styles.tierBadgeTextCurrent]}>●</Text>
          </View>
          <View style={styles.tierText}>
            <Text style={styles.tierName}>{tier.name}</Text>
            <Text style={styles.tierMeaning}>“{tier.meaning}”</Text>
          </View>
          <Text style={styles.tierHintInline}>
            {atTop ? 'Top of the ladder' : `${levelState.meter}% → ${tierFor(levelState.level + 1).name}`}
          </Text>
        </View>
        <View style={styles.meterTrack}>
          <View style={[styles.meterFill, { width: `${levelState.meter}%` }]} />
        </View>
        <Pressable
          onPress={() => setShowLadder((shown) => !shown)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showLadder }}
          hitSlop={8}
          style={({ pressed }) => [styles.ladderToggle, pressed && styles.pressed]}
        >
          <Text style={styles.ladderToggleText}>
            {showLadder ? 'Hide the ladder' : 'See all six levels'}
          </Text>
        </Pressable>
      </View>

      {showLadder &&
        TIERS.map((entry) => {
          const current = entry.level === levelState.level;
          const achieved = entry.level < levelState.level;
          return (
            <View key={entry.level} style={[styles.tier, current && styles.tierRowCurrent]}>
              <View style={styles.tierHead}>
                <View
                  style={[
                    styles.tierBadge,
                    current && styles.tierBadgeCurrent,
                    achieved && styles.tierBadgeDone,
                  ]}
                >
                  <Text
                    style={[
                      styles.tierBadgeText,
                      current && styles.tierBadgeTextCurrent,
                      achieved && styles.tierBadgeTextDone,
                    ]}
                  >
                    {achieved ? '✓' : current ? '●' : '🔒'}
                  </Text>
                </View>
                <View style={styles.tierText}>
                  <Text style={[styles.tierName, !current && !achieved && styles.tierLocked]}>
                    {entry.name}
                  </Text>
                  <Text style={styles.tierMeaning}>“{entry.meaning}”</Text>
                </View>
              </View>
            </View>
          );
        })}
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
}: {
  active: boolean;
  onGoToFeed: () => void;
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
  const [levelState, setLevelState] = useState<LevelState>(() =>
    storage.getLevelState()
  );
  /** Read on the way in, like everything else: the answer can only change
      by re-running onboarding, which reloads the app. */
  const [plan, setPlan] = useState<Plan>(getPlan);
  const [now, setNow] = useState(() => Date.now());
  /** The review picker's window — see ReviewPicker for why it is the only
      thing this screen presents, and why nothing navigates while it is up. */
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setWords(storage.getSavedWords());
      setWatchedIds(storage.getWatchedVideoIds());
      setRecallDays(storage.getCorrectRecallDays());
      setDailyCounts(storage.getDailyCorrect());
      setLevelState(storage.getLevelState());
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

  // Nothing this screen presents may outlive a tab switch — the same
  // backstop the Words tab keeps for its window (VocabScreen).
  useEffect(() => {
    if (!active) setPicker(false);
  }, [active]);

  /**
   * The honest totals. `learned` is core's isLearned over DISTINCT words —
   * not `state === 'known'`, which counted starter grants and one-shot
   * fills, and not rows, which counted "de" three times. `learning` is the
   * pipeline: saved, not yet learned, not slipped. ("Times remembered",
   * the sum of every correct answer, used to sit beside them; nobody could
   * say what it meant, so it went with the chips.)
   */
  const totals = useMemo(() => {
    const distinct = distinctWords(words);
    let learned = 0;
    let learning = 0;
    for (const w of distinct) {
      if (isLearned(w)) learned++;
      else if (w.state === 'learning' || w.state === 'new') learning++;
    }
    return { learned, learning };
  }, [words]);

  const due = useMemo(() => dueCount(words, now), [words, now]);
  const nextDue = useMemo(() => nextDueAt(words, now), [words, now]);
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

  /**
   * THE REVIEW BUTTONS ASK WHICH WORD, THEN LAND ON IT. Both of them —
   * Today's and the Reviews card's — open the picker; the launch runs from
   * its onLaunch, AFTER the window is gone (never in the same commit as the
   * tab switch — the frozen-tab lesson from the Words screen). A chosen word
   * goes through launchReviewOfWord, "most urgent" through launchReview: the
   * same launchers the Words tab and the reminder tap use. The old
   * startReview here armed recall and switched tab, which with RECALL_ENABLED
   * true opened a random video.
   */
  const startReview = () => setPicker(true);
  const dueWords = useMemo(
    () =>
      words
        .filter((w) => w.dueAt <= now)
        .sort(
          (a, b) =>
            Number(b.state === 'lapsed') - Number(a.state === 'lapsed') ||
            a.dueAt - b.dueAt
        ),
    [words, now]
  );
  const launch = (word: SavedWord | null) => {
    if (word) launchReviewOfWord(word, 'progress');
    else launchReview('progress');
    onGoToFeed();
  };

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
            {/* 1 — today: the goal, and the one thing to do next */}
            <View style={styles.section}>
              <SectionTitle>Today</SectionTitle>
              <TodayCard
                plan={plan}
                count={todayCount}
                due={due}
                onReview={startReview}
                onFeed={onGoToFeed}
              />
            </View>

            {/* 2 — this week: the streak and the strip, against the plan */}
            <View style={styles.section}>
              <SectionTitle>This week</SectionTitle>
              <WeekCard streaks={streaks} week={week} plan={plan} />
            </View>

            {/* 3 — learned this week: the words, not a list of rows */}
            <View style={styles.section}>
              <SectionTitle>Learned this week</SectionTitle>
              <LearnedCard
                week={learnedWeek}
                onTheWay={totals.learning}
                allTime={totals.learned}
              />
            </View>

            {/* 4 — reviews */}
            <View style={styles.section}>
              <SectionTitle>Ready to review</SectionTitle>
              <View style={[styles.card, due > 0 && styles.cardAccent]}>
                {due > 0 ? (
                  <>
                    <Text style={styles.bigNumber}>
                      {due}{' '}
                      <Text style={styles.bigNumberUnit}>
                        {due === 1 ? 'word' : 'words'} ready
                      </Text>
                    </Text>
                    <Text style={styles.cardBody}>
                      Pick one and the feed opens just before it. The rest
                      follow as blanks while you watch.
                    </Text>
                    <Pressable
                      onPress={startReview}
                      accessibilityRole="button"
                      accessibilityHint="Choose a word, then the feed opens on it"
                      style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                    >
                      <Text style={styles.ctaText}>Review</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.cardBody}>
                    {nextDue === null
                      ? 'Nothing scheduled yet — save a word to start.'
                      : `All caught up. Next review ${formatDue(nextDue, now)}.`}
                  </Text>
                )}
              </View>
            </View>

            {/* 5 — level: one row, the ladder on request */}
            <LevelSection levelState={levelState} />

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
        <NotificationsSection />

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

      {/* ONE WINDOW, outside the scroll. Its `open` drops from onLaunch or a
          dismissal — never from a tap directly — so a review can never fire
          into a window that is still being torn down. */}
      <ReviewPicker
        open={picker}
        words={dueWords}
        onClose={() => setPicker(false)}
        onLaunch={launch}
      />
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
