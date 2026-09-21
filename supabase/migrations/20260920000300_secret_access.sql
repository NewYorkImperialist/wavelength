-- ---------------------------------------------------------------------------
-- Controlled access to the secret schema.
--
-- `private` is deliberately NOT in PostgREST's exposed schemas, which is one of
-- the three barriers protecting the target. But that cuts both ways: the
-- server's own PostgREST client cannot reach it either, not even with the
-- service role key.
--
-- So access goes through SECURITY DEFINER functions that live in `public`
-- (addressable) but whose EXECUTE privilege is granted ONLY to service_role.
-- This keeps every barrier: the schema stays unexposed, anon and authenticated
-- still hold no grant on it, and it stays out of the realtime publication.
--
-- Each function is minimal and does one thing, so the amount of code running
-- with elevated rights stays small enough to audit at a glance.
-- ---------------------------------------------------------------------------

-- --- write the target for a new round --------------------------------------

create or replace function public.place_round_target(
  p_round_id uuid,
  p_target   smallint,
  p_nonce    bytea
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.round_targets (round_id, target_center, nonce)
  values (p_round_id, p_target, p_nonce);
end;
$$;

-- --- read it back, for the Psychic ------------------------------------------

create or replace function public.read_round_target(p_round_id uuid)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target smallint;
begin
  select target_center into v_target
    from private.round_targets
   where round_id = p_round_id;
  return v_target;
end;
$$;

-- --- read target and nonce together, for the reveal -------------------------

create or replace function public.take_round_target(p_round_id uuid)
returns table (target_center smallint, nonce bytea)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- target_center is the `dial_position` DOMAIN, not a bare smallint, and
  -- RETURNS TABLE compares the two strictly — without this cast Postgres
  -- raises 42804 at call time. (read_round_target avoids it only because
  -- SELECT INTO casts implicitly on assignment.)
  return query
    select t.target_center::smallint, t.nonce
      from private.round_targets t
     where t.round_id = p_round_id;
end;
$$;

-- --- session tokens ---------------------------------------------------------

create or replace function public.create_player_session(
  p_player_id  uuid,
  p_token_hash bytea
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.player_sessions (player_id, token_hash)
  values (p_player_id, p_token_hash)
  on conflict (player_id) do update
    set token_hash = excluded.token_hash,
        last_seen_at = now();
end;
$$;

create or replace function public.resolve_player_session(p_token_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
begin
  select player_id into v_player_id
    from private.player_sessions
   where token_hash = p_token_hash;

  if v_player_id is not null then
    update private.player_sessions
       set last_seen_at = now()
     where player_id = v_player_id;
  end if;

  return v_player_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock every one of them to service_role.
--
-- Without these revokes a SECURITY DEFINER function is callable by anyone
-- holding the anon key, and the entire protection would be the function body.
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.place_round_target(uuid, smallint, bytea)',
    'public.read_round_target(uuid)',
    'public.take_round_target(uuid)',
    'public.create_player_session(uuid, bytea)',
    'public.resolve_player_session(bytea)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
