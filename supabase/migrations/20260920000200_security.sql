-- ---------------------------------------------------------------------------
-- Wavelength: grants, row level security, and the realtime publication
--
-- The security model in one line: browsers can READ their own room and write
-- NOTHING. Every mutation goes through a Next.js route handler holding the
-- service role key, which validates phase, actor and team before touching a
-- row.
--
-- Grants are the real boundary here, not policies. A policy is a filter you
-- have to get right; an absent grant is a wall.
-- ---------------------------------------------------------------------------

-- Start from deny. Supabase grants broadly to anon/authenticated by default.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Read-only, and only these tables. `anon` is granted nothing at all: a bare
-- anon key is useless against this project until it is exchanged for a
-- room-scoped player token.
grant select on
  public.rooms,
  public.players,
  public.games,
  public.rounds,
  public.game_used_cards,
  public.spectrum_cards
to authenticated;

-- service_role is the only writer. Supabase grants it these by default, but
-- state them explicitly: the `revoke all ... from anon, authenticated` above is
-- easy to widen by accident, and a project restored from a dump should not
-- depend on defaults for the role that runs every mutation.
grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- No INSERT/UPDATE/DELETE to anyone but service_role. Note there are no write
-- policies below either, so even a future accidental `grant insert` would hit
-- RLS default-deny rather than silently opening a hole.

-- ---------------------------------------------------------------------------
-- Room scoping
--
-- Players are anonymous: there is no auth.users row. The server mints a
-- short-lived HS256 JWT carrying the player's room, and PostgREST/Realtime
-- validate it because it is signed with the project's JWT secret. RLS then
-- reads the claim.
-- ---------------------------------------------------------------------------

create or replace function public.jwt_room_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'room_id', '')::uuid
$$;

grant execute on function public.jwt_room_id() to authenticated;

alter table public.rooms           enable row level security;
alter table public.players         enable row level security;
alter table public.games           enable row level security;
alter table public.rounds          enable row level security;
alter table public.game_used_cards enable row level security;
alter table public.spectrum_cards  enable row level security;

create policy rooms_select_own_room on public.rooms
  for select to authenticated
  using (id = public.jwt_room_id());

create policy players_select_own_room on public.players
  for select to authenticated
  using (room_id = public.jwt_room_id());

create policy games_select_own_room on public.games
  for select to authenticated
  using (room_id = public.jwt_room_id());

create policy rounds_select_own_room on public.rounds
  for select to authenticated
  using (room_id = public.jwt_room_id());

create policy game_used_cards_select_own_room on public.game_used_cards
  for select to authenticated
  using (exists (
    select 1 from public.games g
    where g.id = game_used_cards.game_id
      and g.room_id = public.jwt_room_id()
  ));

-- Card text is public game content, not per-room.
create policy spectrum_cards_select_enabled on public.spectrum_cards
  for select to authenticated
  using (enabled);

-- ---------------------------------------------------------------------------
-- Realtime publication
--
-- Explicit opt-in, one table at a time. `private.round_targets` and
-- `private.player_sessions` are deliberately absent and must stay that way:
-- adding them would put their contents into WAL records that Realtime fans out
-- to subscribers, which no column grant can prevent.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.rounds;

-- Needed so subscribers receive the previous row on updates and deletes.
-- Safe only because none of these tables ever holds a pre-reveal secret.
alter table public.rooms   replica identity full;
alter table public.players replica identity full;
alter table public.games   replica identity full;
alter table public.rounds  replica identity full;

-- ---------------------------------------------------------------------------
-- A standing check against the mistake this design is built to prevent.
-- Fails the migration if a private table is ever added to the publication.
-- ---------------------------------------------------------------------------

do $$
declare
  leaked text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into leaked
    from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'private';

  if leaked is not null then
    raise exception
      'Private tables are published to Realtime: %. Secrets must never be in the publication.',
      leaked;
  end if;
end;
$$;
