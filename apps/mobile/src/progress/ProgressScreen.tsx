import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  DevSettings,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SavedWord, Video, WordState } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { getCatalog } from '@loro/core/catalog';
import { formatDue } from '@loro/core/srs';
import { computeStreaks, dueCount, nextDueAt } from '@loro/core/progress';
import { enableRecallForSession } from '../feed/recall';
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
import { TIERS, tierFor, type LevelState } from '@loro/core/levels';

/**
 * PROGRESS — port of the web's app/progress/page.tsx. Read-only throughout.
 *
 * Five sections, in the web's order: the headline metrics, the tier ladder,
 * the streak, reviews, and words/videos.
 *
 * EXPECT EMPTY PANELS, AND THAT IS HONEST RATHER THAN BROKEN. Three of the
 * four data sources only fill once other things run:
 *   savedWords   real today — checkpoint E's save works
 *   watchedIds   fills from markWatched on slide activation (added with this
 *                checkpoint; empty until you actually watch something)
 *   recallDays   only once RECALL_ENABLED grading has run
 *   levelState   default 1/0 unless a tier was hand-seeded or LEVELS_ENABLED
 *                grading has run
 * Nothing here fabricates a placeholder to fill the space.
 */

/** The four word states, as the web's segmented bar orders them. */
const STATE_SEGMENTS: { state: WordState; label: string; color: string }[] = [
  { state: 'lapsed', label: 'Lapsed', color: '#f87171' },
  { state: 'new', label: 'New', color: 'rgba(255,255,255,0.25)' },
  { state: 'learning', label: 'Learning', color: 'rgba(242,245,243,0.55)' },
  { state: 'known', label: 'Known', color: '#5ee6a8' },
];

/** How many answered words show before "See all". */
const CORRECT_PREVIEW = 3;

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
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

