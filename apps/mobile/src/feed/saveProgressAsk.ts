import { getSession } from '@loro/core/auth';
import { sessionPromptVariant } from '@loro/core/savePrompt';
import { storage } from '@loro/core/storage';
import { authEnabled } from '../platform/supabaseInit';
import { storageDriver } from '../platform/storage';

/**
 * The session-complete "save your progress" ask — decision plumbing only, the
 * exact shape of the notification explainer's (notifications.ts): a module
 * owns the snooze + once-per-process latch and a subscribe/raise pair; the
 * card (SessionSavePrompt.tsx) subscribes; RecallHost owns the timing because
 * "after the celebration" is a fact about the feed's animation.
 *
 * THE RULES ARE NOT HERE. core's sessionPromptVariant decides (savePrompt.ts
 * documents the three-moment policy); this module only feeds it the device
 * facts it cannot know: the snooze timestamp and the process latch.
 *
 * "Not now" writes ONLY the device snooze — it never records a 'dismissed'
 * outcome. The vocab card stays the one surface that burns the two-ask
 * budget; this moment borrows the prompt records for measurement
 * (recordSavePromptShown is idempotent per prompt) without spending them.
 */

/** Device-local, under loro. so the account-deletion prefix wipe takes it —
    prompt state should die with the user's other data. The '.mobile.' segment
    flags that core does not know this key (same convention as notif keys). */
const SNOOZE_KEY = 'loro.mobile.savePrompt.snoozedAt';

/** Once per process at most — the sheet is a moment, not a queue. */
let promptedThisSession = false;

export type SessionSavePromptRaise = { variant: 1 | 2; words: number };

const listeners = new Set<(raise: SessionSavePromptRaise) => void>();

export function subscribeToSessionSavePrompt(
  listener: (raise: SessionSavePromptRaise) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** "Not now". Quiet for SESSION_PROMPT_SNOOZE_MS (7 days). */
export function snoozeSessionSavePrompt(): void {
  storageDriver.local.setItem(SNOOZE_KEY, String(Date.now()));
}

function readSnoozedAt(): number | null {
  const raw = storageDriver.local.getItem(SNOOZE_KEY);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Called by RecallHost once the celebration has finished after the grade that
 * emptied the due queue. Raises the card if core says this is a moment worth
 * asking in; returns whether it raised, so the caller can let the
 * notification explainer have the moment instead.
 */
export async function maybeAskToSaveProgress(): Promise<boolean> {
  // No Supabase configured -> the card could not sign anyone in. Same guard
  // SavePromptCard runs before deciding.
  if (!authEnabled) return false;
  const session = await getSession();
  const variant = sessionPromptVariant(storage.getSavePromptState(), {
    signedIn: session !== null,
    snoozedAt: readSnoozedAt(),
    shownThisSession: promptedThisSession,
    now: Date.now(),
  });
  if (variant === null) return false;
  promptedThisSession = true;
  // The measurement payload rides the same two prompt records the vocab card
  // uses; idempotent, keeps the first exposure (storage.ts). Conversion is
  // flipped by syncSavePrompt when a session arrives — never here.
  const words = storage.getCountedSavedWords();
  storage.recordSavePromptShown(variant, words);
  for (const listener of listeners) listener({ variant, words });
  return true;
}
