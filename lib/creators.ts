import { getSupabase } from '@/lib/supabase';
import { isReservedHandle } from '@/lib/reservedHandles';
import type { Cue, Gloss } from '@/types';

/**
 * Data layer for Loro UGC: creator applications, uploaded videos, and the
 * admin review flow. snake_case stays in this file; everything returned is
 * camelCase. Unlike the core loop, all of this requires Supabase and a
 * signed-in user — there is no anonymous fallback for creator features.
 *
 * Schema + RLS live in supabase/migrations/20260718000000_ugc_creators.sql.
 */

export const UGC_TABLES = {
  creators: 'loro_creators',
  videos: 'loro_videos',
} as const;

export const VIDEOS_BUCKET =
  process.env.NEXT_PUBLIC_LORO_VIDEOS_BUCKET ?? 'loro-videos';

/** Public bucket for creator avatars — <user_id>/<timestamp>.webp. */
export const AVATARS_BUCKET = 'avatars';

/**
 * Upload limits, enforced BEFORE upload. The video size cap is just a sane
 * storage bound — transcription no longer sees the video at all (the browser
 * extracts an audio-only file and the pipeline transcribes that), so the old
 * 25 MB Whisper ceiling is gone. Duration stays capped at 90 s.
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MAX_UPLOAD_SECONDS = 90;

// ------------------------------------------------------------------ creators

export type CreatorStatus = 'pending' | 'approved' | 'rejected';

export type Creator = {
  userId: string;
  displayName: string;
  handle: string;
  bio: string;
  nativeLanguage: string;
  sampleLink: string | null;
  /** Public URL of the uploaded avatar, or null — render via <Avatar>. */
  avatarUrl: string | null;
  status: CreatorStatus;
  /** epoch ms */
  appliedAt: number;
  reviewedAt: number | null;
};

type CreatorRow = {
  user_id: string;
  display_name: string;
  handle: string;
  bio: string;
  native_language: string;
  sample_link: string | null;
  avatar_url: string | null;
  status: CreatorStatus;
  applied_at: string;
  reviewed_at: string | null;
};

function rowToCreator(row: CreatorRow): Creator {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    handle: row.handle,
    bio: row.bio,
    nativeLanguage: row.native_language,
    sampleLink: row.sample_link,
    avatarUrl: row.avatar_url ?? null,
    status: row.status,
    appliedAt: Date.parse(row.applied_at),
    reviewedAt: row.reviewed_at ? Date.parse(row.reviewed_at) : null,
  };
}

/** The signed-in user's creator row, or null if they never applied. */
export async function getMyCreator(): Promise<Creator | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  // Explicit filter, not just RLS: admins can read every creator row, and
  // maybeSingle() would throw on more than one.
  const { data } = await supabase
    .from(UGC_TABLES.creators)
    .select('*')
    .eq('user_id', session.user.id)
    .maybeSingle();
  return data ? rowToCreator(data as CreatorRow) : null;
}

export type ApplyInput = {
  displayName: string;
  handle: string;
  bio: string;
  nativeLanguage: string;
  sampleLink: string;
};

export type ApplyResult =
  | { ok: true; creator: Creator }
  | { ok: false; error: string };

export async function applyAsCreator(input: ApplyInput): Promise<ApplyResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'You need to sign in first.' };
  // Enforced here as well as in the form: the form's check is UX, this one is
  // the actual rule. A reserved handle would produce a profile page that is
  // permanently shadowed by a static route (see lib/reservedHandles.ts).
  if (isReservedHandle(input.handle)) {
    return { ok: false, error: 'That handle is reserved. Try another one.' };
  }
  const { data, error } = await supabase
    .from(UGC_TABLES.creators)
    .insert({
      user_id: session.user.id,
      display_name: input.displayName.trim(),
      handle: input.handle.trim().toLowerCase(),
      bio: input.bio.trim(),
      native_language: input.nativeLanguage.trim(),
      sample_link: input.sampleLink.trim() || null,
    })
    .select()
    .single();
  if (error) {
    // 23505 = unique violation: either the handle is taken or they already applied
    if (error.code === '23505') {
      return error.message.includes('handle')
        ? { ok: false, error: 'That handle is already taken.' }
        : { ok: false, error: 'You already have an application on file.' };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, creator: rowToCreator(data as CreatorRow) };
}

