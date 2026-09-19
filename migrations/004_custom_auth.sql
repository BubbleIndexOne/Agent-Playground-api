-- ============================================================
-- Migration 004: Custom Auth — replace Supabase GoTrue with
-- a self-contained users + refresh_tokens table.
--
-- Changes:
--   1. Drop the on_auth_user_created trigger and handle_new_user fn
--   2. Create public.users (owns email + password_hash)
--   3. Re-create profiles referencing public.users instead of auth.users
--   4. Update all other tables (tools, agents, runs, etc.) to reference
--      public.users instead of auth.users
--   5. Create refresh_tokens for token rotation
--   6. Update RLS policies to use a custom session variable
--      (app.current_user_id) set by the Worker via SET LOCAL
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Drop trigger & function that relied on auth.users inserts
-- ────────────────────────────────────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- ────────────────────────────────────────────────────────────
-- 2. Create public.users
-- ────────────────────────────────────────────────────────────
create table public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Auto-update updated_at
drop trigger if exists handle_updated_at on public.users;
create trigger handle_updated_at before update on public.users
  for each row execute procedure moddatetime(updated_at);

-- ────────────────────────────────────────────────────────────
-- 3. Refresh tokens table
-- ────────────────────────────────────────────────────────────
create table public.refresh_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index refresh_tokens_token_idx on public.refresh_tokens (token);
create index refresh_tokens_user_id_idx on public.refresh_tokens (user_id);

-- ────────────────────────────────────────────────────────────
-- 4. Re-create profiles referencing public.users
-- ────────────────────────────────────────────────────────────
-- Drop and recreate profiles to change the FK target.
-- Existing profile data is discarded (no real users yet).
drop table if exists profiles cascade;

create table public.profiles (
  id           uuid primary key references public.users(id) on delete cascade,
  display_name text,
  email        text,
  created_at   timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 5. Re-create dependent tables referencing public.users
--    instead of auth.users
-- ────────────────────────────────────────────────────────────

-- Drop tables in reverse dependency order
drop table if exists runs cascade;
drop table if exists agent_tools cascade;
drop table if exists agents cascade;
drop table if exists user_connector_credentials cascade;
drop table if exists tool_reports cascade;
drop table if exists tool_versions cascade;
drop table if exists tools cascade;

-- tools
create table tools (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null references public.users(id) on delete cascade,
  name                    text not null,
  description             text,
  type                    text not null check (type in ('client', 'mcp')),
  status                  text not null default 'draft'
    check (status in ('draft', 'testing', 'registered', 'rejected', 'deprecated')),
  is_public               boolean not null default false,
  allow_client_execution  boolean not null default false,
  connector_type          text,
  current_version_id      uuid,
  is_archived             boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- tool_versions
create table tool_versions (
  id              uuid primary key default gen_random_uuid(),
  tool_id         uuid not null references tools(id) on delete cascade,
  version_number  integer not null,
  code            text,
  schema_json     jsonb not null,
  capabilities_json jsonb not null default '[]'::jsonb,
  code_hash       text,
  test_results_json jsonb,
  created_at      timestamptz not null default now(),
  unique (tool_id, version_number)
);

alter table tools
  add constraint fk_current_version
  foreign key (current_version_id) references tool_versions(id) on delete set null;

-- tool_reports
create table tool_reports (
  id          uuid primary key default gen_random_uuid(),
  tool_id     uuid not null references tools(id) on delete cascade,
  reporter_id uuid not null references public.users(id),
  reason      text not null,
  status      text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at  timestamptz not null default now()
);

-- user_connector_credentials
create table user_connector_credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  connector_type    text not null,
  encrypted_payload text not null,
  created_at        timestamptz not null default now(),
  unique (user_id, connector_type)
);

-- agents
create table agents (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.users(id) on delete cascade,
  name            text not null,
  system_prompt   text,
  model_provider  text not null,
  model_id        text not null,
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- agent_tools
create table agent_tools (
  agent_id uuid not null references agents(id) on delete cascade,
  tool_id  uuid not null references tools(id) on delete cascade,
  primary key (agent_id, tool_id)
);

-- runs
create table runs (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid references agents(id) on delete set null,
  user_id     uuid not null references public.users(id) on delete cascade,
  input_json  jsonb not null,
  output_json jsonb,
  trace_json  jsonb,
  tokens_used integer,
  created_at  timestamptz not null default now()
);

-- updated_at triggers
drop trigger if exists handle_updated_at on tools;
create trigger handle_updated_at before update on tools
  for each row execute procedure moddatetime(updated_at);

drop trigger if exists handle_updated_at on agents;
create trigger handle_updated_at before update on agents
  for each row execute procedure moddatetime(updated_at);

-- ────────────────────────────────────────────────────────────
-- 6. Row-Level Security
--
-- We can no longer use auth.uid() because Supabase Auth is gone.
-- Instead the Worker sets a session-local variable before queries:
--   SET LOCAL app.current_user_id = '<uuid>';
-- RLS policies read it via current_setting('app.current_user_id', true).
--
-- NOTE: For now RLS is enabled but all policies are permissive (public)
-- because the Worker enforces auth at the middleware layer via JWT
-- verification before any DB query is made. Fine-grained per-row
-- RLS policies can be added in a future migration once needed.
-- ────────────────────────────────────────────────────────────
alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.refresh_tokens enable row level security;
alter table tools enable row level security;
alter table tool_versions enable row level security;
alter table tool_reports enable row level security;
alter table user_connector_credentials enable row level security;
alter table agents enable row level security;
alter table agent_tools enable row level security;
alter table runs enable row level security;

-- Service-role bypass (used by our Worker via the service key connection)
-- All tables: allow service role full access
create policy "service role full access" on public.users
  for all using (true) with check (true);

create policy "service role full access" on public.profiles
  for all using (true) with check (true);

create policy "service role full access" on public.refresh_tokens
  for all using (true) with check (true);

create policy "service role full access" on tools
  for all using (true) with check (true);

create policy "service role full access" on tool_versions
  for all using (true) with check (true);

create policy "service role full access" on tool_reports
  for all using (true) with check (true);

create policy "service role full access" on user_connector_credentials
  for all using (true) with check (true);

create policy "service role full access" on agents
  for all using (true) with check (true);

create policy "service role full access" on agent_tools
  for all using (true) with check (true);

create policy "service role full access" on runs
  for all using (true) with check (true);

-- ────────────────────────────────────────────────────────────
-- 7. Grant public schema access to database roles
-- ────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Notify PostgREST to reload its schema cache
notify pgrst, 'reload schema';
