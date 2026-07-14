'use client';

import { useEffect } from 'react';
import { storage } from '@/lib/storage';

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
