-- ---------------------------------------------------------------------------
-- Free-for-all: no teams, everyone places their own needle.
--
-- A departure from the printed rules, which are a team game. One Psychic gives
-- a clue, every other player commits their own guess, and each scores their
-- own result — the Psychic taking the average of the rest, so a clue that
-- lands the room near the target is worth giving.
--
-- Everyone sits on team 'a' internally. Teams are not modelled away entirely
-- because `rounds.active_team` and the psychic rotation are built on them, and
-- a single-sided game is a valid configuration of that machinery rather than a
-- special case bolted beside it.
-- ---------------------------------------------------------------------------

-- Per-player running total.
alter table public.players
  add column if not exists score smallint not null default 0 check (score >= 0);

-- One committed guess per player per round.
create table if not exists public.round_guesses (
  round_id   uuid not null references public.rounds(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  position   dial_position not null,
  -- Filled at the reveal, so the result is inspectable per player afterwards.
  points     smallint check (points in (0, 2, 3, 4)),
  created_at timestamptz not null default now(),
  primary key (round_id, player_id)
);

create index if not exists round_guesses_round_idx on public.round_guesses (round_id);

-- Readable by the room, like every other public table. The guess is not a
-- secret — it is the whole point that everyone sees where you landed — but it
-- is only published once the round reveals, because the server writes points
-- at that moment and clients render from the bootstrap payload.
alter table public.round_guesses enable row level security;

create policy round_guesses_select_own_room on public.round_guesses
  for select to authenticated
  using (exists (
    select 1 from public.rounds r
    where r.id = round_guesses.round_id
      and r.room_id = public.jwt_room_id()
  ));

grant select on public.round_guesses to authenticated;
grant all privileges on public.round_guesses to service_role;

alter publication supabase_realtime add table public.round_guesses;
alter table public.round_guesses replica identity full;

-- A free-for-all round has no single needle of record, so the constraint
-- requiring one after the guessing phase no longer holds.
alter table public.rounds
  drop constraint if exists rounds_needle_present_after_guess;

comment on table public.round_guesses is
  'One committed needle per player per round, in free-for-all. Contains no secret: guesses are public once revealed, and the target lives in private.round_targets.';
