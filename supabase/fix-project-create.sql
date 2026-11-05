-- One-time fix for GamePlan Cloud import / project creation.
-- The owner must be allowed to read the new project immediately on INSERT
-- ... RETURNING, before its membership row can be reliably observed.
-- Keeps membership checks for all other team members.
drop policy if exists "members see projects" on public.gp_projects;
create policy "members see projects" on public.gp_projects
 for select to authenticated
 using (owner_id=(select auth.uid()) or public.gp_is_member(id));
