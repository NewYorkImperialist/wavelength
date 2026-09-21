-- ---------------------------------------------------------------------------
-- Wavelength: core schema
--
-- Design rule that governs this whole file: the hidden target NEVER lives in a
-- table that is published to Realtime. Supabase's postgres_changes RLS check is
-- row-level only and does not honour column privileges, so the WAL record for a
-- `rounds` UPDATE would carry a secret column to every subscriber even if a
-- REST SELECT of it were revoked. The secret therefore lives in its own
-- `private` schema, which PostgREST cannot address at all.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from anon, authenticated, public;
grant usage on schema private to service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type team_side   as enum ('a', 'b');
create type room_status as enum ('lobby', 'in_game', 'finished');
create type round_phase as enum ('clue', 'guess', 'prediction', 'reveal', 'complete');
create type lr_side     as enum ('left', 'right');

-- Positions are stored as integer steps on the engine's 2000-step grid, not as
-- floats. Scoring compares integers, so this keeps the database and the
-- TypeScript engine in exact agreement with no rounding to reconcile.
create domain dial_position as smallint check (value between 0 and 2000);

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------

create table public.rooms (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  status         room_status not null default 'lobby',
  host_player_id uuid,
  winning_score  smallint not null default 10 check (winning_score between 1 and 50),
  created_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  -- Unambiguous alphabet: no I, O, 0 or 1 to misread over a video call.
  constraint rooms_code_format check (code ~ '^[A-HJ-NP-Z2-9]{6}$')
);

-- A code is only reserved while the room is live; finished rooms release it.
create unique index rooms_code_live_uidx on public.rooms (code) where status <> 'finished';
create index rooms_last_active_idx on public.rooms (last_active_at);

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------

create table public.players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 24),
  team         team_side,
  is_host      boolean not null default false,
  -- Append-only psychic rotation order within a team.
  seat_order   integer not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at      timestamptz
);

create index players_room_idx on public.players (room_id) where left_at is null;
create unique index players_seat_uidx
  on public.players (room_id, team, seat_order)
  where team is not null and left_at is null;

alter table public.rooms
  add constraint rooms_host_fk foreign key (host_player_id)
  references public.players(id) on delete set null;

-- Session tokens are per-player secrets, so they get the same treatment as the
-- target: out of any table that Realtime publishes.
create table private.player_sessions (
  player_id    uuid primary key references public.players(id) on delete cascade,
  token_hash   bytea not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- spectrum cards (public reference content)
-- ---------------------------------------------------------------------------

create table public.spectrum_cards (
  id          text primary key,
  left_label  text not null check (char_length(btrim(left_label)) > 0),
  right_label text not null check (char_length(btrim(right_label)) > 0),
  deck        text not null default 'base',
  enabled     boolean not null default true
);

create unique index spectrum_cards_pair_uidx
  on public.spectrum_cards (lower(left_label), lower(right_label));

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

create table public.games (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  score_a       smallint not null default 0 check (score_a >= 0),
  score_b       smallint not null default 0 check (score_b >= 0),
  starting_team team_side not null,
  status        room_status not null default 'in_game',
  winner        team_side,
  -- 0 = regulation play. >0 = the nth sudden-death round. Mirrors the engine's
  -- nullable SuddenDeathState rather than a boolean flag.
  sudden_death_index  smallint not null default 0 check (sudden_death_index >= 0),
  sudden_death_turns  smallint not null default 0 check (sudden_death_turns between 0 and 2),
  sudden_death_pts_a  smallint not null default 0,
  sudden_death_pts_b  smallint not null default 0,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create unique index games_room_active_uidx on public.games (room_id) where status = 'in_game';

-- Cards already drawn this game, so a spectrum never repeats.
create table public.game_used_cards (
  game_id uuid not null references public.games(id) on delete cascade,
  card_id text not null references public.spectrum_cards(id),
  primary key (game_id, card_id)
);

-- ---------------------------------------------------------------------------
-- rounds  (PUBLIC — contains no secret while the round is live)
-- ---------------------------------------------------------------------------

create table public.rounds (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references public.games(id) on delete cascade,
  room_id           uuid not null references public.rooms(id) on delete cascade,
  round_number      integer not null check (round_number > 0),
  active_team       team_side not null,
  psychic_player_id uuid not null references public.players(id) on delete restrict,
  card_id           text not null references public.spectrum_cards(id),

  phase    round_phase not null default 'clue',
  clue     text check (clue is null or char_length(btrim(clue)) between 1 and 120),
  clue_at  timestamptz,

  needle_controller_id uuid references public.players(id) on delete set null,
  -- Written once, at lock. In-flight dragging is broadcast, never persisted.
  needle_position      dial_position,
  needle_locked_at     timestamptz,

  prediction    lr_side,
  prediction_by uuid references public.players(id) on delete set null,
  prediction_at timestamptz,

  -- All null until the reveal transaction. This is what makes the realtime
  -- payload safe: there is no secret in the row to leak.
  revealed_target dial_position,
  active_points   smallint check (active_points in (0, 2, 3, 4)),
  opponent_points smallint check (opponent_points in (0, 1)),
  revealed_at     timestamptz,

  -- Published at round creation: sha256(nonce || target). Lets a client verify
  -- afterwards that the server did not move the target once it saw the needle.
  target_commitment bytea not null,

  created_at timestamptz not null default now(),

  constraint rounds_clue_present_after_clue_phase
    check (phase = 'clue' or clue is not null),
  constraint rounds_needle_present_after_guess
    check (phase in ('clue', 'guess') or needle_position is not null),
  constraint rounds_prediction_present_after_prediction
    check (phase in ('clue', 'guess', 'prediction') or prediction is not null),
  constraint rounds_reveal_is_all_or_nothing
    check ((phase in ('reveal', 'complete'))
           = (revealed_target is not null and active_points is not null))
);

create unique index rounds_game_number_uidx on public.rounds (game_id, round_number);
create index rounds_room_idx on public.rounds (room_id);

alter table public.games
  add column current_round_id uuid references public.rounds(id) on delete set null;

-- ---------------------------------------------------------------------------
-- THE SECRET
-- ---------------------------------------------------------------------------

create table private.round_targets (
  round_id      uuid primary key references public.rounds(id) on delete cascade,
  target_center dial_position not null,
  -- 16 random bytes, so the published commitment cannot be brute-forced even
  -- though target_center has only ~1750 possible values.
  nonce         bytea not null check (octet_length(nonce) >= 16),
  created_at    timestamptz not null default now()
);

-- Defence in depth. The real barrier is that `private` is not an exposed
-- schema and neither anon nor authenticated holds any grant on it; RLS with no
-- permissive policy is simply a third lock on the same door.
alter table private.round_targets enable row level security;
alter table private.round_targets force row level security;
alter table private.player_sessions enable row level security;
alter table private.player_sessions force row level security;

grant select, insert, update, delete on private.round_targets  to service_role;
grant select, insert, update, delete on private.player_sessions to service_role;
