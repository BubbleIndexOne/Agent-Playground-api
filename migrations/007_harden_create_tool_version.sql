-- ============================================================
-- Migration 007: Harden create_tool_version RPC
--
-- 1. Add SELECT ... FOR UPDATE row lock on the parent tools row before
--    computing max(version_number) to serialize concurrent version creation
--    for the same tool (Fix #5).
--
-- 2. Add p_test_results_json parameter so the RPC can persist test results
--    atomically as part of version creation.
--
-- 3. Pin search_path to pg_catalog, pg_temp on the SECURITY DEFINER
--    function to prevent schema-injection attacks (Fix #3).
--
-- 4. Revoke EXECUTE from anon and authenticated roles; only service_role
--    (i.e., the backend worker via Hyperdrive) may call this function
--    directly (Fix #4).
-- ============================================================

-- Drop all previous overloads so the signature change is clean.
drop function if exists public.create_tool_version(uuid, text, jsonb, jsonb, text);
drop function if exists public.create_tool_version(uuid, text, jsonb, jsonb, text, jsonb);

-- ────────────────────────────────────────────────────────────
-- 1 + 2 + 3. Recreate function with row lock, test_results_json
--             parameter, and pinned search_path
-- ────────────────────────────────────────────────────────────
create or replace function public.create_tool_version(
  p_tool_id            uuid,
  p_code               text,
  p_schema_json        jsonb,
  p_capabilities_json  jsonb  default '[]'::jsonb,
  p_code_hash          text   default null,
  p_test_results_json  jsonb  default null
) returns setof public.tool_versions as $$
declare
  v_next_version int;
  v_new_row      public.tool_versions;
begin
  -- Serialize concurrent version creation for the same tool.
  -- Acquires a row-level FOR UPDATE lock on the parent tools row so that
  -- any parallel call for the same p_tool_id blocks here until the first
  -- transaction commits, guaranteeing sequential version_number values.
  perform id from public.tools where id = p_tool_id for update;

  if not found then
    raise exception 'Tool % not found', p_tool_id;
  end if;

  -- Now safe to compute next version number
  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.tool_versions
  where tool_id = p_tool_id;

  -- Insert new version record
  insert into public.tool_versions (
    tool_id,
    version_number,
    code,
    schema_json,
    capabilities_json,
    code_hash,
    test_results_json
  ) values (
    p_tool_id,
    v_next_version,
    p_code,
    p_schema_json,
    coalesce(p_capabilities_json, '[]'::jsonb),
    p_code_hash,
    p_test_results_json
  )
  returning * into v_new_row;

  -- Atomically update tool shell's current_version_id
  update public.tools
  set current_version_id = v_new_row.id,
      updated_at         = now()
  where id = p_tool_id;

  return next v_new_row;
end;
$$ language plpgsql security definer
   set search_path = pg_catalog, pg_temp;

-- ────────────────────────────────────────────────────────────
-- 4. Tighten EXECUTE grants: remove anon and authenticated.
--    Only service_role (backend worker) may invoke this RPC.
-- ────────────────────────────────────────────────────────────
revoke execute on function public.create_tool_version(uuid, text, jsonb, jsonb, text, jsonb)
  from anon, authenticated;

-- service_role: explicit grant (idempotent).
grant execute on function public.create_tool_version(uuid, text, jsonb, jsonb, text, jsonb)
  to service_role;
