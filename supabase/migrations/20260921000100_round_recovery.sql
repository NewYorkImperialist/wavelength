-- ---------------------------------------------------------------------------
-- Recovery when the Psychic leaves before giving their clue.
--
-- The round cannot simply continue: the departing player saw the target and
-- may still be in the room watching. So the target is re-rolled along with the
-- handover, and a fresh commitment is published.
--
-- Same access rule as the other secret functions: SECURITY DEFINER, reachable
-- only by service_role.
-- ---------------------------------------------------------------------------

create or replace function public.replace_round_target(
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
  values (p_round_id, p_target, p_nonce)
  on conflict (round_id) do update
    set target_center = excluded.target_center,
        nonce         = excluded.nonce,
        created_at    = now();
end;
$$;

revoke all on function public.replace_round_target(uuid, smallint, bytea)
  from public, anon, authenticated;
grant execute on function public.replace_round_target(uuid, smallint, bytea)
  to service_role;
