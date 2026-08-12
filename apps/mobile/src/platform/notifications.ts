import { AppState, Linking } from 'react-native';
import type * as NotificationsApi from 'expo-notifications';
import { storage } from '@loro/core/storage';
import { computeStreaks, dayKey, dueCount } from '@loro/core/progress';
import { storageDriver } from './storage';

/**
 * THE ONLY MODULE THAT TOUCHES expo-notifications. Nothing else imports it.
 *
 * That is the whole design rule, and it exists because notification bugs are
 * invisible: a stray schedule call somewhere else does not throw, it just
 * quietly adds a duplicate that fires next to the real one. Everything below
 * routes through ONE reconcile(), which cancels everything and rebuilds the
 * schedule from current state, so duplicates cannot accumulate no matter how
 * many times anything calls it.
 *
 * ⚠️ NATIVE MODULE, AND THIS FILE IS LOAD-BEARING FOR SOMETHING THAT IS NOT
 * NOTIFICATIONS. RecallHost imports it to mark a completed day, so anything
 * that throws here takes GRADING down with it: the user answers a blank
 * correctly and the app breaks. That is a far worse outcome than a missing
 * reminder, and it is why every native call below is behind the seam guard
 * rather than called directly. A binary without the native module logs one
 * warning and runs with no notifications. Rebuild to actually get them.
 *
 * WHAT IS SCHEDULED, and it is exactly two things:
 *
 *   daily reminder   a repeating DAILY trigger at the user's chosen time,
 *                    default 19:00. Streak-aware copy when the streak is worth
 *                    mentioning, generic otherwise.
 *   at-risk nudge    a ONE-SHOT DATE trigger at 20:30, armed only for a day
 *                    that has not been completed yet.
 *
 * WHY THE AT-RISK ONE IS NOT A REPEATING TRIGGER, since that is the obvious
 * shape and it is wrong. A local notification's content and its firing
 * condition are both fixed when it is scheduled; iOS cannot ask "has today been
 * completed?" at fire time. A repeating 20:30 trigger would therefore fire on
 * days the user had already practised, which is the exact nag this app should
 * never send. So it is armed one day at a time and re-armed by reconcile(),
 * which runs on foreground, on boot, and when learning data changes.
 *
 * THE SAME CONSTRAINT APPLIES TO COPY. The streak count in the daily reminder
 * is baked in at schedule time, so it goes stale unless something reschedules.
 * That something is reconcile() on the words-changed subscription.
 */

// ------------------------------------------------------------------ the seam

/** The module's value shape, for the lazily resolved instance below. */
type Seam = typeof import('expo-notifications');

/**
 * LAZY require RATHER THAN A STATIC import, and the difference is the whole
 * point of this block.
 *
 * A static `import * as Notifications from 'expo-notifications'` is hoisted, so
 * if the package throws while its own module body evaluates — which is what a
 * missing native module can do — the failure happens during THIS file's
 * evaluation, before any code here runs. Nothing in this module could catch it,
 * and it would propagate to every importer, RecallHost included. A literal
 * require inside a try is the same dependency edge as far as Metro's graph is
 * concerned, and it is catchable.
 *
 * Declared locally because this project has no @types/node, so `require` is
 * otherwise unknown to TypeScript (see the note in assets.d.ts).
 */
declare const require: (id: string) => unknown;

let seam: Seam | null = null;
let seamResolved = false;
let warned = false;

/**
 * ONE WARNING PER LAUNCH, and nothing user-facing.
 *
 * A person on a build without the native module cannot act on this, so a banner
 * or an error state would be noise at them about a decision they did not make.
 * The log line is for whoever is holding the device wondering why the reminder
 * never came.
 */
function warnUnavailable(reason: string): void {
  if (warned) return;
  warned = true;
  console.warn(
    `[loro:notif] notification seam unavailable, reminders are off for this ` +
      `launch (rebuild required?): ${reason}`
  );
}

function getSeam(): Seam | null {
  if (seamResolved) return seam;
  seamResolved = true;
  try {
    seam = require('expo-notifications') as Seam;
  } catch (error) {
    seam = null;
    warnUnavailable(String(error));
  }
  return seam;
}

/** Is there a working notifications module in this binary? Used by the settings
    section, which must not offer controls that cannot do anything. */
export function isNotificationSeamAvailable(): boolean {
  return getSeam() !== null;
}

/**
 * Every native call goes through here. Returns the fallback and warns once if
 * the seam is missing or the call throws, so no caller has to write its own
 * try/catch and no caller can forget to.
 */
