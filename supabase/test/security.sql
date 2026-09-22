-- ---------------------------------------------------------------------------
-- Adversarial tests for the secret-target design.
--
-- Each block attempts something a cheating player would try and fails the
-- script if it succeeds. Run with: psql -v ON_ERROR_STOP=1 -f security.sql
-- ---------------------------------------------------------------------------

\set QUIET on
\pset tuples_only on

-- --- fixtures, created as the owner (re-runnable) --------------------------

delete from private.round_targets
 where round_id = '44444444-4444-4444-4444-444444444444';
delete from rounds where id = '44444444-4444-4444-4444-444444444444';

insert into rooms (id, code, status)
values ('11111111-1111-1111-1111-111111111111', 'ABCDEF', 'in_game')
on conflict do nothing;

insert into rooms (id, code, status)
values ('22222222-2222-2222-2222-222222222222', 'GHJKLM', 'in_game')
on conflict do nothing;

insert into players (id, room_id, display_name, team, is_host, seat_order)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ada', 'a', true, 0),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Bo',  'b', false, 0),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cy',  'a', true, 0)
on conflict do nothing;

insert into games (id, room_id, starting_team)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'a')
on conflict do nothing;

insert into rounds (id, game_id, room_id, round_number, active_team, psychic_player_id, card_id, target_commitment)
values ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111', 1, 'a',
        'aaaaaaaa-0000-0000-0000-000000000001', 'c001', '\x00')
on conflict do nothing;

select place_round_target('44444444-4444-4444-4444-444444444444'::uuid, 1337::smallint, '\x0102030405060708090a0b0c0d0e0f10'::bytea);

\pset tuples_only off
\set QUIET off

-- ===========================================================================
\echo '--- T1: the secret is NOT in the realtime publication'
do $$
declare n int;
begin
  select count(*) into n from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'private';
  if n > 0 then raise exception 'FAIL T1: % private tables published', n; end if;
  raise notice 'PASS T1: no private tables in the publication';
end; $$;

-- ===========================================================================
\echo '--- T2: rounds carries no secret before the reveal'
do $$
declare r record;
begin
  select revealed_target, active_points, opponent_points into r
    from rounds where id = '44444444-4444-4444-4444-444444444444';
  if r.revealed_target is not null then
    raise exception 'FAIL T2: revealed_target is populated pre-reveal';
  end if;
  raise notice 'PASS T2: revealed_target/points are NULL during play';
end; $$;

-- ===========================================================================
\echo '--- T3: anon cannot read the secret table'
do $$
begin
  set local role anon;
  perform 1 from private.round_targets;
  reset role;
  raise exception 'FAIL T3: anon read private.round_targets';
exception
  when insufficient_privilege then
    reset role;
    raise notice 'PASS T3: anon blocked from private.round_targets';
end; $$;

-- ===========================================================================
\echo '--- T4: authenticated cannot read the secret table either'
do $$
begin
  set local role authenticated;
  perform 1 from private.round_targets;
  reset role;
  raise exception 'FAIL T4: authenticated read private.round_targets';
exception
  when insufficient_privilege then
    reset role;
    raise notice 'PASS T4: authenticated blocked from private.round_targets';
end; $$;

-- ===========================================================================
\echo '--- T5: anon cannot call the secret-reading function'
do $$
begin
  set local role anon;
  perform read_round_target('44444444-4444-4444-4444-444444444444'::uuid);
  reset role;
  raise exception 'FAIL T5: anon executed read_round_target';
exception
  when insufficient_privilege then
    reset role;
    raise notice 'PASS T5: anon blocked from read_round_target';
end; $$;

-- ===========================================================================
\echo '--- T6: authenticated cannot call it, nor the session resolver'
do $$
begin
  set local role authenticated;
  perform read_round_target('44444444-4444-4444-4444-444444444444'::uuid);
  reset role;
  raise exception 'FAIL T6: authenticated executed read_round_target';
exception
  when insufficient_privilege then
    reset role;
    raise notice 'PASS T6a: authenticated blocked from read_round_target';
end; $$;

