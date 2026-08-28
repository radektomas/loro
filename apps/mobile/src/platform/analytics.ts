import Constants from 'expo-constants';
import { AppState, type AppStateStatus } from 'react-native';
import { getSupabase } from '@loro/core/supabase';
import { getSession, onAuthChange } from '@loro/core/auth';
import { EAS_BUILD_PROFILE } from './config';
import { platformCrypto } from './crypto';
import { mmkv } from './storage';

/**
 * Product analytics: the funnel this app could not previously see.
 *
 * WHAT WAS MISSING AND WHY. Everything the app knew about itself lived either
 * in RevenueCat (a purchase happened) or in loro_progress (a SIGNED-IN user
 * watched a video). Neither can answer the questions the paywall actually
 * raises — how far into onboarding people get, how many reach the wall, and
 * what the ones who do not buy do instead — because the hard paywall means a
 * user can install, run the whole of onboarding, look at the price and leave
 * without ever creating an account for those tables to key on. This module
 * writes the missing half: an append-only event log keyed on an install, not
 * a person. See migration 20260826000000_analytics_events.sql.
 *
 * THE THREE RULES THIS FILE OBEYS, in priority order:
 *
 *   1. IT MAY NEVER BREAK THE APP. Every public entry point swallows its own
 *      errors and returns void. Analytics is the least important code in the
 *      binary and must behave like it: a Supabase outage, a full disk or a
 *      malformed prop degrades to "we lost some numbers", never to a red
 *      screen or a blocked render. Nothing here is awaited by a caller.
 *   2. IT MAY NEVER BLOCK A FRAME. track() does one MMKV write and returns;
 *      the network happens on a timer, on backgrounding, or when the buffer
 *      fills. No screen waits on a flush, including the paywall.
 *   3. IT COLLECTS NO DEVICE IDENTIFIER. Not the IDFA, not identifierForVendor.
 *      The subject is `installId`, a uuid this file mints on first launch and
 *      keeps in MMKV. Reinstalling makes a new one, which undercounts
 *      retention on purpose — that is the price of not reading an id the OS
 *      considers personal, and it keeps the App Store privacy answer to
 *      "Product Interaction, not linked to identity, not used for tracking".
 *
 * ON `loro.` — THE PREFIX IS LOAD-BEARING. Both keys below sit inside the
 * sweep that account deletion and switch-user already walk (storage.ts
 * clearByPrefix). Deleting your account therefore also retires your install
 * pseudonym, and the events already sent go on standing as anonymous counts
 * because their user_id FK is ON DELETE SET NULL. That is the same posture the
 * shared project's own analytics_events takes, and the reason
 * accountDeletion.ts can treat this table as non-blocking.
 */

const INSTALL_ID_KEY = 'loro.analytics.installId';
const QUEUE_KEY = 'loro.analytics.queue';

/**
 * The ingest RPC — NOT a table write, and the difference is load-bearing.
 *
 * The obvious implementation is
 * `.from('loro_analytics_events').upsert(batch, { ignoreDuplicates: true })`,
 * which is what this file did first and what fails 100% of the time. supabase-js
 * turns that into `Prefer: resolution=ignore-duplicates`, and PostgREST's
 * upsert path is refused by RLS unless the table also has an UPDATE policy —
 * verified live against this project with the anon key: a plain insert returns
 * 201, the identical insert with that header returns 42501 "new row violates
 * row-level security policy". The table must never have an UPDATE policy (it
 * is an append-only log), so the ON CONFLICT moved server-side into a
 * SECURITY DEFINER function instead. See migration 20260826010000.
 *
 * That also removes user_id from this client's hands entirely: the function
 * stamps auth.uid() and ignores whatever the payload claims.
 */
const INGEST_FN = 'loro_analytics_ingest';

/** Flush triggers. The interval is the floor; a full buffer or a
    backgrounding both pre-empt it, and backgrounding is the one that matters
    on iOS, where a suspended app is routinely killed without warning. */
const FLUSH_INTERVAL_MS = 20_000;
const FLUSH_AT_SIZE = 20;
/** One request's worth. Larger batches are split across calls. */
const MAX_BATCH = 100;
/**
 * The queue's hard ceiling, oldest dropped first.
 *
 * A device that is offline for a week, or one whose project is misconfigured
 * so every flush 404s, must not grow an unbounded MMKV value — that turns a
 * missing table into a storage leak on a stranger's phone. Losing the oldest
 * events is the right sacrifice: the newest are the ones still describing a
 * session anybody will look at.
 */
