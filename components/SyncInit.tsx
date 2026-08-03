'use client';

// Import side effects: install @loro/core's web StorageDriver and configure
// its Supabase factory (both browser-gated) during module evaluation — before
// hydration renders anything that reads storage, and before any effect or
// handler can reach for the client.
import '@/lib/platformInit';
import '@/lib/supabaseInit';
import { useEffect } from 'react';
import { storage } from '@loro/core/storage';

/**
 * Kicks off the Supabase mirror once, near the app root. Renders nothing.
 * No-ops entirely when Supabase isn't configured — the app stays anonymous.
 */
export function SyncInit() {
  useEffect(() => {
    storage.initSync();
  }, []);
  return null;
}
