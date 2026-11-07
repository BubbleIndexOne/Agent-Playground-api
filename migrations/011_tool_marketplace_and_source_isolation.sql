-- ============================================================
-- Migration 011: Tool Marketplace, Source Code Isolation & Governance
--
-- 1. Extracts source code into public.tool_sources with strict RLS
-- 2. Updates public.create_tool_version RPC to persist to tool_sources
-- 3. Adds author handles to public.profiles
-- 4. Extends public.tools with visibility, slugs, tags, search_vector,
--    and MCP hosting lifecycle fields
-- 5. Creates public.tool_installs for version pinning
-- 6. Adds deduplication to public.tool_reports and creates public.tool_usage_daily
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Create tool_sources table and establish RLS
-- ────────────────────────────────────────────────────────────
create table if not exists public.tool_sources (
  version_id uuid primary key references public.tool_versions(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);

alter table public.tool_sources enable row level security;

-- Only tool authors and service_role can read protected source code
drop policy if exists "owner reads source" on public.tool_sources;
create policy "owner reads source" on public.tool_sources
  for select using (
    exists (
      select 1 from public.tool_versions v
      join public.tools t on t.id = v.tool_id
      where v.id = tool_sources.version_id and t.owner_id = auth.uid()
    )
  );

-- Backfill existing code from tool_versions into tool_sources
insert into public.tool_sources (version_id, code)
select id, code from public.tool_versions
where code is not null and code <> ''
on conflict (version_id) do update set code = excluded.code;

-- Clear plaintext code from tool_versions so it is never exposed via RLS
update public.tool_versions set code = null where code is not null;

-- ────────────────────────────────────────────────────────────
-- 2. Author handles on public.profiles
-- ────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists handle text;

alter table public.profiles
  drop constraint if exists profiles_handle_format;

alter table public.profiles
  add constraint profiles_handle_format
    check (handle is null or handle ~ '^[a-z0-9_-]{3,30}$');

-- Backfill handles for existing profiles lacking one
update public.profiles
set handle = lower(substring(regexp_replace(coalesce(nullif(display_name, ''), nullif(first_name, ''), 'user'), '[^a-zA-Z0-9_-]', '', 'g') from 1 for 20)) || '_' || substring(id::text from 1 for 6)
where handle is null or handle = '';

create unique index if not exists idx_profiles_handle on public.profiles(handle);

-- ────────────────────────────────────────────────────────────
-- 3. Marketplace and Governance fields on public.tools
-- ────────────────────────────────────────────────────────────
alter table public.tools
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'unlisted', 'public')),
  add column if not exists slug text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists install_count integer not null default 0,
  add column if not exists search_vector tsvector,
  add column if not exists mcp_hosting_status text not null default 'none'
    check (mcp_hosting_status in ('none', 'requested', 'in_review', 'approved', 'rejected')),
  add column if not exists is_mcp_hosted boolean not null default false,
  add column if not exists mcp_promoted_at timestamptz,
  add column if not exists mcp_review_notes text;

-- Backfill visibility from is_public
update public.tools
set visibility = case when is_public = true then 'public' else 'private' end
where visibility is null or visibility = 'private';

create unique index if not exists idx_tools_slug on public.tools(slug);
create index if not exists idx_tools_search_vector on public.tools using gin(search_vector);

-- Maintain search_vector automatically
create or replace function public.tools_search_vector_update() returns trigger as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.description, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(new.tags, '{}'), ' ')), 'C');
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tools_search_vector on public.tools;
create trigger trg_tools_search_vector
  before insert or update of name, description, tags on public.tools
  for each row execute function public.tools_search_vector_update();

-- Populate initial search_vector for existing tools
update public.tools
set search_vector =
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(tags, '{}'), ' ')), 'C')
where search_vector is null;

-- ────────────────────────────────────────────────────────────
-- 4. Tool Installs (Pointer Model)
-- ────────────────────────────────────────────────────────────
create table if not exists public.tool_installs (
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_id uuid not null references public.tools(id) on delete cascade,
  pinned_version_id uuid not null references public.tool_versions(id) on delete cascade,
  installed_at timestamptz not null default now(),
  primary key (user_id, tool_id)
);

create index if not exists idx_tool_installs_user on public.tool_installs(user_id);
create index if not exists idx_tool_installs_tool on public.tool_installs(tool_id);

alter table public.tool_installs enable row level security;
drop policy if exists "user manages own installs" on public.tool_installs;
create policy "user manages own installs" on public.tool_installs
  for all using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 5. Tool Reports Deduplication & Daily Usage Metrics
-- ────────────────────────────────────────────────────────────
create unique index if not exists idx_unique_open_report
  on public.tool_reports(reporter_id, tool_id)
  where status = 'open';

create table if not exists public.tool_usage_daily (
  tool_id uuid not null references public.tools(id) on delete cascade,
  usage_date date not null default current_date,
  call_count integer not null default 1,
  primary key (tool_id, usage_date)
);

create index if not exists idx_tool_usage_daily_date on public.tool_usage_daily(usage_date);

-- ────────────────────────────────────────────────────────────
-- 6. Atomic create_tool_version RPC with tool_sources support
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
  -- Serialize concurrent version creation for the same tool
  perform id from public.tools where id = p_tool_id for update;

  if not found then
    raise exception 'Tool % not found', p_tool_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.tool_versions
  where tool_id = p_tool_id;

  -- Insert into tool_versions (metadata only; code column kept null)
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
    null,
    p_schema_json,
    coalesce(p_capabilities_json, '[]'::jsonb),
    p_code_hash,
    p_test_results_json
  )
  returning * into v_new_row;

  -- Persist executable code to isolated tool_sources table
  if p_code is not null and p_code <> '' then
    insert into public.tool_sources (version_id, code)
    values (v_new_row.id, p_code)
    on conflict (version_id) do update set code = excluded.code;
  end if;

  -- Atomically update tool shell's current_version_id
  update public.tools
  set current_version_id = v_new_row.id,
      updated_at         = now()
  where id = p_tool_id;

  return next v_new_row;
end;
$$ language plpgsql security definer
   set search_path = pg_catalog, pg_temp;

revoke execute on function public.create_tool_version(uuid, text, jsonb, jsonb, text, jsonb)
  from anon, authenticated;
grant execute on function public.create_tool_version(uuid, text, jsonb, jsonb, text, jsonb)
  to service_role;

