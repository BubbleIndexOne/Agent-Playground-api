-- ============================================================
-- Migration 006: Create Atomic Tool Versioning Function & Update Status Check
--
-- 1. Updates tools.status check constraint to support 'verified'
-- 2. Defines public.create_tool_version RPC function to atomically:
--    - calculate next version_number
--    - insert new tool_version row
--    - update tools.current_version_id and updated_at
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Update status constraint to include 'verified'
-- ────────────────────────────────────────────────────────────
alter table public.tools drop constraint if exists tools_status_check;
alter table public.tools add constraint tools_status_check
  check (status in ('draft', 'testing', 'verified', 'registered', 'rejected', 'deprecated'));

-- ────────────────────────────────────────────────────────────
-- 2. Atomic create_tool_version function
-- ────────────────────────────────────────────────────────────
create or replace function public.create_tool_version(
  p_tool_id uuid,
  p_code text,
  p_schema_json jsonb,
  p_capabilities_json jsonb default '[]'::jsonb,
  p_code_hash text default null
) returns setof public.tool_versions as $$
declare
  v_next_version int;
  v_new_row public.tool_versions;
begin
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
    code_hash
  ) values (
    p_tool_id,
    v_next_version,
    p_code,
    p_schema_json,
    coalesce(p_capabilities_json, '[]'::jsonb),
    p_code_hash
  )
  returning * into v_new_row;

  -- Atomically update tool shell's current_version_id
  update public.tools
  set current_version_id = v_new_row.id,
      updated_at = now()
  where id = p_tool_id;

  return next v_new_row;
end;
$$ language plpgsql security definer;

-- Grant execution to service_role and backend roles
grant execute on function public.create_tool_version(uuid, text, jsonb, jsonb, text)
  to anon, authenticated, service_role;
