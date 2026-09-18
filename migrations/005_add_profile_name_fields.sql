-- ============================================================
-- Migration 005: Add name fields to public.profiles
--
-- Adds:
--   first_name   text not null default ''
--   middle_name  text
--   last_name    text
-- ============================================================

alter table public.profiles
  add column if not exists first_name text not null default '',
  add column if not exists middle_name text,
  add column if not exists last_name text;
