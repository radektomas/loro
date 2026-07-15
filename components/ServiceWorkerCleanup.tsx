'use client';

import { useEffect } from 'react';

/**
 * One-shot cleanup for the retired PWA service worker.
 *
 * Loro no longer ships a service worker (there's no offline use case and it was
 * serving stale, cached builds). But anyone who visited an earlier build may
 * still have one registered in their browser — it keeps intercepting requests
 * and serving old assets forever. On every load we unregister any existing
 * worker and delete its Cache Storage, so future loads come straight from the
 * network. Renders nothing.
 *
 * manifest.json and the icons stay untouched, so the app is still installable
 * to the home screen — this only removes offline caching, not the PWA shell.
 */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const registration of registrations) registration.unregister();
        })
        .catch(() => {
          // Nothing to clean up, or the API is unavailable — safe to ignore.
        });
    }

    if ('caches' in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {
          // No Cache Storage to clear — safe to ignore.
        });
    }
  }, []);

  return null;
}
