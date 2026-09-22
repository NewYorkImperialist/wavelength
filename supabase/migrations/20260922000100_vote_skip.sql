-- ---------------------------------------------------------------------------
-- Vote-skip: the room can throw away a card it cannot work with.
--
-- Some spectrums are simply unclueable for the Psychic who drew them. Before
-- this the only escape was restarting the whole game, so people sat on a dead
-- card or quit. A strict majority now deals a replacement.
--
-- The replacement keeps the SAME round row: same id, same round_number, same
-- Psychic. That is partly the rule we want — drawing a bad card should not
-- cost anyone their turn — and partly what the schema already insists on,
-- since `rounds_game_number_uidx` is unique on (game_id, round_number) and
-- `round_phase` has no value for an abandoned round. Rewriting the card in
-- place needs neither a new enum value nor a relaxed constraint.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- the votes
-- ---------------------------------------------------------------------------

create table if not exists public.round_skip_votes (
  round_id   uuid not null references public.rounds(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  -- The card the vote was cast against, which is what makes rewriting the
  -- round in place safe. A reroll changes `rounds.card_id`, and that alone
  -- makes every vote for the previous card inert — including one that was
  -- still in flight when the card changed. Without this column such a vote
  -- would count towards binning a replacement its author never saw.
  card_id    text not null references public.spectrum_cards(id),
  created_at timestamptz not null default now(),
  primary key (round_id, player_id, card_id)
);

create index if not exists round_skip_votes_round_idx
  on public.round_skip_votes (round_id, card_id);

-- Same posture as round_guesses: no secret here, and the room may read it —
-- watching the tally move is what makes this a vote rather than a silent host
-- power. The browser never queries Supabase directly, so in practice this is
-- defence in depth behind the service-role routes.
alter table public.round_skip_votes enable row level security;

create policy round_skip_votes_select_own_room on public.round_skip_votes
  for select to authenticated
  using (exists (
    select 1 from public.rounds r
    where r.id = round_skip_votes.round_id
      and r.room_id = public.jwt_room_id()
  ));

grant select on public.round_skip_votes to authenticated;
grant all privileges on public.round_skip_votes to service_role;

-- Deliberately NOT added to supabase_realtime. Clients learn that the tally
-- moved from the room broadcast and re-read the bootstrap payload, the way
-- they learn about everything else; publishing the rows as well would put a
-- second serialisation path in front of data that has one already.

comment on table public.round_skip_votes is
  'Standing votes to discard the card a round is showing. Keyed by card, so a reroll invalidates the previous round''s votes without deleting them.';

-- ---------------------------------------------------------------------------
-- the reroll
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER for the same reason as the other secret functions: the
-- target lives in `private`, which PostgREST cannot address even for
-- service_role. EXECUTE is granted to service_role alone, below.
create or replace function public.reroll_round_card(
  p_round_id    uuid,
  p_expect_card text,
  p_card_id     text,
  p_target      smallint,
  p_nonce       bytea,
  p_commitment  bytea
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
begin
  -- Compare-and-swap on the card. Two players can cast the deciding vote at
  -- the same instant; only the one whose expected card is still on the round
  -- wins, and the loser is told `false` rather than skipping a second card
  -- that nobody had a chance to read.
  --
  -- The phase clause does the same job against a clue already in flight: if
  -- the Psychic's clue landed first the round has moved to 'guess' and the
  -- skip is simply too late.
  update public.rounds
     set card_id           = p_card_id,
         target_commitment = p_commitment
   where id      = p_round_id
     and phase   = 'clue'
     and card_id = p_expect_card
  returning game_id into v_game_id;

  if v_game_id is null then
    return false;
  end if;

  -- The target and its commitment have to move together or the published
  -- commitment is a lie, and the one thing it exists to prove — that the
  -- server did not move the target after seeing the needles — stops being
  -- provable. Two round trips from the server could be interrupted between
  -- them; one function cannot.
  insert into private.round_targets (round_id, target_center, nonce)
  values (p_round_id, p_target, p_nonce)
  on conflict (round_id) do update
    set target_center = excluded.target_center,
        nonce         = excluded.nonce,
        created_at    = now();

  -- The skipped card was already recorded as used at round creation and stays
  -- that way, so a card the room rejected cannot come back this game. The
  -- replacement is recorded now, for the same reason.
  insert into public.game_used_cards (game_id, card_id)
  values (v_game_id, p_card_id)
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function
  public.reroll_round_card(uuid, text, text, smallint, bytea, bytea)
  from public, anon, authenticated;
grant execute on function
  public.reroll_round_card(uuid, text, text, smallint, bytea, bytea)
  to service_role;