async function withSeam<T>(label: string, run: (api: Seam) => Promise<T>, fallback: T): Promise<T> {
  const api = getSeam();
  if (!api) return fallback;
  try {
    return await run(api);
  } catch (error) {
    warnUnavailable(`${label} failed: ${String(error)}`);
    return fallback;
  }
}

// --------------------------------------------------------------- the handler

/**
 * Foreground presentation. Both banner and list are ON deliberately: with them
 * off, a notification that arrives while the app is open does nothing visible,
 * which makes the feature impossible to demonstrate and nearly impossible to
 * debug. shouldShowAlert is the deprecated spelling of the pair and is omitted.
 *
 * Module scope on purpose. This is a global registration and must be in place
 * before any notification can be delivered, which can be earlier than any
 * effect runs. Guarded like everything else: it subscribes to a native event
 * emitter, so it is a real throw site rather than a plain assignment.
 */
(() => {
  const api = getSeam();
  if (!api) return;
  try {
    api.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch (error) {
    warnUnavailable(`setNotificationHandler failed: ${String(error)}`);
  }
})();

// ------------------------------------------------------------------ the keys

/**
 * MOBILE-ONLY MMKV KEYS, under the 'loro.' namespace so the account-deletion
 * and switch-user sweeps take them (storageDriver.clearByPrefix callers). They
 * are a user preference and should die with the user's other data.
 *
 * The '.mobile.' segment says at a glance that core does not know about them,
 * the same convention onboarding's MOBILE_KEYS already uses (flow.ts).
 */
const KEYS = {
  enabled: 'loro.mobile.notif.enabled',
  hour: 'loro.mobile.notif.hour',
  minute: 'loro.mobile.notif.minute',
  /** When the user last said "Not now" to the in-app explainer. */
  snoozedAt: 'loro.mobile.notif.snoozedAt',
} as const;

/** The default reminder time. 19:00 is after work and before the evening is
    gone, and it is far enough from the 20:30 nudge to read as two separate
    thoughts rather than a double tap. */
const DEFAULT_HOUR = 19;
const DEFAULT_MINUTE = 0;

/** The at-risk nudge's time. Late enough to mean "still time today", early
    enough not to be the last thing before sleep. */
const AT_RISK_HOUR = 20;
const AT_RISK_MINUTE = 30;

/** How long "Not now" holds. The ask is cheap to repeat and expensive to get
    wrong, so a week is the floor rather than a target. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Trailing debounce on the words-changed path.
 *
 * Grading fires per WORD, and a review session grades several in a row. Without
 * this, each one would cancel and rebuild the whole schedule, which is a pile
 * of native calls for a result that only the last one determines.
 */
const WORDS_DEBOUNCE_MS = 3000;

/** Identifies our own notifications when one is tapped. */
type NotifRoute = 'review';

// ------------------------------------------------------------- preferences

export type NotificationPrefs = {
  enabled: boolean;
  hour: number;
  minute: number;
};

function readInt(key: string, fallback: number): number {
  const raw = storageDriver.local.getItem(key);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getPrefs(): NotificationPrefs {
  return {
    // Defaults to ON. The OS permission is the real gate, so an unset
    // preference means "as soon as they allow it, send them the reminder",
    // which is what someone who just tapped Allow expects.
    enabled: storageDriver.local.getItem(KEYS.enabled) !== '0',
    hour: readInt(KEYS.hour, DEFAULT_HOUR),
    minute: readInt(KEYS.minute, DEFAULT_MINUTE),
  };
}

export function setEnabled(enabled: boolean): void {
  storageDriver.local.setItem(KEYS.enabled, enabled ? '1' : '0');
  void reconcile();
}

export function setReminderTime(hour: number, minute: number): void {
  storageDriver.local.setItem(KEYS.hour, String(hour));
  storageDriver.local.setItem(KEYS.minute, String(minute));
  void reconcile();
}

/** "19:00", for display and for accessibility labels. */
export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// -------------------------------------------------------------- permission

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/**
 * FALLS BACK TO 'denied', NOT 'undetermined'. With no seam there is nothing to
 * ask, and 'undetermined' would let the explainer raise itself over the feed
 * offering a permission the build cannot request.
 */
export async function getPermissionState(): Promise<PermissionState> {
  return withSeam<PermissionState>(
    'getPermissionsAsync',
    async (api) => {
      const permissions = await api.getPermissionsAsync();
      if (permissions.granted) return 'granted';
      // 'undetermined' is the only state iOS will still show a system prompt
      // for. Anything else, including a provisional grant that was later
      // revoked, has to go through Settings.
      return permissions.status === 'undetermined' ? 'undetermined' : 'denied';
    },
    'denied'
  );
}

/**
 * The system prompt. ONLY ever called from the explainer sheet's Allow button.
 *
 * iOS gives exactly one chance at this per install: once denied, every later
 * requestPermissionsAsync resolves denied without showing anything. That is the
 * entire reason the in-app explainer exists and the entire reason this is not
 * called on launch.
 */
export async function requestPermission(): Promise<PermissionState> {
  await withSeam('requestPermissionsAsync', (api) => api.requestPermissionsAsync(), null);
  const state = await getPermissionState();
  await reconcile();
  return state;
}

/** "Not now". Holds the ask for SNOOZE_MS; the system prompt is never shown. */
export function snoozePermissionAsk(): void {
  storageDriver.local.setItem(KEYS.snoozedAt, String(Date.now()));
}

/** Opens iOS Settings for this app, the only route back from a denial. */
export function openSystemSettings(): void {
  void Linking.openSettings();
}

// -------------------------------------------------- the in-app explainer ask

const promptListeners = new Set<() => void>();

/**
 * Raised once per process at most. The sheet is a moment, not a queue: if the
 * user is looking at it and grades another word, a second raise would be a
 * flicker rather than a second chance.
 */
let promptedThisSession = false;

export function subscribeToPermissionPrompt(listener: () => void): () => void {
  promptListeners.add(listener);
  return () => promptListeners.delete(listener);
}

/**
 * Should we show the in-app explainer right now?
 *
 * The FIRST successful recall is the earliest this can return true, because the
 * only caller runs on a successful recall. That ordering is deliberate: asking
 * cold on launch, before the user has felt the thing the notification is for,
 * spends the one iOS prompt on someone with no reason to say yes.
 */
async function shouldAskForPermission(): Promise<boolean> {
  if (promptedThisSession) return false;
  if (!getPrefs().enabled) return false;
  const snoozedAt = readInt(KEYS.snoozedAt, 0);
  if (snoozedAt > 0 && Date.now() - snoozedAt < SNOOZE_MS) return false;
  return (await getPermissionState()) === 'undetermined';
}

/**
 * Called by the feed once the celebration has finished playing. Raises the
 * explainer if this is a moment worth asking in, and does nothing otherwise.
 *
 * THE CALLER OWNS THE TIMING, not this module. "After the celebration" is a
 * fact about the feed's animation, so RecallHost holds that delay; importing
 * CELEBRATE_MS into a platform seam would point the dependency the wrong way.
 */
export async function maybeAskForPermission(): Promise<void> {
  if (!(await shouldAskForPermission())) return;
  promptedThisSession = true;
  for (const listener of promptListeners) listener();
}

// ------------------------------------------------------------------- state

/**
 * HAS THE USER PRACTISED TODAY?
 *
 * ⚠️ DO NOT REACH FOR computeStreaks().current HERE. It is the obvious check
 * and it is wrong: `current` deliberately counts back from today OR YESTERDAY
 * so a streak is not reported broken before the day is over (progress.ts). So
 * on a day with no practice at all it still reads >= 1 right up to midnight,
 * and the at-risk nudge would be cancelled for exactly the users it exists for.
 *
 * Day-key membership is the only honest test. getCorrectRecallDays is also the
 * same list computeStreaks is built from, so the two can never disagree.
 */
function completedToday(): boolean {
  return storage.getCorrectRecallDays().includes(dayKey(Date.now()));
}

// -------------------------------------------------------------------- copy

/**
 * Which line of a pool to use today.
 *
 * Day-of-year rather than random: reconcile() runs many times a day and a
 * random pick would rewrite the pending notification's body on every one of
 * them. Deterministic per day means the copy is stable, testable, and still
 * different tomorrow.
 */
function variantFor(now: number, poolSize: number): number {
  const date = new Date(now);
  const yearStart = new Date(date.getFullYear(), 0, 1).getTime();
  const dayOfYear = Math.floor((date.getTime() - yearStart) / 86_400_000);
  return ((dayOfYear % poolSize) + poolSize) % poolSize;
}

/**
 * ENCOURAGING, NEVER GUILT-TRIPPING. A missed day resets the streak quietly and
 * nothing here says otherwise: no "don't lose it", no countdown, no warning
 * tone. The offer is always small, because the honest ask is small.
 *
 * No em dashes in any string below; they read as machine-written.
 */
const GENERIC_BODIES = [
  'A few minutes with real Spanish. Your words are waiting.',
  'Ready when you are. One short session is plenty.',
  'Your saved words are ready for another look.',
  'A few words of real Spanish, whenever it suits you.',
  'Time for a quick one. Nothing heavy.',
];

/** Only used when the streak is worth naming. See STREAK_MENTION_FLOOR. */
const STREAK_BODIES = [
  (n: number) => `${n} days in a row so far. A short session keeps it going.`,
  (n: number) => `You are on ${n} days. A few minutes is all it takes.`,
  (n: number) => `${n} day streak. Your words are ready when you are.`,
  (n: number) => `Day ${n + 1} is there for the taking. One short session.`,
  (n: number) => `${n} days and counting. Nice work. Ready for a few more?`,
];

const AT_RISK_BODIES = [
  'One correct word is all it takes to count today.',
  'A single word rounds off the day. That is the whole ask.',
  'There is still time for a quick one if you fancy it.',
  'Two minutes is plenty. One word will do it.',
];

/**
 * Below this the number is not worth saying. "1 day in a row" is not a streak,
 * it is a sentence about yesterday, and naming it makes the copy sound like it
 * is counting at the user rather than with them.
 */
const STREAK_MENTION_FLOOR = 2;

function buildDailyContent(now: number): NotificationsApi.NotificationContentInput {
  const words = storage.getSavedWords();
  const due = dueCount(words, now);
  const streak = computeStreaks(storage.getCorrectRecallDays(), now).current;

  const body =
    streak >= STREAK_MENTION_FLOOR
      ? STREAK_BODIES[variantFor(now, STREAK_BODIES.length)](streak)
      : GENERIC_BODIES[variantFor(now, GENERIC_BODIES.length)];

  return {
    title:
      due > 0
        ? `${due} ${due === 1 ? 'word' : 'words'} ready to review`
        : 'A few minutes of Spanish?',
    body,
    data: { route: 'review' satisfies NotifRoute },
  };
}

function buildAtRiskContent(now: number): NotificationsApi.NotificationContentInput {
  return {
    title: 'Still time today',
    body: AT_RISK_BODIES[variantFor(now, AT_RISK_BODIES.length)],
    data: { route: 'review' satisfies NotifRoute },
  };
}

// -------------------------------------------------------------- scheduling

/**
 * The next 20:30 that belongs to a day the user has not completed.
 *
 * Today's if today is still open and 20:30 has not passed; tomorrow's
 * otherwise, since tomorrow cannot be completed yet. Re-evaluated on every
 * reconcile, which is what keeps a one-shot behaving like a daily nudge without
 * ever firing on a day that was already earned.
 */
function nextAtRiskAt(now: number, isCompleted: boolean): Date {
  const date = new Date(now);
  const todayAt = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    AT_RISK_HOUR,
    AT_RISK_MINUTE,
    0,
    0
  );
  if (!isCompleted && todayAt.getTime() > now) return todayAt;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
    AT_RISK_HOUR,
    AT_RISK_MINUTE,
    0,
    0
  );
}

