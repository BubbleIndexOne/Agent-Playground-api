-- Migration 008: Add key_version, preview, and updated_at to user_connector_credentials
alter table public.user_connector_credentials
  add column if not exists key_version int not null default 1,
  add column if not exists preview text,
  add column if not exists updated_at timestamptz not null default now();
