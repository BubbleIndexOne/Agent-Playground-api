-- Migration 009: Create model_presets table and add model_params to agents

-- 1. Create model_presets table
create table if not exists public.model_presets (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.users(id) on delete cascade,
  name            text not null,
  provider        text not null,
  model_id        text,
  params_json     jsonb not null default '{}'::jsonb,
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Partial index for active presets per user & provider
create index if not exists idx_model_presets_owner_provider 
  on public.model_presets(owner_id, provider) 
  where is_archived = false;

-- RLS matching custom auth architecture
alter table public.model_presets enable row level security;
drop policy if exists "service role full access" on public.model_presets;
create policy "service role full access" on public.model_presets 
  for all using (true) with check (true);

-- 2. Extend agents table with hyperparameter snapshotting
alter table public.agents
  add column if not exists model_params jsonb not null default '{}'::jsonb,
  add column if not exists source_preset_id uuid references public.model_presets(id) on delete set null;
