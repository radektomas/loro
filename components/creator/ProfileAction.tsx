'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { follows } from '@/lib/follows';
import {
  avatarPathFromUrl,
  deleteAvatarObject,
  MAX_BIO,
  MAX_DISPLAY_NAME,
  updateCreatorProfile,
  uploadAvatar,
} from '@/lib/creators';
import { prepareAvatar } from '@/lib/avatar';
import { useSupabaseUser } from '@/components/creator/ugc';
import { Avatar } from '@/components/creator/Avatar';
import { Sheet } from '@/components/Sheet';

/**
 * The one interactive control in the profile header, and the ONE place that
 * decides who the viewer is: the owner gets "Edit profile", everyone else
 * gets Follow / Following. A second ownership check somewhere else would be a
 * second thing to get wrong — and the two answers disagreeing is exactly how
 * a creator ends up able to follow themselves.
 *
 * Client-only because both branches depend on the viewer, and the viewer is
 * only knowable in the browser: auth lives in localStorage, and signed-out
 * follows live there too. There is deliberately no sign-in wall on Follow.
 */

export type ProfileOwner = {
  userId: string;
  displayName: string;
  handle: string;
  bio: string;
  avatarUrl: string | null;
};

export function ProfileAction({ creator }: { creator: ProfileOwner }) {
  const { user, ready } = useSupabaseUser();
  const [following, setFollowing] = useState(false);
  const [editing, setEditing] = useState(false);
  // localStorage is unreadable during SSR and first paint, so follow state is
  // only known after mount. Until then a fixed-size placeholder holds the
  // space — a control that flips label right after paint reads as a glitch,
  // and invites a mis-tap on the wrong action.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setFollowing(follows.isFollowing(creator.userId));
    setHydrated(true);
    // The sync engine can also change this: a merge-on-signin adds follows,
    // and a permanently-rejected follow is undone.
    return follows.onFollowsChanged(() =>
      setFollowing(follows.isFollowing(creator.userId))
    );
  }, [creator.userId]);

  const toggleFollow = useCallback(() => {
    const next = !following;
    setFollowing(next); // optimistic
    const { ok } = next
      ? follows.follow(creator.userId)
      : follows.unfollow(creator.userId);
    if (!ok) setFollowing(!next); // local write failed — revert
  }, [creator.userId, following]);

  if (!ready || !hydrated) {
    return <div className="h-11 w-32" aria-hidden />;
  }

  if (user?.id === creator.userId) {
    return (
      <>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="h-11 w-32 rounded-2xl bg-surface-raised text-base font-semibold text-text transition-transform active:scale-95"
        >
          Edit profile
        </button>
        {editing && (
          <EditProfileSheet
            creator={creator}
            onClose={() => setEditing(false)}
          />
        )}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleFollow}
      aria-pressed={following}
      className={`h-11 w-32 rounded-2xl text-base font-semibold transition-transform active:scale-95 ${
        following ? 'bg-surface-raised text-text' : 'bg-accent text-background'
      }`}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  );
}

const inputCls =
  'w-full rounded-2xl bg-surface px-4 py-3.5 text-base text-text placeholder:text-muted/50 outline-none ring-1 ring-transparent focus:ring-accent/50';

/**
 * Edit display name, bio and avatar. Handle is shown but read-only — it is in
 * the writable grant list, but changing it would break every profile link
 * already shared and the link preview with it.
 *
 * The profile page is a server component, so a successful save ends in
 * router.refresh(): setState alone would leave the server-rendered header
 * showing the old name until a full reload.
 */
function EditProfileSheet({
  creator,
  onClose,
}: {
  creator: ProfileOwner;
  onClose: () => void;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(creator.displayName);
  const [bio, setBio] = useState(creator.bio);
  // The processed 512×512 WebP, held until save — nothing is uploaded while
  // the user is still deciding.
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An object URL is a document-lifetime handle; without this every image the
  // user auditions leaks until navigation.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const result = await prepareAvatar(file);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAvatarBlob(result.blob);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(result.blob);
    });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);

    let avatarUrl: string | undefined;
    let uploadedPath: string | null = null;
    if (avatarBlob) {
      const upload = await uploadAvatar(avatarBlob);
      if (!upload.ok) {
        setSaving(false);
        setError(upload.error);
        return;
      }
      avatarUrl = upload.url;
      uploadedPath = upload.path;
    }

    const result = await updateCreatorProfile({ displayName, bio, avatarUrl });
    if (!result.ok) {
      // The row never changed, so the object just uploaded is an orphan —
      // remove it rather than leaving it to accumulate.
      if (uploadedPath) void deleteAvatarObject(uploadedPath);
      setSaving(false);
      setError(result.error ?? 'Could not save your profile.');
      return;
    }

    // Only once the row points at the new avatar is the old one safe to
    // delete. Best-effort: a failure here costs a stray object, not data.
    if (uploadedPath) {
      const previous = avatarPathFromUrl(creator.avatarUrl);
      if (previous && previous !== uploadedPath) void deleteAvatarObject(previous);
    }

    onClose();
    router.refresh();
  };

  return (
    <div className="fixed inset-0 z-50">
      <Sheet onClose={saving ? () => {} : onClose}>
        <h2 className="text-lg font-bold tracking-tight text-text">
          Edit profile
        </h2>

        <div className="mt-5 flex items-center gap-4">
          <Avatar
            url={previewUrl ?? creator.avatarUrl}
            name={displayName || creator.displayName}
            size={64}
          />
          <label className="cursor-pointer rounded-2xl bg-surface px-4 py-3 text-sm font-semibold text-text transition-colors hover:bg-surface-raised">
            {previewUrl ? 'Choose another' : 'Change photo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void pickAvatar(e.target.files?.[0])}
            />
          </label>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="px-1 text-xs font-semibold uppercase tracking-widest text-muted">
              Display name
            </span>
            <input
              className={`${inputCls} mt-1.5`}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={MAX_DISPLAY_NAME}
            />
          </label>

          <label className="block">
            <span className="px-1 text-xs font-semibold uppercase tracking-widest text-muted">
              Bio
            </span>
            <textarea
              className={`${inputCls} mt-1.5 min-h-24 resize-y leading-relaxed`}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={MAX_BIO}
            />
            <span className="mt-1 block px-1 text-right text-xs text-muted/60">
              {bio.length}/{MAX_BIO}
            </span>
          </label>

          <div>
            <span className="px-1 text-xs font-semibold uppercase tracking-widest text-muted">
              Handle
            </span>
            <p className="mt-1.5 rounded-2xl bg-surface px-4 py-3.5 text-base text-muted">
              @{creator.handle}
            </p>
            <p className="mt-1 px-1 text-xs text-muted/60">
              Handles can&apos;t be changed — every link already shared to your
              profile points at this one.
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-2xl bg-[#f87171]/10 px-4 py-3 text-sm leading-relaxed text-[#f87171]">
            {error}
          </p>
        )}

        <div className="mb-4 mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-2xl bg-surface py-3.5 text-base font-semibold text-text transition-colors hover:bg-surface-raised disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || displayName.trim().length === 0}
            className="flex-1 rounded-2xl bg-accent py-3.5 text-base font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
