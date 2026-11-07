-- GamePlan optional Discord profile picture upgrade.
-- Run once in the Supabase SQL Editor AFTER supabase/team-accounts.sql.
-- Does not modify accounts, membership roles, project data, or team colors.
--
-- The existing gp_project_team RPC remains unchanged, so older GamePlan
-- clients continue to work. Until this is installed, teammates use
-- color-bordered initials (the signed-in user may show their own avatar).
--
-- Only signed-in users who belong to a project can fetch profile pictures
-- of other members in that same project. Return only a public Discord CDN
-- avatar URL, not private OAuth metadata, emails, tokens or Discord IDs.

create or replace function public.gp_project_team_avatars(p_project uuid)
returns table (
 member_user_id uuid,
 avatar_url text
)
language plpgsql
security definer
set search_path=''
as $$
begin
 if auth.uid() is null or
    not (public.gp_is_member(p_project) or public.gp_is_owner(p_project)) then
  raise exception 'Not a project member' using errcode='42501';
 end if;
 return query
 select m.user_id,
  case
   when coalesce(u.raw_user_meta_data->>'avatar_url','')
     ~* '^https://(cdn\\.discordapp\\.com|media\\.discordapp\\.net)/'
    then nullif(u.raw_user_meta_data->>'avatar_url','')
   when coalesce(u.raw_user_meta_data->>'picture','')
     ~* '^https://(cdn\\.discordapp\\.com|media\\.discordapp\\.net)/'
    then nullif(u.raw_user_meta_data->>'picture','')
   else null
  end::text
 from public.gp_members m
 join auth.users u on u.id=m.user_id
 where m.project_id=p_project;
end;
$$;

revoke all on function public.gp_project_team_avatars(uuid) from public,anon;
grant execute on function public.gp_project_team_avatars(uuid) to authenticated;
