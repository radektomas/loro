-- Measurement for the "save your progress" account prompt.
--
-- The prompt thresholds (lib/savePrompt.ts SAVE_PROMPT) are guesses at the
-- current user count. This column is how they stop being guesses: on
-- sign-in, the client mirrors its local prompt state here, so conversion can
-- be queried server-side. One jsonb column, not discrete columns — the
-- payload is small, written whole, and its shape belongs to the client
-- (PromptRecord in lib/savePrompt.ts):
--
--   { "sessions": 4,
--     "p1": { "shownAt": 1753..., "words": 12, "outcome": "converted" },
--     "p2": null }
--
-- Only users who SIGN IN ever write it — anonymous users who never convert
-- are invisible by design (no analytics, no tracker; accepted trade-off).
-- Null means "never met a prompt before signing in", itself a data point:
-- these users converted through the /profile entry point instead.
--
-- Example: was 10 too high or too low?
--   select save_prompt_stats->'p1'->>'outcome' as outcome,
--          (save_prompt_stats->'p1'->>'words')::int as words_at_show,
--          count(*)
--   from loro_profiles
--   where save_prompt_stats ? 'p1'
--   group by 1, 2 order by 2;

alter table public.loro_profiles
  add column if not exists save_prompt_stats jsonb;
