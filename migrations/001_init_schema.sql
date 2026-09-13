-- ============================================================
-- Initial schema for the AI testing playground backend
-- Run against Supabase (Postgres). auth.users is managed by
-- Supabase Auth already — this file only adds app-specific tables.
-- ============================================================

-- Lightweight profile table, 1:1 with auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- Tools: the top-level record. Immutable history lives in tool_versions.
create table tools (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  type text not null check (type in ('client', 'mcp')),
  status text not null default 'draft'
    check (status in ('draft', 'testing', 'registered', 'rejected', 'deprecated')),
  is_public boolean not null default false,
  allow_client_execution boolean not null default false,
  connector_type text, -- only set when type = 'mcp', e.g. 'postgres', 'slack'
  current_version_id uuid, -- FK added after tool_versions exists (see below)
  is_archived boolean not null default false, -- Soft delete flag
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every save/publish creates a new immutable version — never overwrite history.
create table tool_versions (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references tools(id) on delete cascade,
  version_number integer not null,
  code text, -- null for 'mcp' type tools (they store a reference, not code)
  schema_json jsonb not null, -- parsed @param tags: name, type, description, required
  capabilities_json jsonb not null default '[]'::jsonb, -- declared permissions
  code_hash text, -- sha-256 of `code`, used for client-side integrity checks
  test_results_json jsonb, -- output of the registration pipeline's test run
  created_at timestamptz not null default now(),
  unique (tool_id, version_number)
);

alter table tools
  add constraint fk_current_version
  foreign key (current_version_id) references tool_versions(id) on delete set null;

-- Moderation: lightweight report flag, reviewed manually at first.
create table tool_reports (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references tools(id) on delete cascade,
  reporter_id uuid not null references auth.users(id),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

-- Per-user encrypted credentials for connector-type tools.
-- Encryption happens at the application layer before insert —
-- this column stores ciphertext, never plaintext.
create table user_connector_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_type text not null, -- e.g. 'postgres', 'slack'
  encrypted_payload text not null,
  created_at timestamptz not null default now(),
  unique (user_id, connector_type)
);

-- Agents: a model + system prompt + a chosen set of tools.
create table agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  system_prompt text,
  model_provider text not null,
  model_id text not null,
  is_archived boolean not null default false, -- Soft delete flag
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Many-to-many: which tools an agent is allowed to call.
create table agent_tools (
  agent_id uuid not null references agents(id) on delete cascade,
  tool_id uuid not null references tools(id) on delete cascade,
  primary key (agent_id, tool_id)
);

-- Run history for debugging agents.
create table runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  input_json jsonb not null,
  output_json jsonb,
  trace_json jsonb, -- tool calls made, in order, with args/results
  tokens_used integer,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row-Level Security
-- ============================================================
alter table profiles enable row level security;
alter table tools enable row level security;
alter table tool_versions enable row level security;
alter table tool_reports enable row level security;
alter table user_connector_credentials enable row level security;
alter table agents enable row level security;
alter table agent_tools enable row level security;
alter table runs enable row level security;

-- Profiles: users manage their own
create policy "own profile" on profiles
  for all using (auth.uid() = id);

-- Tools: owners have full access; anyone can read public+registered tools
create policy "owner full access" on tools
  for all using (auth.uid() = owner_id);
create policy "public tools readable" on tools
  for select using (is_public = true and status = 'registered' and is_archived = false);

-- Tool versions: readable if you can read the parent tool
create policy "versions follow tool visibility" on tool_versions
  for select using (
    exists (
      select 1 from tools
      where tools.id = tool_versions.tool_id
      and (tools.owner_id = auth.uid() or (tools.is_public and tools.status = 'registered'))
    )
  );
create policy "owner writes versions" on tool_versions
  for insert with check (
    exists (select 1 from tools where tools.id = tool_id and tools.owner_id = auth.uid())
  );

-- Reports: anyone authenticated can file one; only visible to reporter (admin review happens via service role)
create policy "file own reports" on tool_reports
  for insert with check (auth.uid() = reporter_id);
create policy "read own reports" on tool_reports
  for select using (auth.uid() = reporter_id);

-- Credentials: strictly owner-only, never exposed to any other user
create policy "own credentials only" on user_connector_credentials
  for all using (auth.uid() = user_id);

-- Agents: owner-only for now (no shared agents yet)
create policy "own agents" on agents
  for all using (auth.uid() = owner_id);
create policy "own agent_tools" on agent_tools
  for all using (
    exists (select 1 from agents where agents.id = agent_id and agents.owner_id = auth.uid())
  );

-- Runs: owner-only
create policy "own runs" on runs
  for all using (auth.uid() = user_id);

-- ============================================================
-- Triggers and Functions
-- ============================================================

-- 1. Auto-update updated_at columns
create extension if not exists moddatetime schema extensions;

drop trigger if exists handle_updated_at on tools;
create trigger handle_updated_at before update on tools
  for each row execute procedure moddatetime (updated_at);

drop trigger if exists handle_updated_at on agents;
create trigger handle_updated_at before update on agents
  for each row execute procedure moddatetime (updated_at);

-- 2. Auto-create user profiles on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();