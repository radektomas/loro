/**
 * Starter-deck instrumentation — pure event model and merge rules.
 *
 * The deck is the first thing a from-zero user ever does, and it is the one
 * screen where we cannot guess at the failure mode: a user who leaves after
 * card five tells us the deck is too long, one who leaves after the first clip
 * tells us the payoff missed, and one who answers nine cards and skips the
 * last clip tells us something else again. Per-round, per-card-index events are
 * the only way to tell those apart, so every card, clip and round boundary is
 * logged — including for anonymous users, who are the overwhelming majority of
 * everyone who will ever see this screen.
 *
 * Anonymous-first, exactly like saved words: localStorage is the truth,
 * storage.ts appends synchronously, and a sign-in merges the log into
 * loro_profiles.starter_deck_events. Persistence and transport live there; this
 * module stays pure so the rules below are unit-testable.
 *
 * EVERY EVENT CARRIES A CLIENT-GENERATED id. That is what makes the sign-in
 * merge idempotent: the merge is a union keyed on the id, so pushing the same
 * local batch twice — a retried flush, a second tab, a device that re-merges
 * what it already sent — cannot duplicate a row, and a second device's log adds
 * to the first instead of racing it. Identity deliberately does NOT come from
 * (name, round, card, at): two devices CAN land the same card in the same
 * millisecond, and a legitimate re-show of a card is a real second event that a
 * content-keyed merge would silently swallow.
 */

export type StarterEventName =
  /** A word card took the screen. */
  | 'card_shown'
  /** The user answered a word card (know / don't know). */
  | 'card_answered'
  /** The round's clip began playing. */
  | 'clip_started'
  /** The clip reached its end (or the user tapped past a stalled one). */
  | 'clip_completed'
  /** The round's clip and its post-clip beat are done. */
  | 'round_completed'
  /** The user left the deck early, from wherever they were. */
  | 'skipped';

export type StarterEvent = {
  /**
   * Stable identity, generated on this device when the event is created (see
   * storage.ts newStarterEventId). Never derived from the payload, never
   * reassigned — the merge's idempotence rests entirely on it.
   */
  id: string;
  name: StarterEventName;
  /** 1-based round number. 0 for events outside any round. */
  round: number;
  /** 1-based card index WITHIN the round, or null for clip/round events.
      'skipped' carries the card the user was looking at, when they were on
      one — that pair (round, card) is the drop-off point. */
  card: number | null;
  /** epoch ms */
  at: number;
  /** card_answered only: what the user claimed. */
  knewIt?: boolean;
  /** clip_started / clip_completed: which clip. */
  videoId?: string;
  /** card_answered only: which word, so a single badly-glossed card can be
      told apart from a badly-placed one. */
  word?: string;
  /** How many cards this round has — 2 when the catalog forced a short round,
      so a short round is never read as a card-3 drop-off. */
  cards?: number;
  /**
   * clip_completed only: did playback actually reach the end of the ROUND, or
   * did the user tap past a clip that never played (blocked autoplay, Low Power
   * Mode, no network)? Without this a stalled clip reads as a watched one and
   * the payoff looks like it landed when nobody saw it.
   *
   * "End of the round" is StarterRound.payoffEnd — PAYOFF_TAIL_S after the last
   * target word is spoken — NOT the end of the transcript, which is what this
   * meant before the deck stopped requiring a full playthrough. Every card has
   * lit up by then, so it still means "the payoff landed"; it no longer means
   * the user saw the whole clip.
   */
  played?: boolean;
};

/**
 * Hard cap on the stored log.
 *
 * Overflow DROPS NEW EVENTS rather than evicting old ones. The measurement
 * that matters is the first run through the deck — the onboarding funnel — and
 * a ring buffer would be exactly the wrong way round: any later re-entry from
 * /profile would push the funnel out. The cap is ~8 full runs, so hitting it
 * at all means something is looping, which is another reason not to let it
 * overwrite the signal.
 */
export const MAX_STARTER_EVENTS = 200;

