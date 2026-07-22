import { getServerSupabase } from '@/lib/supabaseServer';
import { UGC_TABLES, VIDEOS_BUCKET } from '@/lib/creators';
import type { Level } from '@/types';

/**
 * Public creator-profile data, read on the SERVER with the anon key.
 *
 * Everything here is already public under RLS: approved creator rows
 * (20260718120000_public_creator_read.sql) and published videos. Nothing in
 * this file may read anything else — see lib/supabaseServer.ts.
 *
 * Follow state is deliberately absent: it is per-viewer, and there is no
 * viewer on the server (auth lives in browser localStorage). The follow
 * button is a client island that resolves its own state.
 */

/**
 * Below this many words learned, the profile shows only videos + followers.
 * A brand-new creator's page must not read "0 words learned" — an empty
 * impact number is worse than no impact number, and this stat only becomes
 * meaningful once enough learners have actually mastered words from the
 * videos. No placeholder, no zero state: the tile is simply absent.
 */
export const WORDS_LEARNED_THRESHOLD = 250;

const LEVELS: readonly Level[] = ['A1', 'A2', 'B1', 'B2'];
/** Same reasoning as lib/publishedVideos.ts: ungraded content reads as A2. */
const DEFAULT_LEVEL: Level = 'A2';

export type ProfileVideo = {
  id: string;
  /** Public URL of the poster frame, or null — the grid renders a fallback
      tile rather than mounting a <video> element. */
  posterUrl: string | null;
  level: Level;
  title: string | null;
};

export type CreatorProfile = {
  userId: string;
  displayName: string;
  handle: string;
  bio: string;
  nativeLanguage: string;
  avatarUrl: string | null;
  followerCount: number;
  /** Published videos, newest first — the grid order. */
  videos: ProfileVideo[];
  /**
   * Total words learners have MASTERED across this creator's published
   * videos (sum of mastered_count). Null when below WORDS_LEARNED_THRESHOLD,
   * so callers render nothing rather than a zero.
   */
  wordsLearned: number | null;
};

type CreatorRow = {
  user_id: string;
  display_name: string;
  handle: string;
  bio: string;
  native_language: string;
  avatar_url: string | null;
  follower_count: number;
};

type VideoRow = {
  id: string;
  poster_path: string | null;
  level: string | null;
  title: string | null;
  mastered_count: number;
  published_at: string | null;
  created_at: string;
};

/** Public URL for a storage path, built without a client (no session needed). */
function publicUrl(storagePath: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${VIDEOS_BUCKET}/${storagePath}`;
}

/**
 * The public profile for a handle, or null when there is no APPROVED creator
 * with it (unknown handle, or a pending/rejected application — the page 404s
 * on both, and must not distinguish them).
 *
 * Matched on the lowercased handle rather than ilike: handles are stored
 * lowercase (applyAsCreator lowercases on insert) and are unique on
 * lower(handle), and ilike would treat `_` — a legal handle character — as a
 * single-character wildcard, so "maria_habla" could resolve to a DIFFERENT
 * creator's profile.
 */
export async function fetchCreatorProfile(
  handle: string
): Promise<CreatorProfile | null> {
  const supabase = getServerSupabase();
  if (!supabase) return null;

  const { data: creator, error } = await supabase
    .from(UGC_TABLES.creators)
    .select(
      'user_id, display_name, handle, bio, native_language, avatar_url, follower_count'
    )
    .eq('handle', handle.trim().toLowerCase())
    .eq('status', 'approved')
    .maybeSingle();
  if (error || !creator) return null;
  const row = creator as CreatorRow;

  // Published videos only. RLS would hide the rest from an anonymous reader
  // anyway; the explicit filter keeps that from being load-bearing.
  const { data: videoData } = await supabase
    .from(UGC_TABLES.videos)
    .select('id, poster_path, level, title, mastered_count, published_at, created_at')
    .eq('creator_id', row.user_id)
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  const rows = (videoData ?? []) as VideoRow[];
  let mastered = 0;
  const videos: ProfileVideo[] = rows.map((v) => {
    mastered += v.mastered_count;
    return {
      id: v.id,
      posterUrl: v.poster_path ? publicUrl(v.poster_path) : null,
      level: LEVELS.includes(v.level as Level)
        ? (v.level as Level)
        : DEFAULT_LEVEL,
      title: v.title,
    };
  });

  return {
    userId: row.user_id,
    displayName: row.display_name,
    handle: row.handle,
    bio: row.bio,
    nativeLanguage: row.native_language,
    avatarUrl: row.avatar_url,
    followerCount: row.follower_count,
    videos,
    wordsLearned: mastered >= WORDS_LEARNED_THRESHOLD ? mastered : null,
  };
}
