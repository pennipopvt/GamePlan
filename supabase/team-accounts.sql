-- GamePlan authenticated team and permissions upgrade (safe on existing projects).
-- Run this ONCE in Supabase SQL Editor after the original schema.sql.
-- No tasks, logs, projects, gp_members, or existing team payloads are removed.

create table if not exists public.gp_member_details (
  project_id uuid not null references public.gp_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name_override text,
  legacy_member_id text,
  updated_at timestamptz not null default now(),
  primary key (project_id,user_id),
  constraint gp_member_details_name_length check
    (display_name_override is null or length(display_name_override) between 1 and 100),
  constraint gp_member_details_legacy_length check
    (legacy_member_id is null or length(legacy_member_id) between 1 and 200)
);
create unique index if not exists gp_member_details_legacy_unique
 on public.gp_member_details(project_id,legacy_member_id)
 where legacy_member_id is not null;
alter table public.gp_member_details enable row level security;
revoke all on public.gp_member_details from public,anon,authenticated;

-- Read the real signed-in project members, including OAuth display names.
-- Never publish users' emails or raw_auth metadata to other members.
create or replace function public.gp_project_team(p_project uuid)
returns table(
 member_user_id uuid,
 member_role text,
 joined_at timestamptz,
 account_name text,
 display_name text,
 legacy_member_id text
)
language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or
    not (public.gp_is_member(p_project) or public.gp_is_owner(p_project)) then
  raise exception 'Not a project member' using errcode='42501';
 end if;
 return query
 select m.user_id,m.role,m.joined_at,
  coalesce(
   nullif(u.raw_user_meta_data->>'preferred_username',''),
   nullif(u.raw_user_meta_data->>'global_name',''),
   nullif(u.raw_user_meta_data->>'user_name',''),
   nullif(u.raw_user_meta_data->>'full_name',''),
   nullif(u.raw_user_meta_data->>'name',''),
   nullif(u.raw_user_meta_data->>'username',''),
   nullif(split_part(u.email,'@',1),''),
   'Teammate')::text,
  coalesce(d.display_name_override,
   nullif(u.raw_user_meta_data->>'preferred_username',''),
   nullif(u.raw_user_meta_data->>'global_name',''),
   nullif(u.raw_user_meta_data->>'user_name',''),
   nullif(u.raw_user_meta_data->>'full_name',''),
   nullif(u.raw_user_meta_data->>'name',''),
   nullif(u.raw_user_meta_data->>'username',''),
   nullif(split_part(u.email,'@',1),''),
   'Teammate')::text,
  d.legacy_member_id
 from public.gp_members m
 join auth.users u on u.id=m.user_id
 left join public.gp_member_details d on d.project_id=m.project_id and d.user_id=m.user_id
 where m.project_id=p_project
 order by (m.role='owner') desc,m.joined_at asc;
end;
$$;

-- The owner can rename a team member for THIS project, and optionally
-- associate that account with an existing legacy assignee to preserve hours.
create or replace function public.gp_set_team_member(
 p_project uuid, p_user uuid,
 p_display_name text default null, p_legacy_member_id text default null
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
 v_name text;
 v_legacy text;
begin
 if auth.uid() is null or not public.gp_is_owner(p_project) then
  raise exception 'Only the project owner can manage team members' using errcode='42501';
 end if;
 if not exists (select 1 from public.gp_members
                 where project_id=p_project and user_id=p_user) then
  raise exception 'User is not on this project';
 end if;
 v_name:=nullif(trim(p_display_name),'');
 v_legacy:=nullif(trim(p_legacy_member_id),'');
 if length(v_name)>100 or length(v_legacy)>200 then
  raise exception 'Display name or legacy ID is too long';
 end if;
 insert into public.gp_member_details(project_id,user_id,display_name_override,legacy_member_id)
 values(p_project,p_user,v_name,v_legacy)
 on conflict(project_id,user_id) do update set
 display_name_override=excluded.display_name_override,
 legacy_member_id=excluded.legacy_member_id,
 updated_at=now();
 return true;
end;
$$;

create or replace function public.gp_set_team_role(
 p_project uuid,p_user uuid,p_role text
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
 v_count integer;
begin
 if auth.uid() is null or not public.gp_is_owner(p_project) then
  raise exception 'Only the owner can change permissions' using errcode='42501';
 end if;
 if p_role not in ('editor','viewer') then
  raise exception 'Select Editor or Viewer. Ownership cannot be transferred here';
 end if;
 update public.gp_members m set role=p_role
 where m.project_id=p_project and m.user_id=p_user and m.role<>'owner';
 get diagnostics v_count=row_count;
 if v_count=0 then raise exception 'Member not found or owner role is protected';end if;
 return true;
end;
$$;

create or replace function public.gp_remove_team_member(
 p_project uuid,p_user uuid
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
 v_count integer;
begin
 if auth.uid() is null or not public.gp_is_owner(p_project) then
  raise exception 'Only the owner can remove members' using errcode='42501';
 end if;
 delete from public.gp_members m
 where m.project_id=p_project and m.user_id=p_user and m.role<>'owner';
 get diagnostics v_count=row_count;
 return v_count>0;
end;
$$;

revoke all on function public.gp_project_team(uuid) from public,anon;
revoke all on function public.gp_set_team_member(uuid,uuid,text,text) from public,anon;
revoke all on function public.gp_set_team_role(uuid,uuid,text) from public,anon;
revoke all on function public.gp_remove_team_member(uuid,uuid) from public,anon;
grant execute on function public.gp_project_team(uuid),
 public.gp_set_team_member(uuid,uuid,text,text),
 public.gp_set_team_role(uuid,uuid,text),
 public.gp_remove_team_member(uuid,uuid) to authenticated;
