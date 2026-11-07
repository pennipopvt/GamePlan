-- GamePlan: designate one and only one app-wide invitation owner.
--
-- Run in your EXISTING Supabase project's SQL Editor AFTER app-invites.sql.
-- Before running, replace the placeholder below with YOUR AUTH USER UUID from
-- Supabase Dashboard > Authentication > Users (copy the ID, not an email).
-- Do NOT put that personal UUID in the public GitHub file. Edit it only in
-- Supabase's SQL Editor when you run this migration.
--
-- This change only controls who can CREATE / LIST / REVOKE invitations to
-- GamePlan itself. It does not affect project-specific invitations, project
-- ownership, tasks, logged hours, or current app members.
-- Existing invite links are left in place; revoke individual old links
-- separately if you do not want them to remain redeemable.
--
-- The script deliberately fails with NO changes if the placeholder is not
-- replaced or the chosen ID is not an existing GamePlan project owner.

begin;

do $$
declare
  selected_user_id text := 'PASTE_YOUR_AUTH_USER_UUID_HERE';
  selected_user_uuid uuid;
begin
  if selected_user_id = 'PASTE_YOUR_AUTH_USER_UUID_HERE' then
    raise exception 'Replace PASTE_YOUR_AUTH_USER_UUID_HERE with your Auth user ID before running';
  end if;

  begin
    selected_user_uuid := selected_user_id::uuid;
  exception when invalid_text_representation then
    raise exception 'The selected Auth user ID is not a valid UUID';
  end;

  if not exists (
    select 1 from auth.users where id = selected_user_uuid
  ) then
    raise exception 'Selected account does not exist in Supabase Auth';
  end if;

  if not exists (
    select 1 from public.gp_projects where owner_id = selected_user_uuid
  ) then
    raise exception 'Selected account is not an existing GamePlan project owner; verify the account ID';
  end if;

  -- Prior versions may have automatically authorized multiple project owners.
  -- Remove their app-wide invitation privileges, retaining only this account.
  delete from public.gp_app_admins
   where user_id <> selected_user_uuid;

  insert into public.gp_app_admins(user_id)
   values(selected_user_uuid)
   on conflict(user_id) do nothing;

  -- Make sure the intended owner retains access to GamePlan itself.
  insert into public.gp_app_members(user_id)
   values(selected_user_uuid)
   on conflict(user_id) do nothing;
end;
$$;

-- Defense in depth: the table is restricted to exactly one row. Future
-- accidental project-owner grants or app-admin inserts cannot silently
-- add a second invitation administrator.
create unique index if not exists gp_app_admins_single_inviter
  on public.gp_app_admins ((true));

commit;

-- Optional verification: should return EXACTLY ONE row, your own account.
select a.user_id, u.email
from public.gp_app_admins a
join auth.users u on u.id = a.user_id;
