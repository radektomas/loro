import { REELS, findCollection } from '@loro/core/collections';
import { storageDriver } from '../platform/storage';

/**
 * WHICH SHELF THE FEED IS ON — remembered across launches, announced to the
 * feed. A module bus like reviewTarget.ts: written by the chip row, read by
 * FeedScreen, nobody else re-renders for it.
 */
const KEY = 'loro.mobile.collection';

const listeners = new Set<(id: string) => void>();

export function getCollection(): string {
  const raw = storageDriver.local.getItem(KEY);
  // findCollection falls back to reels for an id that no longer exists.
  return raw ? findCollection(raw).id : REELS;
}

export function setCollection(id: string): void {
  const next = findCollection(id).id;
  if (next === getCollection()) return;
  storageDriver.local.setItem(KEY, next);
  console.log(`[loro:feed] collection -> ${next}`);
  for (const l of listeners) l(next);
}

export function subscribeToCollection(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
