import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

/**
 * Browser Supabase client — a lazily-created singleton.
 *
 * Loro works with NO Supabase configured: the whole app runs anonymously on
 * localStorage, and sync is simply switched off. So this can return null, and
 * every caller must treat null as "anonymous mode", never as an error.
 *
 * We handle the auth redirect ourselves in /auth/callback (detectSessionInUrl
 * is off) so magic-link and OAuth take one deterministic path.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (typeof window === 'undefined') return null; // client-only
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storageKey: 'loro.auth',
      },
    });
  }
  return client;
}

// ---------------------------------------------------------------- table types

/** A row of loro_saved_words. Snake_case columns; timestamps are ISO strings. */
export type SavedWordRow = {
  user_id: string;
  text: string;
  translation: string;
  video_id: string;
  cue_index: number;
  state: string;
  box: number;
  due_at: string | null;
  correct: number;
  incorrect: number;
  last_reviewed_at: string | null;
  saved_at: string | null;
};

export type ProfileRow = {
  id: string;
  level: string | null;
  onboarded_at: string | null;
};

export const TABLES = {
  profiles: 'loro_profiles',
  savedWords: 'loro_saved_words',
  follows: 'loro_follows',
} as const;
