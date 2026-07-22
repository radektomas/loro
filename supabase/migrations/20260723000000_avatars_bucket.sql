-- Creator avatars.
--
-- A separate PUBLIC bucket rather than a folder in loro-videos: avatars are
-- tiny, replaced often, and readable by anyone who can see a profile, while
-- the video bucket's write policy is gated on being an APPROVED creator.
-- Anyone with a creator row may set an avatar, so the policies differ and the
-- buckets stay separate.
--
-- Path convention: <user_id>/<timestamp>.webp — the user_id folder is what
-- the policies below key on, and the timestamp makes every replacement a new
-- object (no cache-busting needed on the public URL). The client deletes the
-- previous object after a successful replace so the bucket doesn't grow
-- orphans; loro_creators.avatar_url holds the resulting public URL.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read: the profile page is public, and so is its avatar.
drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Write access is scoped to the user's own folder, for all three verbs.
-- Update and delete both matter: replacing an avatar deletes the old object.
drop policy if exists "users upload own avatar" on storage.objects;
create policy "users upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update own avatar" on storage.objects;
create policy "users update own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete own avatar" on storage.objects;
create policy "users delete own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