/**
 * Serialised, not merely awaited.
 *
 * reconcile() cancels everything and then reschedules, so two overlapping runs
 * can interleave into "cancel, cancel, schedule, schedule" and leave a
 * duplicate. Chaining every call onto the last one makes that impossible. The
 * catch keeps one failed run from poisoning every run after it.
 */
let chain: Promise<void> = Promise.resolve();

export function reconcile(): Promise<void> {
  chain = chain.catch(() => {}).then(runReconcile);
  return chain;
}

async function runReconcile(): Promise<void> {
  // withSeam swallows a missing module and a thrown call alike, so a scheduling
  // failure can never reach the caller. noteCorrectRecall runs inside grading,
  // and grading must survive anything this module does.
  await withSeam(
    'reconcile',
    async (api) => {
      // CANCEL EVERYTHING FIRST, ALWAYS, including when we are about to
      // schedule nothing. Turning the toggle off or losing permission has to
      // actually clear what is already queued in the OS.
      await api.cancelAllScheduledNotificationsAsync();

      const prefs = getPrefs();
      if (!prefs.enabled) return;
      if ((await getPermissionState()) !== 'granted') return;

      const now = Date.now();

      await api.scheduleNotificationAsync({
        content: buildDailyContent(now),
        trigger: {
          type: api.SchedulableTriggerInputTypes.DAILY,
          hour: prefs.hour,
          minute: prefs.minute,
        },
      });

      await api.scheduleNotificationAsync({
        content: buildAtRiskContent(now),
        trigger: {
          type: api.SchedulableTriggerInputTypes.DATE,
          date: nextAtRiskAt(now, completedToday()),
        },
      });
    },
    undefined
  );
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function reconcileSoon(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void reconcile();
  }, WORDS_DEBOUNCE_MS);
}