const MAX_QUEUED = 500;

// ------------------------------------------------------------------- events

/**
 * The event vocabulary, closed on purpose.
 *
 * A union rather than `string` because the SQL reports match these names
 * literally (loro_analytics_funnel's stages are hardcoded to them). A typo in
 * a call site would otherwise be a row that lands in the table, satisfies
 * every constraint, and is silently absent from every chart — the single most
 * expensive failure mode an analytics layer has, because it looks like the
 * users did not do the thing.
 */
export type EventName =
  // lifecycle
  | 'app_install'          // first launch on this device, ever. Once per install.
  | 'app_open'             // every launch, including the one that installs.
  // onboarding
  | 'onboarding_step'      // { step, index } — one per screen ARRIVED at
  | 'onboarding_completed' // reached the end, or skipped from inside it
  | 'taste_shown'          // { clips } — the guided reel before the wall
  | 'taste_word_saved'     // { word, scripted } — the coached tap landed
  | 'taste_outro'          // reached the closing card
  // the wall
  | 'paywall_shown'        // the gate rendered PaywallScreen
  | 'paywall_offerings_failed'
  | 'purchase_started'     // tapped subscribe; the Apple sheet is up
  | 'purchase_completed'
  | 'purchase_cancelled'   // dismissed the Apple sheet
  | 'purchase_failed'
  | 'restore_succeeded'
  | 'restore_empty'
  | 'restore_failed'
  // the app itself
  | 'video_watched';

type Props = Record<string, string | number | boolean | null | undefined>;

type QueuedEvent = {
  id: string;
  install_id: string;
  session_id: string;
  user_id: string | null;
  name: EventName;
  props: Props;
  at: string;
  platform: 'ios';
  app_version: string | null;
  build_profile: string | null;
};

// -------------------------------------------------------------- identifiers

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A string Postgres will accept in a `uuid` column. THIS WRAPPER IS NOT
 * DEFENSIVE PROGRAMMING — it closes a real hole.
 *
 * core's platformCrypto.randomUUID() promises UNIQUENESS, not uuid SHAPE: its
 * documented contract is "opaque merge keys, never parsed", and two of its
 * three tiers keep that promise while breaking this one — the middle tier
 * returns 32 undashed hex characters, and the last resort returns
 * `<base36>-<base36>`. Both are fine for the starter-deck log they were
 * written for, which stores them in jsonb.
 *
 * Here the ids land in `uuid` COLUMNS, and the failure is not a lost row: a
 * malformed id makes Postgres reject the ENTIRE insert, the batch stays queued
 * because a failed flush is a no-op, and every subsequent event piles up
 * behind a head batch that can never succeed. One bad id would silently end
 * analytics for that install, permanently — on exactly the stale-binary and
 * Expo Go builds where the fallbacks trigger.
 *
 * So: take whatever entropy the seam produced, keep it, and force it into
 * shape. Math.random only ever pads what is missing.
 */
