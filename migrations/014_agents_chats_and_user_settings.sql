-- ============================================================
-- Migration 014: Agents, Chat Sessions, Messages & User Settings
-- Database: PostgreSQL (Supabase)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Extend public.agents table
-- ────────────────────────────────────────────────────────────
alter table public.agents
  add column if not exists description text not null default '',
  add column if not exists avatar_json jsonb not null default '{}'::jsonb,
  add column if not exists attached_connectors jsonb not null default '[]'::jsonb;

-- Ensure updated_at trigger is active on agents
drop trigger if exists handle_updated_at on public.agents;
create trigger handle_updated_at before update on public.agents
  for each row execute procedure moddatetime(updated_at);

-- Partial index for active user agents
create index if not exists idx_agents_owner_active 
  on public.agents(owner_id) 
  where is_archived = false;

-- ────────────────────────────────────────────────────────────
-- 2. Enhance public.agent_tools table
-- ────────────────────────────────────────────────────────────
alter table public.agent_tools
  add column if not exists pinned_version integer;

comment on column public.agent_tools.pinned_version is 
  'Nullable specific tool version number. If null, resolves dynamically to current_version_id.';

-- ────────────────────────────────────────────────────────────
-- 3. Create public.chat_sessions table
-- ────────────────────────────────────────────────────────────
create table if not exists public.chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  agent_id    uuid not null references public.agents(id) on delete cascade,
  title       text not null default 'New Conversation',
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists handle_updated_at on public.chat_sessions;
create trigger handle_updated_at before update on public.chat_sessions
  for each row execute procedure moddatetime(updated_at);

create index if not exists idx_chat_sessions_user_agent 
  on public.chat_sessions(user_id, agent_id) 
  where is_archived = false;

create index if not exists idx_chat_sessions_updated_at 
  on public.chat_sessions(updated_at desc);

-- ────────────────────────────────────────────────────────────
-- 4. Create public.chat_messages table
-- ────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  chat_id         uuid not null references public.chat_sessions(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null default '',
  tool_calls_json jsonb not null default '[]'::jsonb,
  error_text      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_chat_messages_chat_id_created 
  on public.chat_messages(chat_id, created_at asc);

-- ────────────────────────────────────────────────────────────
-- 5. Create public.user_settings table
-- ────────────────────────────────────────────────────────────
create table if not exists public.user_settings (
  user_id     uuid primary key references public.users(id) on delete cascade,
  theme       text not null default 'system' check (theme in ('system', 'light', 'dark')),
  extra_json  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists handle_updated_at on public.user_settings;
create trigger handle_updated_at before update on public.user_settings
  for each row execute procedure moddatetime(updated_at);

-- ────────────────────────────────────────────────────────────
-- 6. Row-Level Security & Grants
-- ────────────────────────────────────────────────────────────
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.user_settings enable row level security;

-- Consistent with migrations 004 & 009: Service-role access for Worker API
drop policy if exists "service role full access" on public.chat_sessions;
create policy "service role full access" on public.chat_sessions 
  for all using (true) with check (true);

drop policy if exists "service role full access" on public.chat_messages;
create policy "service role full access" on public.chat_messages 
  for all using (true) with check (true);

drop policy if exists "service role full access" on public.user_settings;
create policy "service role full access" on public.user_settings 
  for all using (true) with check (true);

grant all on public.chat_sessions to service_role;
grant all on public.chat_messages to service_role;
grant all on public.user_settings to service_role;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
