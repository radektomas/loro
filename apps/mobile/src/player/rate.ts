import { mmkv } from '../platform/storage';

/**
 * The standing playback-rate preference.
 *
 * TWO LAYERS, THE SAME SHAPE AS THE SOUND PREFERENCE. core's sound state reads
 * a session value first and falls back to a persisted standing choice
 * (storage.ts getSessionUnmuted); this mirrors it, because a speed choice has
 * the same lifetime semantics — it should hold for the whole session the moment
 * you pick it, and still be there next launch.
 *
 * It lives here rather than in core because core is out of scope for this
 * change, and because nothing on the web has a speed control to share it with
 * yet. If one lands, this is the thing to move.
 *
 * THE KEY IS INSIDE THE 'loro.' NAMESPACE, deliberately and unlike the catalog
 * scalars. That prefix is what the account-deletion sweep walks, and a speed
 * preference IS user data — a device handed to someone else should not still be
 * playing at 0.5×. The catalog keys sit outside the sweep because they describe
 * public content and a file on disk; this describes a person.
 */
const KEY = 'loro.playbackRate';

/** What the player runs at unless told otherwise. */
export const DEFAULT_RATE = 1;

/**
 * The session layer. A module variable rather than the driver's session map
 * because this is read on the render path of every slide's band and a Map
 * lookup per render buys nothing over a closure variable.
 *
 * Undefined means "not chosen this session" — the persisted value answers.
 * Note this is NOT the same as the player's ACTUAL rate, which only the page
 * can report; this is only ever the user's intent.
 */
let sessionRate: number | undefined;

function readPersisted(): number {
  const raw = mmkv.getString(KEY);
  if (raw === undefined) return DEFAULT_RATE;
  const parsed = Number(raw);
  // A corrupt or absurd value must not be able to freeze the feed at 0.01×.
  // The page validates independently, but a bad value should never leave here.
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 4) return DEFAULT_RATE;
  return parsed;
}

/** The user's standing choice: this session's if there is one, else the disk's. */
export function getStoredRate(): number {
  return sessionRate ?? readPersisted();
}

/**
 * Record a deliberate choice. Both layers, always — the session layer so the
 * rest of this session agrees without a re-read, the persisted layer so the
 * next launch does.
 *
 * Deliberately does NOT talk to the player. The caller sends the command and
 * the page reports back what actually happened; writing the intent here and
 * reading the truth from the bridge is the same split the sound pill uses.
 */
export function setStoredRate(rate: number): void {
  sessionRate = rate;
  try {
    mmkv.set(KEY, String(rate));
  } catch (error) {
    // A failed write costs the preference at next launch and nothing else —
    // the session layer above still holds for the rest of this run.
    console.warn(`[loro] could not persist playback rate: ${String(error)}`);
  }
}
