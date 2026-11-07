-- GamePlan optional Discord profile picture upgrade.
-- Run once in the Supabase SQL Editor AFTER supabase/team-accounts.sql.
-- Does not modify accounts, membership roles, project data, or team colors.
--
-- The existing gp_project_team RPC remains unchanged, so older GamePlan
-- clients continue to work. Until this is installed, teammates use
-- color-bordered initials (the signed-in user may show their own avatar).
--
-- Only signed-in users who belong to a project can fetch profile pictures
-- of other members in that same project. Read linked auth.identities first
-- so users signed in with Google but linked to Discord still get Discord PFPs.
-- Return only a public Discord CDN avatar URL, never private OAuth metadata,
-- emails, tokens or Discord IDs.

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
  coalesce(
   -- Linked Discord identity wins, even if the primary account uses Google
   -- or email sign-in. OAuth identity data is stored separately.
   (
    select v.avatar_url
    from auth.identities i
    cross join lateral (values
      (1, i.identity_data->>'avatar_url'),
      (2, i.identity_data->>'picture')
    ) as v(priority, avatar_url)
    where i.user_id=m.user_id
      and i.provider='discord'
      and v.avatar_url ~* '^https://(cdn\.discordapp\.com|media\.discordapp\.net)/(avatars|embed/avatars)/'
    order by i.last_sign_in_at desc nulls last, v.priority asc
    limit 1
   ),
   -- Older Discord-only logins may only have their avatar in user metadata.
   case when (u.raw_user_meta_data->>'avatar_url')
     ~* '^https://(cdn\.discordapp\.com|media\.discordapp\.net)/(avatars|embed/avatars)/'
    then u.raw_user_meta_data->>'avatar_url' end,
   case when (u.raw_user_meta_data->>'picture')
     ~* '^https://(cdn\.discordapp\.com|media\.discordapp\.net)/(avatars|embed/avatars)/'
    then u.raw_user_meta_data->>'picture' end
  )::text
 from public.gp_members m
 join auth.users u on u.id=m.user_id
 where m.project_id=p_project;
end;
$$;

revoke all on function public.gp_project_team_avatars(uuid) from public,anon;
grant execute on function public.gp_project_team_avatars(uuid) to authenticated;
