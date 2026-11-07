-- Migration 012: Vault Credentials RLS Hardening
-- Remove legacy policy that allows regular authenticated users to read/write their credential rows directly via client libraries
-- Row Level Security remains enabled so only the backend server (service-role connection) can read or write credentials
drop policy if exists "own credentials only" on public.user_connector_credentials;