do $$
begin
  set local role authenticated;
  perform resolve_player_session('\x00'::bytea);
  reset role;
  raise exception 'FAIL T6b: authenticated executed resolve_player_session';
exception
  when insufficient_privilege then
    reset role;
    raise notice 'PASS T6b: authenticated blocked from resolve_player_session';
end; $$;

-- ===========================================================================
\echo '--- T7: session token hashes are unreachable'
do $$
begin
  set local role authenticated;
  perform 1 from private.player_sessions;
  reset role;
  raise exception 'FAIL T7: authenticated read private.player_sessions';
exception
  when insufficient_privilege then
    reset role;
    raise notice 'PASS T7: session hashes are unreachable';
end; $$;

-- ===========================================================================
\echo '--- T8: a player sees only their own room'
do $$
declare mine int; theirs int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"room_id":"11111111-1111-1111-1111-111111111111"}';

  select count(*) into mine   from rounds  where room_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into theirs from players where room_id = '22222222-2222-2222-2222-222222222222';
  reset role;

  if mine <> 1 then raise exception 'FAIL T8: cannot see own room (% rounds)', mine; end if;
  if theirs <> 0 then raise exception 'FAIL T8: leaked % players from another room', theirs; end if;
  raise notice 'PASS T8: RLS scopes reads to the caller''s room';
end; $$;

-- ===========================================================================
\echo '--- T9: an unscoped token sees nothing at all'
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{}';
  select count(*) into n from players;
  reset role;
  if n <> 0 then raise exception 'FAIL T9: unscoped token saw % players', n; end if;
  raise notice 'PASS T9: no room claim means no rows';
end; $$;

-- ===========================================================================
\echo '--- T10: browsers cannot write anything'
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"room_id":"11111111-1111-1111-1111-111111111111"}';
  update rounds set clue = 'cheating' where id = '44444444-4444-4444-4444-444444444444';
  reset role;
  raise exception 'FAIL T10: authenticated wrote to rounds';
exception
  when insufficient_privilege then
    reset role;
    raise notice 'PASS T10a: authenticated cannot UPDATE rounds';
end; $$;

do $$
begin
  set local role authenticated;
  update games set score_a = 99 where id = '33333333-3333-3333-3333-333333333333';
  reset role;
  raise exception 'FAIL T10b: authenticated changed a score';
exception
  when insufficient_privilege then
    reset role;
    raise notice 'PASS T10b: authenticated cannot change scores';
end; $$;

-- ===========================================================================
\echo '--- T11: the round constraints reject impossible states'
do $$
begin
  update rounds set phase = 'reveal'
   where id = '44444444-4444-4444-4444-444444444444';
  raise exception 'FAIL T11: reached reveal with no target or points';
exception
  when check_violation then
    raise notice 'PASS T11: cannot enter reveal without a scored result';
end; $$;

-- ===========================================================================
\echo '--- T12: service_role can still do its job'
do $$
declare v smallint;
begin
  select read_round_target('44444444-4444-4444-4444-444444444444'::uuid) into v;
  if v <> 1337 then raise exception 'FAIL T12: got % instead of the target', v; end if;
  raise notice 'PASS T12: the server can read the target (%).', v;
end; $$;

\echo ''
\echo 'All security assertions passed.'

-- ===========================================================================
\echo '--- T13: the set-returning secret accessor actually executes'
do $$
declare r record;
begin
  -- Regression guard: target_center is a DOMAIN over smallint, and RETURNS
  -- TABLE compares types strictly. Without an explicit cast this raises 42804
  -- at call time, which no amount of schema inspection would reveal.
  select * into r from public.take_round_target('44444444-4444-4444-4444-444444444444'::uuid);
  if r.target_center <> 1337 then
    raise exception 'FAIL T13: got % instead of the target', r.target_center;
  end if;
  raise notice 'PASS T13: take_round_target returns the target and nonce';
end; $$;

-- ===========================================================================
-- Vote-skip. The reroll rewrites the card on the live round row, so the
-- interesting cases are all about what happens when something else is
-- touching that row at the same time.
-- ===========================================================================

