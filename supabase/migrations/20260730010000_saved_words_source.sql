-- Where a saved word came from: 'user' (they chose it) or 'deck' (we granted it).
--
-- WHY A COLUMN AND NOT A DERIVED TEST. Until now "was this a grant" was
-- answered by `video_id = 'starter'`, the pseudo id the old linear starter deck
-- and the calibration escape hatch saved against. The reworked deck teaches its
-- words over REAL clips, so its rows carry real video ids and are
-- indistinguishable from feed saves by any other field. The provenance has to
-- be recorded at write time or it is gone.
--
-- WHAT READS IT. Exactly two gate counters, both via
-- lib/entitlements/limit.ts countsTowardLimit():
--   * the anonymous account prompt (SAVE_PROMPT_THRESHOLD, 10 words)
--   * the free-tier saved-words ceiling (FREE_TIER_SAVED_WORDS_LIMIT, 50)
-- Both measure demonstrated behaviour, and a word we handed the user is not
-- behaviour: the deck grants 9, so counting them would make a beginner's first
-- real save trip the account prompt. Nothing else branches on this — deck words
-- keep their normal SRS schedule, appear in /vocab, and are reviewable and
-- deletable exactly like any other row.
--
-- DEFAULT 'user', and existing rows become 'user'. That is what they are: every
-- row written before this column existed came from a surface that either was a
-- real user save, or used the 'starter' pseudo id — and those latter rows stay
-- exempt anyway, because the client keeps treating that pseudo id as a grant
-- when it back-fills. NOT NULL with a default, so no reader ever has to handle
-- an absent value server-side (the client still defaults defensively, for rows
-- an older build may write).
--
-- Idempotent: replaying yields the same end state.

alter table public.loro_saved_words
  add column if not exists source text not null default 'user';

alter table public.loro_saved_words
  drop constraint if exists loro_saved_words_source_check;

alter table public.loro_saved_words
  add constraint loro_saved_words_source_check
  check (source in ('user', 'deck'));

-- Back-fill the OLD deck's rows, which are identifiable by the pseudo video id
-- they were saved against. Without this, a user who ran the linear deck before
-- this migration would have ~80 granted words counting toward their gates.
update public.loro_saved_words
  set source = 'deck'
  where video_id = 'starter' and source <> 'deck';

comment on column public.loro_saved_words.source is
  '''user'' = the user chose this word; ''deck'' = granted by the starter deck or calibration. Only the two gate counters read it — see lib/entitlements/limit.ts.';