function uuid(): string {
  const raw = platformCrypto.randomUUID();
  if (UUID_RE.test(raw)) return raw;
  const hex =
    raw.replace(/[^0-9a-f]/gi, '').toLowerCase() +
    Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  const h = hex.slice(0, 32);
  // Version 4, RFC-4122 variant. The version/variant nibbles are fixed rather
  // than borrowed from the entropy so the result is a well-formed v4 and not
  // merely uuid-shaped.
  const variant = '89ab'[Math.floor(Math.random() * 4)];
  return (
    `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-` +
    `${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
  );
}

/**
 * This launch. In memory only — a new process is a new session, which is
 * exactly the granularity "did they leave the paywall" needs: a session that
 * contains paywall_shown and no purchase_* is a bounce, with no heartbeat or
 * timeout heuristic required.
 */
const SESSION_ID = uuid();

/** Set by ensureInstallId() when it mints rather than reads — the signal that
    this launch is an install, consumed once by initAnalytics(). */
let mintedThisLaunch = false;

function ensureInstallId(): string | null {
  try {
    const existing = mmkv.getString(INSTALL_ID_KEY);
    if (existing) return existing;
    const minted = uuid();
    mmkv.set(INSTALL_ID_KEY, minted);
    mintedThisLaunch = true;
    return minted;
  } catch {
    // MMKV threw (full disk). Analytics is not worth a crash; the caller
    // treats null as "not configured" and drops the event.
    return null;
  }
}

const APP_VERSION: string | null =
  typeof Constants.expoConfig?.version === 'string'
    ? Constants.expoConfig.version
    : null;

// ------------------------------------------------------------------- queue
//
// The queue is persisted on EVERY enqueue rather than only at flush time.
// iOS kills suspended apps without running any JS, so an in-memory-only buffer
// loses whatever a user did in their last session before the timer fired —
// and the last session is disproportionately the interesting one, because it
// is the session where they gave up. One MMKV write per event is the cost of
// not having that hole; at this app's volumes it is unmeasurable.

function readQueue(): QueuedEvent[] {
  try {
    const raw = mmkv.getString(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedEvent[]) : [];
  } catch {
    // Corrupt value: drop it rather than let every future write fail on it.
    return [];
  }
}

function writeQueue(events: QueuedEvent[]): void {
  try {
    mmkv.set(QUEUE_KEY, JSON.stringify(events.slice(-MAX_QUEUED)));
  } catch {
    // Nothing to do — the events stay only in whatever the caller holds.
  }
}

// ------------------------------------------------------------------ sending

let flushing = false;
let timer: ReturnType<typeof setInterval> | null = null;
/** Consecutive failed flushes — the poison-batch valve, see flush(). */
let failures = 0;
const MAX_FAILURES = 5;

/**
 * Ship what is queued.
 *
 * SUCCESS IS MEASURED BY REMOVAL, NOT BY THE RESPONSE. The rows that went out
 * are removed from the queue by id AFTER the insert returns clean, and the
 * queue is re-read at that moment rather than captured before the request —
 * events tracked WHILE the request was in flight must survive, and a naive
 * `writeQueue([])` would eat them.
 *
 * A FAILED FLUSH IS A NO-OP, NOT A LOSS. Anything that errors stays queued and
 * is retried at the next trigger. That makes delivery at-least-once, which is
 * why every row carries a client-minted `id` and the insert uses
 * ignoreDuplicates: a batch that actually landed but whose response was lost
 * to a dropped connection is replayed harmlessly instead of double-counting a
 * purchase.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  const supabase = getSupabase();
  if (!supabase) return; // unconfigured: the app runs anonymously, as designed

  const pending = readQueue();
  if (pending.length === 0) return;

  flushing = true;
  try {
    const batch = pending.slice(0, MAX_BATCH);
    const { error } = await supabase.rpc(INGEST_FN, { p_events: batch });

    if (error) {
      // Left queued deliberately. The error worth reading here is a missing
      // function (PGRST202) or a missing table: both mean a migration has not
      // been applied, and every install is silently buffering into its
      // 500-event ceiling while looking perfectly healthy.
      console.warn(`[loro] analytics flush failed: ${error.message}`);
      failures += 1;
      /**
       * THE POISON-BATCH VALVE. Retrying forever is right for a network
       * failure and catastrophically wrong for a permanent rejection: one row
       * the server will never accept (a constraint tightened later, an event
       * name over 64 characters) wedges the head of the queue and everything
       * behind it, for the life of the install.
       *
       * Rather than guess which errors are permanent from their codes — which
       * vary by PostgREST version and would fail open in the wrong direction —
       * five consecutive failures drop the OLDEST event and let the batch
       * reform. A transient outage costs at most a handful of events; a poison
       * row costs one, and the queue drains again.
       */
      if (failures >= MAX_FAILURES) {
        const [dropped, ...rest] = readQueue();
        if (dropped) {
          console.warn(
            `[loro] analytics dropping a stuck event (${dropped.name}) after ${failures} failed flushes`
          );
          writeQueue(rest);
        }
        failures = 0;
      }
      return;
    }

    failures = 0;
    const sent = new Set(batch.map((e) => e.id));
    writeQueue(readQueue().filter((e) => !sent.has(e.id)));
  } catch (err) {
    console.warn('[loro] analytics flush threw', err);
  } finally {
    flushing = false;
  }
}

// ----------------------------------------------------------------- tracking

/**
 * The signed-in user, cached synchronously so track() never has to await.
 *
 * getSession() is async, and making every call site await it would push
 * analytics into the render path — rule 2. Instead the auth bus keeps this
 * mirror current (initAnalytics subscribes), and an event tracked in the
 * moments before the first session resolves simply carries a null user_id.
 * That is the correct answer far more often than it is a miss: onboarding and
 * the paywall both run before anyone signs in, and for most installs nobody
 * ever does.
 */
let currentUserId: string | null = null;

/**
 * Record one event. Fire and forget — never awaited, never throws.
 *
 * Undefined props are stripped rather than serialized to null, so an optional
 * field that was not available reads as absent in the jsonb instead of as a
 * measured null.
 */
export function track(name: EventName, props: Props = {}): void {
  try {
    const installId = ensureInstallId();
    if (!installId) return;

    const clean: Props = {};
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) clean[key] = value;
    }

    const event: QueuedEvent = {
      id: uuid(),
      install_id: installId,
      session_id: SESSION_ID,
      // Sent for the on-device record only. The server DISCARDS this and
      // stamps auth.uid() itself, so it cannot be used to attribute an event
      // to anyone else — and an event queued while signed in still lands
      // correctly if it flushes after a sign-out.
      user_id: currentUserId,
      name,
      props: clean,
      at: new Date().toISOString(),
      platform: 'ios',
      app_version: APP_VERSION,
      build_profile: EAS_BUILD_PROFILE,
    };

    const queued = [...readQueue(), event];
    writeQueue(queued);
    if (queued.length >= FLUSH_AT_SIZE) void flush();
  } catch {
    // Rule 1. An analytics call is never the reason a screen fails to render.
  }
}

/** Keys already tracked this process — see trackOnce. Session-scoped, so a
    cold start legitimately counts the same video again. */
const seenThisSession = new Set<string>();

/**
 * track(), but at most once per key for the life of this launch.
 *
 * Exists for the feed, where the natural call site fires on every slide
 * ACTIVATION: swiping down and back up re-activates a slide, and a fast scroll
 * through ten videos activates all ten. Counting those raw would make "videos
 * watched" a measure of thumb speed. Deduping per session turns it into
 * distinct videos reached in this sitting, which is the number that means what
 * the dashboard says it means.
 */
export function trackOnce(key: string, name: EventName, props: Props = {}): void {
  if (seenThisSession.has(key)) return;
  seenThisSession.add(key);
  track(name, props);
}

// -------------------------------------------------------------------- boot

let started = false;

/**
 * Start the pump and record the launch. Called from boot.ts at module scope,
 * beside the other seams, so the install/open pair is written before React
 * renders a frame and cannot be lost to a screen that never mounts.
 *
 * app_install is emitted only on the launch that MINTED the id, and always
 * immediately before app_open, so the very first row for any install is the
 * install itself — which is what makes min(received_at) a trustworthy
 * birthday for the cohort queries.
 */
export function initAnalytics(): void {
  if (started) return;
  started = true;

  try {
    ensureInstallId();
    if (mintedThisLaunch) track('app_install');
    track('app_open');

    // Mirror the auth bus. Both the initial read and later changes: a session
    // restored from MMKV lands through getSession, sign-in and sign-out
    // through the listener.
    void getSession()
      .then((session) => {
        currentUserId = session?.user?.id ?? null;
      })
      .catch(() => {
        currentUserId = null;
      });
    onAuthChange((session) => {
      currentUserId = session?.user?.id ?? null;
    });

    timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);

    /**
     * Backgrounding is the important trigger, not the timer.
     *
     * 'inactive' is included with 'background' because on iOS a swipe-up to
     * the app switcher reports inactive first, and an app killed from that
     * state never sees 'background' at all. Flushing twice is free (the
     * second finds an empty queue, and duplicates are ignored server-side);
     * missing the last flush before a kill is not.
     */
    AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') void flush();
    });

    // Ship whatever the previous session could not.
    void flush();
  } catch (err) {
    console.warn('[loro] analytics init failed', err);
  }
}

/** Test/dev affordance: stop the timer. Production never calls this — App
    never unmounts. */
export function stopAnalytics(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
