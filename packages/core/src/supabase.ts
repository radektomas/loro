import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

/**
 * Supabase client — a lazily-created singleton behind an explicit platform
 * seam.
 *
 * Loro works with NO Supabase configured: the whole app runs anonymously on
 * local storage, and sync is simply switched off. So getSupabase() can return
 * null, and every caller must treat null as "anonymous mode", never as an
 * error.
 *
 * Core reads no env vars and touches no window. Each platform calls
 * initSupabase() once at boot:
 *   - web: lib/supabaseInit.ts — env-derived url/key, gated on a browser
 *     context, no authStorage (supabase-js keeps its localStorage default),
 *     redirectTo built from window.location.origin.
 *   - RN: app-scheme redirectTo, plus an AsyncStorage/MMKV authStorage
 *     adapter (supabase-js has no sensible default there).
 *
 * "Unconfigured" is the resting state: until initSupabase() runs,
 * getSupabase() returns null. That is what keeps server renders session-free
 * on the web — the web initialises only in a browser, so SSR and API routes
 * see the same null the old `typeof window` guard produced.
 *
 * We handle the auth redirect ourselves in /auth/callback (detectSessionInUrl
 * is off) so magic-link and OAuth take one deterministic path.
 */

/** Storage adapter shape supabase-js accepts for session persistence.
    Structurally matches @supabase/auth-js's SupportedStorage. */
export type SupabaseAuthStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};

export type SupabaseInit = {
  url: string;
  anonKey: string;
  /** Session-persistence driver. OMIT on web — supabase-js then keeps its
      own default (localStorage in a browser). RN must supply one. */
  authStorage?: SupabaseAuthStorage;
  /**
   * Where auth providers send the user back to: a full URL, or a function
   * returning one. The web passes a function so window.location.origin is
   * read at call time, exactly as before the extraction; RN passes its app
   * scheme. Supabase only honours values on the project's Redirect URLs
   * allowlist — a missing entry is silently replaced by the Site URL, which
   * looks exactly like a client bug. Keep the allowlist current.
   */
  redirectTo?: string | (() => string | undefined);
};

let config: SupabaseInit | null = null;
let client: SupabaseClient | null = null;

/** Configure the factory. Call once at platform boot, before anything that
    syncs. Calling again replaces the config and drops the memoised client
    (dev-reload convenience; production calls this exactly once). */
export function initSupabase(init: SupabaseInit): void {
  config = init;
  client = null;
}

export function isSupabaseConfigured(): boolean {
  return config !== null;
}

/** Resolve the platform's redirect target for auth entry points. undefined
    when unconfigured; passed straight through to supabase-js. */
export function getAuthRedirectTo(): string | undefined {
  const redirectTo = config?.redirectTo;
  return typeof redirectTo === 'function' ? redirectTo() : redirectTo;
}

export function getSupabase(): SupabaseClient | null {
  if (!config) return null;
  if (!client) {
    client = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storageKey: 'loro.auth',
        // When no adapter is injected the key is absent entirely, so
        // supabase-js keeps its own default storage.
        ...(config.authStorage ? { storage: config.authStorage } : {}),
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
  /** 'deck' | 'user' — see WordSource in types/index.ts. Nullable because rows
      predating the column have no value; readers default those to 'user'. */
  source: string | null;
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
  progress: 'loro_progress',
} as const;
