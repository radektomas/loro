-- Analytics ingest: one function, because PostgREST's upsert cannot be used
-- on an append-only table.
--
-- WHAT WENT WRONG. 20260826000000 gives loro_analytics_events an INSERT policy
-- and deliberately no UPDATE policy — it is an append-only log, and a client
-- that can rewrite delivered events can rewrite history. The client then wrote
-- its batches with supabase-js `.upsert(rows, { ignoreDuplicates: true })`, to
-- make at-least-once delivery safe: a batch that landed but whose response was
-- lost is replayed, and ON CONFLICT DO NOTHING absorbs it.
--
-- Those two decisions are incompatible, and it is not obvious from either
-- side. `.upsert(ignoreDuplicates)` sends `Prefer: resolution=ignore-duplicates`,
-- and PostgREST's upsert path is refused by RLS unless the table also carries
-- an UPDATE policy — verified live against this project, anon key, 2026-08-26:
--
--     plain INSERT                        -> 201
--     INSERT + resolution=ignore-duplicates -> 42501 "new row violates
--                                             row-level security policy"
--
-- So the shipped client would have failed EVERY write, for every anonymous
-- user, silently — the queue would simply have grown to its 500-event ceiling
-- on every phone. Adding the UPDATE policy would "fix" it by giving every
-- holder of the anon key permission to edit the log, which is the one thing
-- this table must not allow.
--
-- THE FIX: move the ON CONFLICT server-side, where it needs no policy at all.
-- A SECURITY DEFINER function inserts the batch in one statement, absorbing
-- duplicates, and the table keeps its append-only posture. Better than the
-- upsert on two further counts:
--
--   * user_id is no longer ASSERTED by the client and checked by a policy; it
--     is IGNORED and replaced with auth.uid(). A forged id is not rejected, it
--     is simply overwritten — there is no longer a request that could attach
--     an event to a stranger's account.
--   * one round trip for a whole batch, with a count of what was new.
--
-- The INSERT policy from the previous migration stays as it is: it still
-- governs any direct write, and this function is a narrower door beside it,
-- not a replacement for it.
--
-- Idempotent: create or replace.

create or replace function public.loro_analytics_ingest(p_events jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'loro_analytics_ingest: p_events must be a JSON array'
      using errcode = '22023';
  end if;

  -- A ceiling on one call, so a buggy or hostile client cannot ask the
  -- database to parse an unbounded document. The client batches at 100.
  if jsonb_array_length(p_events) > 250 then
    raise exception 'loro_analytics_ingest: batch too large (% events, max 250)',
      jsonb_array_length(p_events) using errcode = '22023';
  end if;

  insert into public.loro_analytics_events (
    id, install_id, session_id, user_id,
    name, props, at, platform, app_version, build_profile
  )
  select
    (e ->> 'id')::uuid,
    (e ->> 'install_id')::uuid,
    (e ->> 'session_id')::uuid,
    -- NOT e->>'user_id'. The caller's claim is discarded and the session's own
    -- identity used instead, so "attribute this event to someone else" is not
    -- a request that can be made. Null for anonymous callers, which is the
    -- normal case on a hard-paywall app.
    auth.uid(),
    e ->> 'name',
    case
      when jsonb_typeof(e -> 'props') = 'object' then e -> 'props'
      else '{}'::jsonb
    end,
    (e ->> 'at')::timestamptz,
    coalesce(e ->> 'platform', 'ios'),
    e ->> 'app_version',
    e ->> 'build_profile'
  from jsonb_array_elements(p_events) as t(e)
  -- The whole point: a replayed batch is absorbed instead of aborting on the
  -- primary key. Every CHECK on the table still applies — SECURITY DEFINER
  -- bypasses RLS, never constraints — so a malformed name or an oversized
  -- props still fails loudly rather than landing.
  on conflict (id) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Explicit, rather than relying on the default grant to public: the callers
-- are the app's two roles and nothing else.
revoke all on function public.loro_analytics_ingest(jsonb) from public;
grant execute on function public.loro_analytics_ingest(jsonb) to anon, authenticated;

comment on function public.loro_analytics_ingest(jsonb) is
  'Append a batch of analytics events, absorbing replays via ON CONFLICT DO NOTHING. user_id is taken from auth.uid() and never from the payload. See apps/mobile/src/platform/analytics.ts.';
