-- Migration 013: Fix tool_installs Foreign Key Constraint
-- In custom auth (Migration 004), user accounts are stored in public.users, not auth.users.
-- Migration 011 accidentally referenced auth.users(id) for public.tool_installs.user_id.
-- This migration updates the foreign key constraint to reference public.users(id) on delete cascade.

-- Pre-check: Ensure no tool_installs rows have user_id missing from public.users before applying constraint.
do $$
declare
  orphaned_count integer;
begin
  select count(*) into orphaned_count
  from public.tool_installs ti
  where not exists (select 1 from public.users u where u.id = ti.user_id);

  if orphaned_count > 0 then
    raise exception 'Migration 013 aborted: % orphaned rows found in public.tool_installs without matching public.users accounts. Preserve rows and map accounts before applying constraint.', orphaned_count;
  end if;
end $$;

alter table public.tool_installs
  drop constraint if exists tool_installs_user_id_fkey;

alter table public.tool_installs
  add constraint tool_installs_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

-- Ensure RLS allows service-role full access without relying on Supabase auth.uid()
drop policy if exists "user manages own installs" on public.tool_installs;
drop policy if exists "service role full access" on public.tool_installs;
create policy "service role full access" on public.tool_installs
  for all to service_role using (true) with check (true);
