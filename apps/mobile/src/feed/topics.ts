import { storageDriver } from '../platform/storage';

/**
 * THE TOPICS THE USER LIKES WATCHING (onboarding 'topics' step; Radek,
 * 2026-10-06). The feed leans toward them (core feedRank: 2 of every 5 videos) and
 * still shows everything else. Ids match scripts/tag-topics.mts TOPIC_IDS.
 */
const KEY = 'loro.mobile.topics';

const listeners = new Set<() => void>();

export function setLikedTopics(ids: string[]): void {
  try {
    storageDriver.local.setItem(KEY, JSON.stringify(ids));
  } catch {}
  for (const l of listeners) l();
}

/** The feed listens, so a change made in Settings re-ranks the reels. */
export function subscribeToLikedTopics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Always an array; anything unreadable is "no preference" — a plain ranked feed. */
export function getLikedTopics(): string[] {
  try {
    const raw = storageDriver.local.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