/**
 * A correct recall just landed.
 *
 * Reconciles IMMEDIATELY rather than through the debounce: today has just
 * become complete, and the at-risk nudge for today has to come off the queue
 * now, not three seconds from now. The debounced path still runs afterwards and
 * is harmless, being the same idempotent rebuild.
 */
export function noteCorrectRecall(): void {
  void reconcile();
}

// ----------------------------------------------------------- tap handling

let pendingRoute: NotifRoute | null = null;
const routeListeners = new Set<(route: NotifRoute) => void>();

/**
 * Deliver a tap, or park it.
 *
 * PARKING IS THE COLD-START CASE AND IT IS NOT AN EDGE ONE. Tapping a
 * notification for a killed app launches it, and the response is available
 * before React has mounted anything. There is also no navigator to be "ready":
 * Shell is a hand-rolled useState tab switcher, and during onboarding it is not
 * even rendered (Onboarding renders instead of Shell). So a route with no
 * listener waits here until one subscribes.
 */
function deliverRoute(route: NotifRoute): void {
  if (routeListeners.size === 0) {
    pendingRoute = route;
    return;
  }
  for (const listener of routeListeners) listener(route);
}

/**
 * Subscribing DRAINS a parked route, which is what makes the cold-start path
 * work with no extra call at the subscriber's end.
 */
