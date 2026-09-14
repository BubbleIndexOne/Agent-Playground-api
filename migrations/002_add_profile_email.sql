-- ============================================================
-- Migration: 002_add_profile_email.sql
-- Add email to profiles table and sync email in signup trigger
-- ============================================================

alter table public.profiles
  add column if not exists email text;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name);
  return new;
end;
$$ language plpgsql security definer;
