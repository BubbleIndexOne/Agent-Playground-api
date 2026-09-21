-- ============================================================
-- Migration 007: Update create_tool_version RPC Security & Features
--
-- 1. Adds row lock (FOR UPDATE) on parent tools record before computing max version
-- 2. Adds p_test_results_json parameter support
-- 3. Sets SECURITY DEFINER search_path = pg_catalog, pg_temp
-- 4. Revokes execute from public/anon/authenticated and grants execute to service_role
-- ============================================================

drop function if exists public.create_tool_version(uuid, text, jsonb, jsonb, text);
drop function if exists public.create_tool_version(uuid, text, jsonb, jsonb, text, jsonb);
drop function if exists public.create_tool_version(uuid, text, jsonb, jsonb, text, jsonb, text);

create or replace function public.create_tool_version(
  p_tool_id uuid,
  p_code text,
  p_schema_json jsonb,
  p_capabilities_json jsonb default '[]'::jsonb,
  p_code_hash text default null,
  p_test_results_json jsonb default null,
  p_status text default null
) returns setof public.tool_versions as $$
declare
  v_next_version int;
  v_new_row public.tool_versions;
begin
  -- Lock parent tool row before calculating next version number to serialize concurrent calls
  perform 1 from public.tools where id = p_tool_id for update;

  if not found then
    raise exception 'Tool % not found', p_tool_id;
  end if;

  -- Concurrency-safe version numbering: compute next integer
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

  -- Atomically update tool shell's current_version_id (and status if provided)
  update public.tools
  set current_version_id = v_new_row.id,
      status = coalesce(p_status, status),
      updated_at = now()
  where id = p_tool_id;

  return next v_new_row;
end;
$$ language plpgsql security definer set search_path = pg_catalog, pg_temp;

-- Revoke execute from public/anon/authenticated, grant execute to service_role and postgres
revoke execute on function public.create_tool_version(uuid, text, jsonb, jsonb, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_tool_version(uuid, text, jsonb, jsonb, text, jsonb, text) to service_role, postgres;