function MetricCard({
  value,
  label,
  hero,
}: {
  value: number;
  label: string;
  hero?: boolean;
}) {
  return (
    <View style={[styles.metric, hero && styles.metricHero]}>
      <Text style={[styles.metricValue, hero && styles.metricValueHero]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
  const [levelState, setLevelState] = useState<LevelState>(() =>
    storage.getLevelState()
  );
  /** Collapsed to CORRECT_PREVIEW until asked — see the section itself. */
  const [showAllCorrect, setShowAllCorrect] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => {
      setWords(storage.getSavedWords());
      setWatchedIds(storage.getWatchedVideoIds());
      setRecallDays(storage.getCorrectRecallDays());
      setLevelState(storage.getLevelState());
    };
    refresh();
    setNow(Date.now());
    // onWordsChanged covers saved words, the watch log, recall days and the
    // level meter — core lists all four as its watched keys (storage.ts).
    const unsub = storage.onWordsChanged(refresh);
    if (!active) return unsub;
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearInterval(tick);
      unsub();
    };
  }, [active]);

  // The honest headline numbers — every one only goes up as you learn.
  const totals = useMemo(() => {
    let learned = 0;
    let learning = 0;
    let recalls = 0;
    for (const w of words) {
      if (w.state === 'known') learned++;
      else if (w.state === 'learning') learning++;
      recalls += w.correct;
    }
    return { learned, learning, recalls };
  }, [words]);

  const stateCounts = useMemo(() => {
    const counts = { lapsed: 0, new: 0, learning: 0, known: 0 };
    for (const w of words) counts[w.state]++;
    return counts;
  }, [words]);

  /**
   * The words you have actually answered correctly, freshest first.
   *
   * `correct > 0` IS THE WHOLE TEST, and it is deliberately not "came from a
   * blue blank". A level fill and a green recall review both land in the same
   * SavedWord with the same counter (storage.saveLevelWord / gradeWord), and
   * nothing on the row records which flow produced it. Inventing a
   * distinction the data does not carry would mean guessing from box/state
   * shape — box 4 + state 'known' + correct 1 is what a correct level fill
   * looks like, but it is also what a tapped word looks like after it has
   * been reviewed up the ladder. So this is honestly "words you got right",
   * which is what it says, rather than a claim it cannot support.
   *
   * lastReviewedAt is non-null for anything with correct > 0 — it is written
   * in the same branch as the counter — but it is typed nullable, so the
   * coalesce is for the type rather than for a case that occurs.
   */
  const correctWords = useMemo(
    () =>
      words
        .filter((w) => w.correct > 0)
        .sort((a, b) => (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0)),
    [words]
  );

  const due = useMemo(() => dueCount(words, now), [words, now]);
  const nextDue = useMemo(() => nextDueAt(words, now), [words, now]);
  const streaks = useMemo(() => computeStreaks(recallDays, now), [recallDays, now]);

  /**
   * Per video: how many words saved, how many learned, most-engaged first.
   *
   * ONE DELIBERATE DEVIATION FROM THE WEB: it maps the WHOLE catalog and
   * renders every row, including the 200-odd videos with nothing saved. That is
   * fine for a DOM list on a desktop and is not fine here — 200+ rows with
   * remote thumbnails inside a ScrollView would jank the tab. Only videos the
   * user has actually engaged with are rendered. The arithmetic is unchanged.
   */
  const videoRows = useMemo(() => {
    const byVideo = new Map<string, { saved: number; learned: number }>();
    for (const w of words) {
      const e = byVideo.get(w.videoId) ?? { saved: 0, learned: 0 };
      e.saved++;
      if (w.state === 'known') e.learned++;
      byVideo.set(w.videoId, e);
    }
    const rows: { video: Video; saved: number; learned: number }[] = [];
    for (const video of getCatalog()) {
      const e = byVideo.get(video.id);
      if (!e) continue;
      rows.push({ video, saved: e.saved, learned: e.learned });
    }
    return rows.sort((a, b) => b.saved - a.saved);
  }, [words]);

  /** Same entry point as /vocab's — arms recall, then switches tab. A Review
      button that only changes screen is the bug this fixes. */
  const startReview = () => {
    enableRecallForSession();
    onGoToFeed();
  };

  const empty = words.length === 0 && watchedIds.length === 0;
  const atTop = levelState.level >= TIERS.length;

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
            {/* 1 — the headline numbers */}
            <View style={styles.metrics}>
              <MetricCard value={totals.learned} label="Words learned" hero />
              <MetricCard value={totals.learning} label="Learning" />
              <MetricCard value={totals.recalls} label="Times remembered" />
            </View>

            {/* 2 — the tier ladder: all six, current highlighted with the meter
                inside it, achieved below, locked above. Names are Spanish on
                purpose — the ladder itself teaches. */}
            <View style={styles.section}>
              <SectionTitle>Level</SectionTitle>
              {TIERS.map((tier) => {
                const current = tier.level === levelState.level;
                const achieved = tier.level < levelState.level;
                return (
                  <View
                    key={tier.level}
                    style={[styles.tier, current && styles.tierCurrent]}
                  >
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
                        <Text
                          style={[styles.tierName, !current && !achieved && styles.tierLocked]}
                        >
                          {tier.name}
                        </Text>
                        <Text style={styles.tierMeaning}>“{tier.meaning}”</Text>
                      </View>
                    </View>
                    {current && (
                      <View style={styles.meterTrack}>
                        <View
                          style={[styles.meterFill, { width: `${levelState.meter}%` }]}
                        />
                      </View>
                    )}
                    {current && (
                      <Text style={styles.tierHint}>
                        {atTop
                          ? 'Top of the ladder.'
                          : `${levelState.meter}% toward ${tierFor(levelState.level + 1).name}`}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>

            {/* 2b — what the ladder above was actually built out of.
                Directly under Level on purpose: the meter is a number you
                climbed, and this is the evidence. A tier that moved with
                nothing to show for it reads as a score; the words are what
                make it a record. */}
            {correctWords.length > 0 && (
              <View style={styles.section}>
                <SectionTitle>Words you got right</SectionTitle>
                {/*
                  THREE, THEN THE REST ON REQUEST. The list is unbounded — it
                  grows with every correct fill and every review — and this
                  screen is a ScrollView with five other sections under it, so
                  rendering all of them would push Streak, Reviews, Words and
                  Videos off the bottom for anyone who has been using the app.
                  Three is enough to show the shape and recognise the last
                  thing answered without displacing what follows.
                */}
                {(showAllCorrect
                  ? correctWords
                  : correctWords.slice(0, CORRECT_PREVIEW)
                ).map((word) => (
                  // text+videoId is core's own dedupe key for a saved word
                  // (storage.saveWord), so it is unique by construction here.
                  <View key={`${word.videoId}:${word.text}`} style={styles.correctRow}>
                    <View style={styles.correctCheck}>
                      <Text style={styles.correctCheckText}>✓</Text>
                    </View>
                    <View style={styles.correctText}>
                      <Text style={styles.correctWord} numberOfLines={1}>
                        {word.text}
                      </Text>
                      <Text style={styles.correctGloss} numberOfLines={1}>
                        {word.translation}
                      </Text>
                    </View>
                    {/* Only once it means something. "x1" on every row is
                        noise; a repeat is the interesting case. */}
                    {word.correct > 1 && (
                      <Text style={styles.correctCount}>×{word.correct}</Text>
                    )}
                  </View>
                ))}
                {correctWords.length > CORRECT_PREVIEW && (
                  <Pressable
                    onPress={() => setShowAllCorrect((shown) => !shown)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showAllCorrect }}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.seeAll,
                      pressed && styles.seeAllPressed,
                    ]}
                  >
                    <Text style={styles.seeAllText}>
                      {showAllCorrect
                        ? 'Show fewer'
                        : `See all ${correctWords.length}`}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* 3 — streak: consecutive days with a correct recall */}
            <View style={styles.section}>
              <SectionTitle>Streak</SectionTitle>
              <View style={styles.card}>
                {streaks.current > 0 ? (
                  <>
                    <Text style={styles.bigNumber}>
                      {streaks.current}{' '}
                      <Text style={styles.bigNumberUnit}>
                        {streaks.current === 1 ? 'day' : 'days'}
                      </Text>
                    </Text>
                    <Text style={styles.cardBody}>
                      of correct recalls in a row
                    </Text>
                  </>
                ) : (
                  <Text style={styles.cardBody}>
                    No streak right now. One correct recall starts one.
                  </Text>
                )}
                <Text style={styles.cardFoot}>Longest: {streaks.longest}</Text>
              </View>
            </View>

            {/* 4 — reviews */}
            <View style={styles.section}>
              <SectionTitle>Reviews</SectionTitle>
              <View style={[styles.card, due > 0 && styles.cardAccent]}>
                {due > 0 ? (
                  <>
                    <Text style={styles.bigNumber}>
                      {due} <Text style={styles.bigNumberUnit}>{due === 1 ? 'word' : 'words'} due</Text>
                    </Text>
                    <Text style={styles.cardBody}>
                      They&apos;ll appear as blanks while you watch.
                    </Text>
                    <Pressable
                      onPress={startReview}
                      accessibilityRole="button"
                      accessibilityHint="Opens the feed with your due words armed as blanks"
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

            {/* 5 — words, as a segmented bar by state */}
            <View style={styles.section}>
              <SectionTitle>Words</SectionTitle>
              <View style={styles.card}>
                <View style={styles.bar}>
                  {STATE_SEGMENTS.filter((s) => stateCounts[s.state] > 0).map((s) => (
                    <View
                      key={s.state}
                      style={{
                        backgroundColor: s.color,
                        flex: stateCounts[s.state],
                        height: '100%',
                      }}
                    />
                  ))}
                </View>
                <View style={styles.legend}>
                  {STATE_SEGMENTS.map((s) => (
                    <View key={s.state} style={styles.legendItem}>
                      <View
                        style={[styles.legendDot, { backgroundColor: s.color }]}
                      />
                      <Text style={styles.legendText}>
                        {stateCounts[s.state]} {s.label.toLowerCase()}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            {/* 6 — videos: saved vs learned per video, most-engaged first */}
            {videoRows.length > 0 && (
              <View style={styles.section}>
                <SectionTitle>Videos</SectionTitle>
                {videoRows.map(({ video, saved, learned }) => (
                  <View key={video.id} style={styles.videoRow}>
                    <Image
                      source={{ uri: video.poster }}
                      style={styles.thumb}
                      resizeMode="cover"
                    />
                    <View style={styles.videoText}>
                      <Text style={styles.videoTitle} numberOfLines={1}>
                        {video.creator}
                      </Text>
                      <Text style={styles.videoMeta}>
                        {saved} saved · {learned} learned
                      </Text>
                    </View>
                    <Text style={styles.videoLevel}>{video.level}</Text>
                  </View>
                ))}
              </View>
            )}

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
  metrics: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  metric: {
    backgroundColor: '#141a17',
    borderRadius: 16,
    flex: 1,
    padding: 14,
  },
  metricHero: {
    backgroundColor: 'rgba(94,230,168,0.12)',
    borderColor: 'rgba(94,230,168,0.25)',
    borderWidth: 1,
  },
  metricValue: { color: '#f2f5f3', fontSize: 22, fontWeight: '800' },
  metricValueHero: { color: '#5ee6a8' },
  metricLabel: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  signIn: { marginTop: 4 },
  deleteAccount: { marginTop: 12 },
  legal: { marginTop: 20 },
  section: { marginBottom: 22 },
  sectionTitle: {
    color: 'rgba(242,245,243,0.5)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  /** One answered word. Same 16-radius card family as `tier` above, at row
      scale, so the two read as one column rather than two treatments. */
  correctRow: {
    alignItems: 'center',
    backgroundColor: '#141a17',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  correctCheck: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.16)',
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  correctCheckText: { color: '#5ee6a8', fontSize: 12, fontWeight: '800' },
  /** flex:1 is what makes numberOfLines bite — without it the text sizes to
      content and a long gloss pushes the count off the row instead of
      ellipsising. */
  correctText: { flex: 1 },
  correctWord: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  correctGloss: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 12,
    marginTop: 1,
  },
  correctCount: {
    color: 'rgba(94,230,168,0.8)',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  seeAll: {
    alignItems: 'center',
    borderColor: 'rgba(242,245,243,0.14)',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 2,
    paddingVertical: 10,
  },
  seeAllPressed: { backgroundColor: 'rgba(242,245,243,0.06)' },
  seeAllText: {
    color: 'rgba(242,245,243,0.75)',
    fontSize: 13,
    fontWeight: '700',
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
  bigNumber: { color: '#f2f5f3', fontSize: 24, fontWeight: '800' },
  bigNumberUnit: { fontSize: 15, fontWeight: '700' },
  tier: {
    backgroundColor: '#141a17',
    borderRadius: 16,
    marginBottom: 6,
    padding: 12,
  },
  tierCurrent: {
    backgroundColor: 'rgba(87,179,242,0.12)',
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
  meterTrack: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    height: 5,
    marginTop: 10,
    overflow: 'hidden',
  },
  meterFill: { backgroundColor: '#57b3f2', height: '100%' },
  tierHint: {
    color: 'rgba(87,179,242,0.85)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
  },
  bar: { borderRadius: 999, flexDirection: 'row', gap: 1, height: 10, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  legendDot: { borderRadius: 999, height: 7, width: 7 },
  legendText: { color: 'rgba(242,245,243,0.6)', fontSize: 12 },
  videoRow: {
    alignItems: 'center',
    backgroundColor: '#141a17',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
    padding: 8,
  },
  thumb: { backgroundColor: '#000', borderRadius: 8, height: 44, width: 44 },
  videoText: { flex: 1 },
  videoTitle: { color: '#f2f5f3', fontSize: 14, fontWeight: '600' },
  videoMeta: { color: 'rgba(242,245,243,0.5)', fontSize: 12, marginTop: 1 },
  videoLevel: {
    backgroundColor: 'rgba(94,230,168,0.16)',
    borderRadius: 6,
    color: '#5ee6a8',
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
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
  pressed: { opacity: 0.7 },
});
