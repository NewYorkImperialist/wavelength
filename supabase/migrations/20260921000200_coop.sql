-- ---------------------------------------------------------------------------
-- Co-op: everyone on one team, nobody to call left or right.
--
-- The reveal previously required a left/right call to exist. In co-op there
-- is no opposing team to make one, so the round goes straight from the locked
-- guess to the reveal with prediction left null.
--
-- The remaining reveal constraint still holds the important invariant: a
-- revealed round must have both a target and a score.
-- ---------------------------------------------------------------------------

alter table public.rounds
  drop constraint if exists rounds_prediction_present_after_prediction;

comment on column public.rounds.prediction is
  'The opposing team''s left/right call. Null in co-op, where there is no opposing team to make one.';
