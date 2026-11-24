import type { SavedWord } from '@loro/core/types';
import { normalizeSurface } from '@loro/core/dictionary';

/**
 * WHERE A WORD IS ON ITS WAY BACK — the line under an open word on the road.
 * The feed asks it when it is due and a video says it (core computeBlankPlan),
 * so the honest phrasing is about videos, never about this tab. A word no
 * video says (`spoken`, occurrences.spokenSurfacesCached) never comes back
 * there, and says so instead of promising it.
 */
export function whereItIs(word: SavedWord, now: number, spoken: ReadonlySet<string>): string {
  if (!spoken.has(normalizeSurface(word.text))) return 'Not in a video yet';
  if (word.state === 'lapsed') return word.dueAt <= now ? 'Missed · in your videos now' : 'Missed · back soon';
  if (word.dueAt <= now) return 'In your videos now';
  const mins = Math.round((word.dueAt - now) / 60_000);
  if (mins < 60) return `Back in ${Math.max(1, mins)} min`;
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const days = Math.floor((word.dueAt - midnight.getTime()) / 86_400_000) + 1;
  if (days <= 0) return 'Back later today';
  if (days === 1) return 'Back tomorrow';
  return `Back in ${days} days`;
}
