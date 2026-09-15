import { storage } from '@loro/core/storage';
import { distinctWords, isLearned } from '@loro/core/progress';
import { TIER_LEARNED, TIERS, tierForLearned, type LearnedTier } from '@loro/core/levels';
import { track } from '../platform/analytics';
import { storageDriver } from '../platform/storage';

/**
 * THE LEVEL-UP — a card the moment the learned-word ladder is climbed.
 *
 * Radek, 2026-09-15: "when you hit a level up it should give you a modal
 * about it, on every level". The ladder is words learned (core
 * tierForLearned), so the moment is the correct answer that makes the
 * 25th / 75th / 150th / 300th / 600th distinct word learned. This keeps
 * the last tier the user has been SHOWN and raises once per crossing.
 *
 * The seen tier is written on Shell mount for an install that has never
 * had it (a user already at Turista must not get a Turista card on their
 * next answer), and by the raise. A tier crossed by a sync from another
 * device is shown on the next answer here, which is a fine time for it.
 */
const SEEN_KEY = 'loro.mobile.tierSeen';

export type LevelUpRaise = LearnedTier;

const listeners = new Set<(raise: LevelUpRaise) => void>();

function learnedCount(): number {
  let n = 0;
  for (const w of distinctWords(storage.getSavedWords())) if (isLearned(w)) n++;
  return n;
}

function seenTier(): number | null {
  const raw = storageDriver.local.getItem(SEEN_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) ? n : null;
}

/** Shell mount: silently adopt the current tier if none was ever recorded. */
export function initLevelUp(): void {
  if (seenTier() !== null) return;
  storageDriver.local.setItem(SEEN_KEY, String(tierForLearned(learnedCount()).tier.level));
}

/** After a grade. Raises the card if the ladder was climbed; returns whether. */
export function maybeLevelUp(): boolean {
  const now = tierForLearned(learnedCount());
  const seen = seenTier() ?? 1;
  if (now.tier.level <= seen) return false;
  storageDriver.local.setItem(SEEN_KEY, String(now.tier.level));
  track('level_up', { tier: now.tier.level, name: now.tier.name, learned: now.have });
  console.log(`[loro:level] up to ${now.tier.name} at ${now.have} words`);
  for (const l of listeners) l(now);
  return true;
}

export function subscribeToLevelUp(listener: (raise: LevelUpRaise) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The words needed for the tier after this one, for the card's line. */
export function nextThreshold(raise: LevelUpRaise): number | null {
  const i = TIERS.findIndex((t) => t.level === raise.tier.level);
  return i >= 0 && i + 1 < TIER_LEARNED.length ? TIER_LEARNED[i + 1] : null;
}

/** DEV: raise the card for a given tier, with made-up numbers. */
export function devRaiseLevelUp(level: number): void {
  const i = Math.min(TIERS.length, Math.max(1, level)) - 1;
  const raise = tierForLearned(TIER_LEARNED[i]);
  for (const l of listeners) l(raise);
}