/**
 * Append unless the log is full, or the event repeats the one before it.
 *
 * Returns the same array when nothing changed, so callers can skip a pointless
 * write.
 *
 * THE DUPLICATE GUARD is about React, not about users: effects re-run, and a
 * remount would log "card_shown r1 c1" a second time, inflating the top of the
 * funnel — the very number every later drop-off rate is divided by. Only the
 * IMMEDIATELY preceding event is compared, so a card genuinely shown again
 * after something else intervened still records.
 */
export function appendStarterEvent(
  events: readonly StarterEvent[],
  event: StarterEvent,
  max: number = MAX_STARTER_EVENTS
): StarterEvent[] {
  const last = events[events.length - 1];
  if (
    last &&
    last.name === event.name &&
    last.round === event.round &&
    last.card === event.card
  ) {
    return events as StarterEvent[];
  }
  if (events.length >= max) return events as StarterEvent[];
  return [...events, event];
}

/**
 * Identity of an event for the merge: its id, nothing else.
 *
 * The fallback covers a log written before ids existed (an unreleased build's
 * localStorage) and reproduces the old content key, so those entries dedupe
 * rather than doubling on every sign-in.
 */
function eventKey(e: StarterEvent): string {
  return e.id
    ? `id:${e.id}`
    : `legacy:${e.name} ${e.round} ${e.card ?? -1} ${e.at}`;
}

/**
 * Union two logs, oldest first.
 *
 * A UNION, never a replace: the log is a measurement, and a second device
 * signing in must add its funnel rather than overwrite the first device's.
 * (This is where starter events differ from loro_profiles.save_prompt_stats,
 * which is a small fixed record and can be pushed blind.)
 *
 * IDEMPOTENT by id, which is the property the whole sign-in path rests on:
 * merge(merge(local, remote), local) equals merge(local, remote). A retried
 * push, a second tab, or a device that re-merges its own log changes nothing.
 * FIRST WRITER WINS for a repeated id, so re-merging cannot swap a stored event
 * for a later copy of itself — that is what makes the merge a fixed point
 * rather than merely duplicate-free.
 *
 * Ties on `at` break by id, so the order is deterministic rather than an
 * artifact of the input order — two events in the same millisecond is routine
 * (a card answered and the next card shown).
 */
export function mergeStarterEvents(
  a: readonly StarterEvent[],
  b: readonly StarterEvent[],
  max: number = MAX_STARTER_EVENTS
): StarterEvent[] {
  const byKey = new Map<string, StarterEvent>();
  for (const e of [...a, ...b]) {
    const key = eventKey(e);
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return [...byKey.values()]
    .sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, max);
}

/** Drop anything that isn't a well-formed event — the stored value is JSON
    from an older build or another device, never trusted shape. */
export function parseStarterEvents(raw: unknown): StarterEvent[] {
  if (!Array.isArray(raw)) return [];
  const names = new Set<string>([
    'card_shown',
    'card_answered',
    'clip_started',
    'clip_completed',
    'round_completed',
    'skipped',
  ]);
  const out: StarterEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Partial<StarterEvent>;
    if (typeof e.name !== 'string' || !names.has(e.name)) continue;
    if (typeof e.round !== 'number' || typeof e.at !== 'number') continue;
    out.push({
      // An entry with no id keeps '' and merges on the legacy content key.
      // Never synthesised here: a fabricated id would look stable and would
      // then differ between two devices parsing the same row.
      id: typeof e.id === 'string' ? e.id : '',
      name: e.name as StarterEventName,
      round: e.round,
      card: typeof e.card === 'number' ? e.card : null,
      at: e.at,
      ...(typeof e.knewIt === 'boolean' ? { knewIt: e.knewIt } : {}),
      ...(typeof e.videoId === 'string' ? { videoId: e.videoId } : {}),
      ...(typeof e.word === 'string' ? { word: e.word } : {}),
      ...(typeof e.cards === 'number' ? { cards: e.cards } : {}),
      ...(typeof e.played === 'boolean' ? { played: e.played } : {}),
    });
  }
  return out;
}
