-- Starter-deck funnel, second pass: stable per-event ids, and the consolidated
-- event shape.
--
-- CONTEXT. 20260730000000_starter_deck_events.sql is applied and immutable. It
-- added loro_profiles.starter_deck_events (jsonb) holding an ARRAY OF EVENTS per
-- profile, with the shape {kind, round, card, at, videoId?, word?, knew?,
-- played?} and a push-only client. Two things have since changed:
--
--   1. The sync is now a UNION merge in both directions (lib/storage.ts
--      syncStarterEvents), because two devices can each hold part of one user's
--      onboarding and a blind push deletes whichever half goes second. A union
--      is only safe if it is idempotent, and that requires a stable identity per
--      event — (kind, round, card, at) is NOT one: two devices can land the same
--      card in the same millisecond, and a re-shown card is a real second event.
--      So every event now carries a client-generated `id`.
--   2. The event model was consolidated onto lib/starterEvents.ts, renaming
--      `kind` -> `name` and `knew` -> `knewIt`, renaming the 'skip' event to
--      'skipped', and moving the card index from 0-based to 1-BASED (so a 0 can
--      only ever mean "not on a card"). It also added `cards`, the round's card
--      count, which needs no migration — it is simply absent on old events.
--
-- NOTE ON SHAPE — read before reviewing. The applied migration created a jsonb
-- COLUMN, not an events table, so there is no column to add and no unique index
-- to create: the ids live inside the array elements. This migration therefore
-- does the jsonb equivalent of "nullable column, backfill, then constrain":
-- statement 1 back-fills ids (and normalises the renamed keys), statement 2 adds
-- the invariant as a CHECK, in a separate statement, so it is evaluated only
-- after every existing row already satisfies it. Uniqueness of ids WITHIN a
-- user's array cannot be expressed as a constraint here (a CHECK may not contain
-- a subquery, and there are no rows to index); it is enforced by the client's
-- merge, which is where the idempotence test lives (lib/starterEvents.test.mts).
--
-- Nothing is dropped and nothing is recreated. Rows that already satisfy the new
-- shape are left untouched, so replaying this is a no-op.

-- 1. Back-fill: stamp an id on every event that lacks one, and translate the
--    old key names. Original array order is preserved (WITH ORDINALITY, not a
--    re-sort by `at`), non-object junk is passed through untouched, and the
--    HAVING clause means only rows that actually need work are rewritten.
with migrated as (
  select p.id as profile_id,
         jsonb_agg(
           case
             when jsonb_typeof(t.e) <> 'object' then t.e
             else
               -- Drop the renamed keys, then add back the new ones. Order
               -- matters: `||` right-hand wins, so an event that somehow has
               -- both spellings keeps the new value.
               (t.e - 'kind' - 'knew')
               || case
                    when coalesce(t.e ->> 'id', '') <> '' then '{}'::jsonb
                    else jsonb_build_object('id', gen_random_uuid()::text)
                  end
               || case
                    when jsonb_exists(t.e, 'kind') then
                      jsonb_build_object(
                        'name',
                        case
                          when t.e ->> 'kind' = 'skip' then 'skipped'
                          else t.e ->> 'kind'
                        end
                      )
                    else '{}'::jsonb
                  end
               || case
                    when jsonb_exists(t.e, 'knew') then
                      jsonb_build_object('knewIt', t.e -> 'knew')
                    else '{}'::jsonb
                  end
               -- 0-based -> 1-based, applied ONLY to old-shape events (the ones
               -- still carrying `kind`), so a re-run cannot shift an index that
               -- has already been converted.
               || case
                    when jsonb_exists(t.e, 'kind')
                         and jsonb_typeof(t.e -> 'card') = 'number' then
                      jsonb_build_object('card', (t.e ->> 'card')::int + 1)
                    else '{}'::jsonb
                  end
           end
           order by t.ord
         ) as events
    from public.loro_profiles p
         cross join lateral jsonb_array_elements(p.starter_deck_events)
                    with ordinality as t(e, ord)
   where p.starter_deck_events is not null
     and jsonb_typeof(p.starter_deck_events) = 'array'
   group by p.id
  having bool_or(
           jsonb_typeof(t.e) = 'object'
           and (coalesce(t.e ->> 'id', '') = '' or jsonb_exists(t.e, 'kind'))
         )
)
update public.loro_profiles p
   set starter_deck_events = migrated.events
  from migrated
 where p.id = migrated.profile_id;

-- 2. The invariant, added separately and only now that every stored event has an
--    id: no element may be missing one. This is what protects the union merge
--    from silently falling back to content-keyed dedupe.
--
--    If this statement errors on the server's jsonpath support, it is safe to
--    skip: the client tolerates id-less events (parseStarterEvents keeps them
--    with an empty id and merges those on their content) and every event it
--    writes from now on carries an id. The back-fill above is the part that
--    matters.
alter table public.loro_profiles
  drop constraint if exists loro_profiles_starter_deck_events_have_ids;

alter table public.loro_profiles
  add constraint loro_profiles_starter_deck_events_have_ids
  check (
    starter_deck_events is null
    or (
      jsonb_typeof(starter_deck_events) = 'array'
      and not jsonb_path_exists(
        starter_deck_events,
        '$[*] ? (!exists(@.id) || @.id == "")'
      )
    )
  );

-- 3. Re-document the column: the shape and the sync direction both changed.
comment on column public.loro_profiles.starter_deck_events is
  'Starter-deck funnel: [{id, name, round, card, at, knewIt?, videoId?, word?, cards?, played?}]. name = card_shown | card_answered | clip_started | clip_completed | round_completed | skipped; round is 1-based (0 = no round reached); card is 1-based within the round, null for clip/round events. Union-merged on id by the client, idempotently — see lib/starterEvents.ts.';
