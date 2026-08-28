import { storage } from '@loro/core/storage';
import { DUE_NOW_STAGGER_MS, WALKTHROUGH } from './taste';
import { olog } from './flow';

/**
 * The walkthrough's one side effect, kept out of the component.
 *
 * THE USER SAVES THE WORD THE NORMAL WAY. They tap it, the real word sheet
 * opens with the real gloss and the real Save button, and storage.saveWord does
 * the write — the sheet is a large part of what this screen is demonstrating,
 * and a guided run that replaced it with its own card would be showing people
 * something the app does not do.
 *
 * ALL THIS DOES IS MOVE THE DUE DATE. A normal save schedules into box 0, a ONE
 * MINUTE interval, so the word is not reviewable until long after the user has
 * scrolled to clip 2 and core's blank planner declines to place it. That is
 * correct for the real feed and useless for a demonstration compressed into
 * ninety seconds.
 *
 * saveWordAtBox computes `dueAt = now + BOX_INTERVALS_MS[box] + staggerMs` and
 * nothing clamps the stagger, so passing box 0's own interval back as a
 * negative number lands dueAt exactly on `now`. The word is then due, and
 * core's `first` path (locateAsked) places it at its earliest cue in the next
 * video, exempt from the per-video caps.
 *
 * NOTHING ABOUT THE WORD IS FAKE. It is a real entry in the real SRS, saved
 * from a real video with a real gloss, and answering its blank grades it
 * through the same code a review does on day three. The only thing the script
 * changes is WHEN it first comes due.
 *
 * Source is 'user', not 'deck': the user tapped it. That matters beyond
 * bookkeeping — 'deck' words are excluded from the free-tier ceiling and the
 * account prompt (storage.ts), and a word someone chose must not quietly dodge
 * either.
 */
export function makeDueNow(text: string, videoId: string): boolean {
  const existing = storage
    .getSavedWords()
    .find((w) => w.text === text && w.videoId === videoId);
  if (!existing) return false;
  // Already reviewable: nothing to do, and nothing to churn in the sync queue.
  if (existing.dueAt <= Date.now()) return true;

  /**
   * REMOVE AND RE-ADD, because there is no reschedule.
   *
   * saveWordAtBox refuses to touch a word that already exists (it returns ok
   * and keeps the original schedule, which is the right answer for the starter
   * deck it was written for), and gradeWord only moves a word along the ladder
   * — correct sends it to box 1 and ten minutes away, which is further from due
   * rather than closer. So the only way to change a due date through the public
   * API is to write the entry again.
   *
   * Every field is carried over from the entry the sheet just wrote, including
   * `source`, so the word that ends up on disk is byte-identical to a normal
   * save apart from `dueAt`. In particular it stays 'user', which is what keeps
   * it counting toward the free-tier ceiling and the account prompt — a coached
   * word must not quietly dodge either.
   */
  storage.removeWord(text, videoId);
  const { ok } = storage.saveWordAtBox(
    {
      text: existing.text,
      translation: existing.translation,
      videoId: existing.videoId,
      cueIndex: existing.cueIndex,
    },
    0,
    DUE_NOW_STAGGER_MS,
    existing.source
  );
  olog(`walkthrough: "${text}" rescheduled to due now, ok=${ok}`);
  return ok;
}

/** The app's normalizeSurface, for the dictionary lookup only. */
function normalizeForDictionary(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^a-z0-9áéíóúüñ]+|[^a-z0-9áéíóúüñ]+$/g, '');
}

/** Is this the word the script asked for? Accent- and case-insensitive. */
export function isScriptedWord(text: string): boolean {
  const flat = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ]/g, '');
  return flat(text) === flat(WALKTHROUGH.word);
}
