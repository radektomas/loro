-- Fix: the box CHECK contradicts the app and silently breaks sync for
-- mastered words.
--
-- lib/srs.ts has seven boxes (MAX_BOX = 6, the 60-day interval) and the
-- loro_track_video_impact trigger counts mastery at box >= 6 — but the live
-- constraint was `box <= 5`, so box 6 was unreachable server-side. Found
-- 2026-07-25 while capturing the sync tables (20260717000000_sync_tables.sql
-- preserves the wrong constraint as captured; this migration is the fix).
--
-- Impact of the bug, measured in lib/storage.ts:
--   * flushQueue() sends ALL pending upserts as ONE batch. A single box-6 row
--     fails the whole statement, so one mastered word blocked every
--     saved-word upsert for that user — not just its own row. Deletes are
--     per-item and kept working.
--   * Nothing was dropped: the queue persists in localStorage and retries
--     every 5s, and upserts are rebuilt from CURRENT local state at flush
--     time. After this fix the backlog lands by itself with today's values.
--     Only users who cleared browser storage while poisoned lost data.
--   * transitionMergeUp() has the same single-batch shape: a fresh sign-in
--     carrying a box-6 word stayed entirely un-synced (local kept, retried).
--
-- mastered_count has therefore never been incremented in production; see
-- scripts/recompute-video-impact.mts for the counter recompute.
--
-- Idempotent by drop-and-recreate: replaying yields the same end state.
-- Existing rows all satisfy box <= 5, so validation cannot fail.

alter table public.loro_saved_words
  drop constraint if exists loro_saved_words_box_check;

alter table public.loro_saved_words
  add constraint loro_saved_words_box_check check (box >= 0 and box <= 6);