// ------------------------------------------------------------ profile edits

export type ProfileEdit = {
  displayName: string;
  bio: string;
  /** New public URL, or undefined to leave the current avatar alone. */
  avatarUrl?: string;
};

export const MAX_DISPLAY_NAME = 50;
export const MAX_BIO = 500;

/**
 * The storage path inside AVATARS_BUCKET for a public avatar URL, or null if
 * the URL isn't one of ours. Used to delete the object a new upload replaces
 * — the URL is all the profile row keeps, so the path is recovered from it.
 */
export function avatarPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/${AVATARS_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length);
  return path.length > 0 ? decodeURIComponent(path) : null;
}

export type AvatarUpload =
  | { ok: true; url: string; path: string }
  | { ok: false; error: string };

/**
 * Upload a prepared avatar blob. The timestamped filename makes every save a
 * NEW object, so the public URL changes and no CDN or browser cache can serve
 * the old face — replacing the object at a stable path would.
 */
export async function uploadAvatar(blob: Blob): Promise<AvatarUpload> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'You need to sign in first.' };

  const path = `${session.user.id}/${Date.now()}.webp`;
  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, blob, { contentType: 'image/webp', upsert: false });
  if (error) return { ok: false, error: error.message };

  const url = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path).data
    .publicUrl;
  return { ok: true, url, path };
}

/** Best-effort removal of a replaced avatar; failure is logged, never shown. */
export async function deleteAvatarObject(path: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.storage.from(AVATARS_BUCKET).remove([path]);
  if (error) console.error('[loro] old avatar cleanup failed', error.message);
}

/**
 * Update the signed-in creator's own profile. RLS scopes the row, and the
 * column grants decide what may be written — `handle` is deliberately NOT
 * accepted here even though it is grantable: changing it breaks every profile
 * URL already shared and the link preview with it.
 */
