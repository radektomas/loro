-- The feed shows published UGC videos to EVERYONE (including signed-out
-- users), and each video carries its creator's name via a join to
-- loro_creators. The existing select policy only allowed own-row-or-admin
-- reads, so that join came back null for normal viewers.
--
-- Approved creators are public figures in the app (their name is on every
-- published video), so their creator row is publicly readable. Pending and
-- rejected applications stay private. Policies are OR'd, so this only widens
-- read access — writes are untouched.

drop policy if exists "anyone reads approved creators" on public.loro_creators;
create policy "anyone reads approved creators"
  on public.loro_creators for select
  using (status = 'approved');
