-- Creators can delete their OWN videos from the dashboard (any status —
-- it's their content). Deleting the row also takes the clip out of the feed
-- and the admin queues; the storage objects are removed by the client
-- (policy below). Saved words that referenced the video keep working as
-- plain vocabulary — nothing references loro_videos by FK from the SRS.

drop policy if exists "creators delete own videos" on public.loro_videos;
create policy "creators delete own videos"
  on public.loro_videos for delete
  using (creator_id = auth.uid());

drop policy if exists "creators delete own video files" on storage.objects;
create policy "creators delete own video files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'loro-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