export function subscribeToNotificationRoute(
  listener: (route: NotifRoute) => void
): () => void {
  routeListeners.add(listener);
  if (pendingRoute !== null) {
    const route = pendingRoute;
    pendingRoute = null;
    listener(route);
  }
  return () => routeListeners.delete(listener);
}

function routeFromResponse(
  response: NotificationsApi.NotificationResponse | null
): void {
  const data = response?.notification.request.content.data;
  if (data && (data as { route?: string }).route === 'review') {
    deliverRoute('review');
  }
}

// -------------------------------------------------------------------- init

let initialised = false;

/**
 * Wire the listeners and take the first reading. Called from finishBoot, i.e.
 * once there is something on screen.
 *
 * NOT AT MODULE SCOPE, unlike the handler above, and the split is deliberate.
 * The handler is a pure global registration with no dependencies. Everything
 * here reads MMKV through core, so it has to run after initPlatform has filled
 * the storage seam (boot.ts). finishBoot is the same slot refreshCatalog uses,
 * for the same reason: it is real background work, and nothing on screen is
 * waiting for it.
 */
export function initNotifications(): void {
  if (initialised) return;
  initialised = true;

  // No seam means no listeners worth registering and nothing to reconcile.
  // getSeam has already warned by this point.
  const api = getSeam();
  if (!api) return;

  // A tap that launched the app from cold. Read once; expo keeps returning the
  // same response, so re-reading later would re-route on every call.
  void withSeam(
    'getLastNotificationResponseAsync',
    (seamApi) => seamApi.getLastNotificationResponseAsync().then(routeFromResponse),
    undefined
  );

  try {
    api.addNotificationResponseReceivedListener(routeFromResponse);
  } catch (error) {
    warnUnavailable(`addNotificationResponseReceivedListener failed: ${String(error)}`);
  }

  // FOREGROUND IS THE RE-ARM SIGNAL. The at-risk nudge is a one-shot for one
  // day, and the daily reminder's streak copy goes stale, so both need a
  // regular rebuild. Every visit to the app is one.
  AppState.addEventListener('change', (next) => {
    if (next === 'active') void reconcile();
  });

  // Learning data changed: a graded word, a save, a level fill. Debounced,
  // because a review session fires this once per word.
  storage.onWordsChanged(reconcileSoon);

  void reconcile();
}

// --------------------------------------------------------------------- dev

/**
 * DEV ONLY, and kept on purpose: this is how the feature gets filmed.
 *
 * It builds its content through buildDailyContent, so what appears on camera is
 * byte-for-byte what a real 19:00 reminder looks like, including the streak
 * line and the due count. A hand-written "test" string would be the one thing
 * on screen that is not the product.
 *
 * Five seconds is long enough to background the app and catch the banner on the
 * lock screen, which is the shot worth having.
 */
export async function sendTestNotification(): Promise<void> {
  await withSeam(
    'sendTestNotification',
    async (api) => {
      await api.scheduleNotificationAsync({
        content: buildDailyContent(Date.now()),
        trigger: {
          type: api.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
          repeats: false,
        },
      });
    },
    undefined
  );
}
