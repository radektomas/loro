'use client';

// Import side effects: install @loro/core's web StorageDriver, its catalog,
// and configure its Supabase factory during module evaluation — before
// hydration renders anything that reads storage or the catalog, and before any
// effect or handler can reach for the client. (The storage and Supabase halves
// are browser-gated; the catalog deliberately is not — the server render needs
// the same list the client hydrates with. See lib/catalogInit.ts.)
import '@/lib/platformInit';
import '@/lib/catalogInit';
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