export async function updateCreatorProfile(
  edit: ProfileEdit
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'You need to sign in first.' };

  const displayName = edit.displayName.trim();
  const bio = edit.bio.trim();
  if (displayName.length === 0) {
    return { ok: false, error: 'Your display name can’t be empty.' };
  }
  if (displayName.length > MAX_DISPLAY_NAME) {
    return { ok: false, error: `Display name is capped at ${MAX_DISPLAY_NAME} characters.` };
  }
  if (bio.length > MAX_BIO) {
    return { ok: false, error: `Bio is capped at ${MAX_BIO} characters.` };
  }

  const patch: Record<string, unknown> = { display_name: displayName, bio };
  if (edit.avatarUrl !== undefined) patch.avatar_url = edit.avatarUrl;

  const { error } = await supabase
    .from(UGC_TABLES.creators)
    .update(patch)
    .eq('user_id', session.user.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// --------------------------------------------------------------------- admin

/** Server-verified admin check (loro_admins allowlist via SECURITY DEFINER RPC). */
export async function isAdmin(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('loro_is_admin');
  return !error && data === true;
}

export async function listCreators(status: CreatorStatus): Promise<Creator[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from(UGC_TABLES.creators)
    .select('*')
    .eq('status', status)
    .order('applied_at', { ascending: true });
  return ((data ?? []) as CreatorRow[]).map(rowToCreator);
}

export async function reviewCreator(
  userId: string,
  decision: 'approved' | 'rejected'
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { error } = await supabase
    .from(UGC_TABLES.creators)
    .update({ status: decision, reviewed_at: new Date().toISOString() })
    .eq('user_id', userId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// -------------------------------------------------------------------- videos

export type UgcVideoStatus =
  | 'uploaded'
  | 'processing'
  | 'published'
  | 'pending_review'
  | 'rejected';

export type CreatorVideo = {
  id: string;
  creatorId: string;
  status: UgcVideoStatus;
  storagePath: string;
  /** browser-extracted audio-only file — the transcription input */
  audioPath: string | null;
  durationSeconds: number | null;
  title: string | null;
  level: string | null;
  posterPath: string | null;
  cues: Cue[] | null;
  dictionary: Record<string, Gloss> | null;
  reviewNote: string | null;
  savedCount: number;
  masteredCount: number;
  /** epoch ms */
  createdAt: number;
  /** joined creator identity — present on admin queries */
  creator?: { displayName: string; handle: string };
};

type VideoRow = {
  id: string;
  creator_id: string;
  status: UgcVideoStatus;
  storage_path: string;
  audio_path: string | null;
  duration_seconds: number | string | null;
  title: string | null;
  level: string | null;
  poster_path: string | null;
  cues: Cue[] | null;
  dictionary: Record<string, Gloss> | null;
  review_note: string | null;
  saved_count: number;
  mastered_count: number;
  created_at: string;
  loro_creators?: { display_name: string; handle: string } | null;
};

function rowToVideo(row: VideoRow): CreatorVideo {
  return {
    id: row.id,
    creatorId: row.creator_id,
    status: row.status,
    storagePath: row.storage_path,
    audioPath: row.audio_path,
    durationSeconds:
      row.duration_seconds === null ? null : Number(row.duration_seconds),
    title: row.title,
    level: row.level,
    posterPath: row.poster_path,
    cues: row.cues,
    dictionary: row.dictionary,
    reviewNote: row.review_note,
    savedCount: row.saved_count,
    masteredCount: row.mastered_count,
    createdAt: Date.parse(row.created_at),
    creator: row.loro_creators
      ? {
          displayName: row.loro_creators.display_name,
          handle: row.loro_creators.handle,
        }
      : undefined,
  };
}

/** The signed-in creator's own videos, newest first (RLS scopes the rows). */
export async function listMyVideos(): Promise<CreatorVideo[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return [];
  const { data } = await supabase
    .from(UGC_TABLES.videos)
    .select('*')
    .eq('creator_id', session.user.id)
    .order('created_at', { ascending: false });
  return ((data ?? []) as VideoRow[]).map(rowToVideo);
}

/** Admin: videos in the given statuses, with creator identity joined. */
export async function listVideosByStatus(
  statuses: UgcVideoStatus[]
): Promise<CreatorVideo[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from(UGC_TABLES.videos)
    .select('*, loro_creators(display_name, handle)')
    .in('status', statuses)
    .order('created_at', { ascending: true });
  return ((data ?? []) as VideoRow[]).map(rowToVideo);
}

/** Admin: per-creator video counts, for the approved-creators list. */
export async function countVideosByCreator(): Promise<
  Map<string, { total: number; published: number }>
> {
  const supabase = getSupabase();
  const counts = new Map<string, { total: number; published: number }>();
  if (!supabase) return counts;
  const { data } = await supabase
    .from(UGC_TABLES.videos)
    .select('creator_id, status');
  for (const row of (data ?? []) as { creator_id: string; status: string }[]) {
    const e = counts.get(row.creator_id) ?? { total: 0, published: 0 };
    e.total++;
    if (row.status === 'published') e.published++;
    counts.set(row.creator_id, e);
  }
  return counts;
}

export async function setVideoStatus(
  videoId: string,
  status: UgcVideoStatus
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const patch: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
  };
  if (status === 'published') patch.published_at = new Date().toISOString();
  const { error } = await supabase
    .from(UGC_TABLES.videos)
    .update(patch)
    .eq('id', videoId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Delete one of the signed-in creator's own videos: the row first (RLS is
 * the authorization — if it refuses, nothing is touched), then the storage
 * objects best-effort. An orphaned file after a failed removal costs pennies;
 * a dangling row pointing at deleted media would be a broken feed slide.
 */
export async function deleteCreatorVideo(
  video: CreatorVideo
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { error } = await supabase
    .from(UGC_TABLES.videos)
    .delete()
    .eq('id', video.id);
  if (error) return { ok: false, error: error.message };
  const paths = [video.storagePath, video.audioPath, video.posterPath].filter(
    (p): p is string => Boolean(p)
  );
  if (paths.length) {
    await supabase.storage.from(VIDEOS_BUCKET).remove(paths);
  }
  return { ok: true };
}

/** Playback URL for a storage path (the loro-videos bucket is public). */
export function videoPublicUrl(storagePath: string): string | null {
  const supabase = getSupabase();
  if (!supabase) return null;
  return supabase.storage.from(VIDEOS_BUCKET).getPublicUrl(storagePath).data
    .publicUrl;
}

/**
 * Live status for one video row (uploaded -> processing -> published /
 * pending_review, written by the n8n pipeline). Returns an unsubscribe fn.
 * Realtime must be enabled on loro_videos — the migration does this.
 */
export function subscribeToVideo(
  videoId: string,
  onChange: (video: CreatorVideo) => void
): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`loro-video-${videoId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: UGC_TABLES.videos,
        filter: `id=eq.${videoId}`,
      },
      (payload) => onChange(rowToVideo(payload.new as VideoRow))
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// -------------------------------------------------------------------- upload

/** Read a video file's duration client-side (metadata only, no full decode). */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(el.duration);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that file as a video.'));
    };
    el.src = url;
  });
}

export type UploadResult =
  | { ok: true; video: CreatorVideo; importTriggered: boolean }
  | { ok: false; error: string };

/**
 * The whole upload step: put the video AND its browser-extracted audio file
 * in storage, insert the videos row as 'uploaded', then hand off to the n8n
 * import pipeline via our API route (which holds the webhook URL
 * server-side). The pipeline transcribes the audio file — the video is only
 * ever played, so its codec/size no longer matter to Whisper. The caller has
 * already validated duration/size/rights and extracted the audio — this
 * function trusts its input.
 */
export async function uploadCreatorVideo(
  file: File,
  durationSeconds: number,
  audio: Blob,
  poster: Blob | null
): Promise<UploadResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'You need to sign in first.' };

  const videoId = crypto.randomUUID();
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const storagePath = `${session.user.id}/${videoId}.${ext}`;
  const audioPath = `${session.user.id}/${videoId}.audio.m4a`;

  const { error: uploadError } = await supabase.storage
    .from(VIDEOS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'video/mp4',
      upsert: false,
    });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error: audioError } = await supabase.storage
    .from(VIDEOS_BUCKET)
    .upload(audioPath, audio, { contentType: 'audio/mp4', upsert: false });
  if (audioError) {
    // No half-uploads: without the audio the pipeline can't transcribe.
    await supabase.storage.from(VIDEOS_BUCKET).remove([storagePath]);
    return { ok: false, error: audioError.message };
  }

  // The poster frame is BEST EFFORT and never fails the upload: without it
  // the profile grid falls back to an initial tile. It is written in the
  // INSERT below rather than patched in afterwards because loro_videos
  // updates are admin-only under RLS — a creator has no path to patch their
  // own row once it exists.
  let posterPath: string | null = null;
  if (poster) {
    const candidate = `${session.user.id}/${videoId}.poster.jpg`;
    const { error: posterError } = await supabase.storage
      .from(VIDEOS_BUCKET)
      .upload(candidate, poster, { contentType: 'image/jpeg', upsert: false });
    if (posterError) {
      console.error('[loro] poster upload failed', posterError.message);
    } else {
      posterPath = candidate;
    }
  }

  const { data, error: insertError } = await supabase
    .from(UGC_TABLES.videos)
    .insert({
      id: videoId,
      creator_id: session.user.id,
      storage_path: storagePath,
      audio_path: audioPath,
      poster_path: posterPath,
      duration_seconds: durationSeconds,
      title: file.name.replace(/\.[^.]+$/, ''),
    })
    .select()
    .single();
  if (insertError) {
    // Don't strand the objects if the row never existed.
    await supabase.storage
      .from(VIDEOS_BUCKET)
      .remove(posterPath ? [storagePath, audioPath, posterPath] : [storagePath, audioPath]);
    return { ok: false, error: insertError.message };
  }

  // Kick the n8n import workflow. Failure here is NOT a failed upload — the
  // row exists and stays 'uploaded'; the page tells the user what happened.
  let importTriggered = false;
  try {
    const res = await fetch('/api/creator/import', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        video_id: videoId,
        storage_path: storagePath,
        audio_path: audioPath,
        duration: durationSeconds,
      }),
    });
    importTriggered = res.ok;
  } catch {
    importTriggered = false;
  }

  return { ok: true, video: rowToVideo(data as VideoRow), importTriggered };
}
