-- Starter-deck funnel: where users stop inside the interleaved rounds.
--
-- The deck is three rounds of word cards, each followed by the clip that
-- speaks those words. The question it cannot answer without per-index data is
-- WHERE people leave: quitting on round 1 card 3 means badly ordered, quitting
-- on round 3 means too long, and the two have opposite fixes. So the client
-- logs (kind, round, card) per event and mirrors the whole log here.
--
-- A jsonb column on the profile row rather than an events table, matching
-- save_prompt_stats: the payload is one bounded array per user (~25 entries a
-- run, hard-capped at 240 client-side), it is written once at sign-in and
-- read only by us, and it inherits the profile row's RLS instead of needing
-- its own policies.
--
-- Push-only from the client (lib/storage.ts syncDeckEvents): the log is a
-- measurement of what happened on a device, not user data to restore, so it is
-- never merged back down — merging two devices' funnels would describe a run
-- nobody performed. Anonymous users log locally and upload on sign-in, exactly
-- like saved words.
--
-- Nullable with no default: everyone who onboarded before this feature simply
-- has no log, and the client only pushes when it holds at least one event. An
-- update against a not-yet-migrated DB fails on the unknown column, is logged,
-- and retries at the next auth event.
--
-- Idempotent: replaying yields the same end state.

alter table public.loro_profiles
  add column if not exists starter_deck_events jsonb;

comment on column public.loro_profiles.starter_deck_events is
  'Starter-deck funnel events [{kind, round, card, at, videoId?, word?, knew?, played?}]. Push-only measurement; see lib/deckEvents.ts.';
