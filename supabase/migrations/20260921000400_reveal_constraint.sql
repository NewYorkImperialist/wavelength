-- ---------------------------------------------------------------------------
-- Loosen the reveal constraint for free-for-all.
--
-- It required active_points to be set whenever a round reached 'reveal', which
-- was right for the team game: the active team always scored something, even
-- if zero. Free-for-all has no team score at all — points live per player in
-- round_guesses — so the round could never legally reveal.
--
-- The invariant worth keeping is narrower: a revealed round must have a
-- revealed target. That is what makes the reveal meaningful, and what stops a
-- round claiming to be over while the answer is still hidden.
-- ---------------------------------------------------------------------------

alter table public.rounds
  drop constraint if exists rounds_reveal_is_all_or_nothing;

alter table public.rounds
  add constraint rounds_revealed_has_a_target
  check ((phase in ('reveal', 'complete')) = (revealed_target is not null));
