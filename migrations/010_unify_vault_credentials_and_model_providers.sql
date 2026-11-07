-- Migration 010: Unify vault credentials for connectors and model providers
alter table public.user_connector_credentials
  add column if not exists kind text not null default 'connector'
    check (kind in ('connector', 'model_provider')),
  add column if not exists last_verified_at timestamptz;

-- Update unique constraint to allow same connector_type / provider across different kinds
alter table public.user_connector_credentials
  drop constraint if exists user_connector_credentials_user_id_connector_type_key,
  drop constraint if exists uq_user_kind_type;

alter table public.user_connector_credentials
  add constraint uq_user_kind_type unique (user_id, kind, connector_type);

-- Create index for fast lookups by user, kind, and connector_type
create index if not exists idx_user_credentials_lookup
  on public.user_connector_credentials (user_id, kind, connector_type);