\echo '--- T14: a carried vote swaps the card, the target and the commitment'
do $$
declare
  v_ok        boolean;
  v_card      text;
  v_commit    bytea;
  v_target    smallint;
begin
  insert into round_skip_votes (round_id, player_id, card_id)
  values ('44444444-4444-4444-4444-444444444444',
          'aaaaaaaa-0000-0000-0000-000000000001', 'c001')
  on conflict do nothing;

  select public.reroll_round_card(
    '44444444-4444-4444-4444-444444444444'::uuid,
    'c001', 'c002', 777::smallint,
    '\x1111111111111111111111111111111111'::bytea, '\xbeef'::bytea) into v_ok;

  if not v_ok then raise exception 'FAIL T14: the reroll refused a valid swap'; end if;

  select card_id, target_commitment into v_card, v_commit
    from rounds where id = '44444444-4444-4444-4444-444444444444';
  if v_card <> 'c002' then raise exception 'FAIL T14: card is still %', v_card; end if;
  if v_commit <> '\xbeef'::bytea then
    raise exception 'FAIL T14: the commitment was not republished';
  end if;

  -- The commitment is only worth anything if the target moved with it.
  select read_round_target('44444444-4444-4444-4444-444444444444'::uuid) into v_target;
  if v_target <> 777 then
    raise exception 'FAIL T14: target is % — the commitment is now a lie', v_target;
  end if;

  if not exists (select 1 from game_used_cards
                  where game_id = '33333333-3333-3333-3333-333333333333'
                    and card_id = 'c002') then
    raise exception 'FAIL T14: the replacement card was not recorded as used';
  end if;

  raise notice 'PASS T14: card, target and commitment all moved together';
end; $$;

-- ===========================================================================
\echo '--- T15: the second of two simultaneous skips is refused'
do $$
declare v_ok boolean; v_card text;
begin
  -- Exactly what the losing request of a tie sends: the card it read before
  -- the other one won. It must not skip a second card nobody had read.
  select public.reroll_round_card(
    '44444444-4444-4444-4444-444444444444'::uuid,
    'c001', 'c003', 888::smallint,
    '\x2222222222222222222222222222222222'::bytea, '\xf00d'::bytea) into v_ok;

  if v_ok then raise exception 'FAIL T15: a stale expected card was accepted'; end if;

  select card_id into v_card from rounds where id = '44444444-4444-4444-4444-444444444444';
  if v_card <> 'c002' then raise exception 'FAIL T15: the card changed anyway (%)', v_card; end if;

  raise notice 'PASS T15: a stale expected card is refused and nothing moves';
end; $$;

-- ===========================================================================
\echo '--- T16: votes against the discarded card do not carry over'
do $$
declare n int;
begin
  -- Ada''s vote from T14 is still on the table, but it names c001. Counting
  -- votes for the card actually in play has to ignore it, or the replacement
  -- would arrive already part-way to being binned.
  select count(*) into n from round_skip_votes
   where round_id = '44444444-4444-4444-4444-444444444444' and card_id = 'c002';
  if n <> 0 then raise exception 'FAIL T16: % vote(s) carried over to the new card', n; end if;

  if not exists (select 1 from round_skip_votes
                  where round_id = '44444444-4444-4444-4444-444444444444'
                    and card_id = 'c001') then
    raise exception 'FAIL T16: the old vote vanished instead of going inert';
  end if;

  raise notice 'PASS T16: old votes go inert rather than following the round';
end; $$;

-- ===========================================================================
\echo '--- T17: once the clue is given it is too late to skip'
do $$
declare v_ok boolean;
begin
  update rounds set clue = 'Batman', phase = 'guess'
   where id = '44444444-4444-4444-4444-444444444444';

  select public.reroll_round_card(
    '44444444-4444-4444-4444-444444444444'::uuid,
    'c002', 'c004', 999::smallint,
    '\x3333333333333333333333333333333333'::bytea, '\xcafe'::bytea) into v_ok;

  if v_ok then
    raise exception 'FAIL T17: skipped a card the room had already been clued';
  end if;

  raise notice 'PASS T17: the reroll is refused outside the clue phase';
end; $$;
