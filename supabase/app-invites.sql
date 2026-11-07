-- GamePlan app-wide invitation access (run ONCE, then safe to rerun).
-- Run in the same existing Supabase project, after schema.sql and link-invites.sql.
-- No existing projects, team memberships, board items, or time logs are deleted.
--
-- Distinction:
-- * App invitation = permission to use GamePlan / make your own projects.
-- * Project invitation = permission to access a specific shared project.
-- Supabase OAuth sign-in alone does not grant app access to new accounts.
--
-- Existing auth.users are grandfathered only on FIRST installation.
-- A bootstrap marker prevents reruns from admitting uninvited later signups.

create table if not exists public.gp_app_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 granted_at timestamptz not null default now(),
 granted_by uuid references auth.users(id) on delete set null
);

create table if not exists public.gp_app_admins (
 user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.gp_app_bootstrap (
 completed boolean primary key default true check (completed),
 completed_at timestamptz not null default now()
);

create table if not exists public.gp_app_invites (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 use_count integer not null default 0 check (use_count >= 0),
 max_uses integer not null default 25 check (max_uses between 1 and 100)
);
create index if not exists gp_app_invites_created_idx
 on public.gp_app_invites(created_at desc);

-- Rerunning this migration must not automatically approve newer auth users.
do $$
begin
 if not exists (select 1 from public.gp_app_bootstrap where completed=true) then
  insert into public.gp_app_members(user_id)
   select id from auth.users on conflict(user_id) do nothing;
  -- Existing project owners are initial app inviters.
  insert into public.gp_app_admins(user_id)
   select distinct owner_id from public.gp_projects
   on conflict(user_id) do nothing;
  insert into public.gp_app_bootstrap(completed) values(true)
   on conflict(completed) do nothing;
 end if;
end;
$$;

alter table public.gp_app_members enable row level security;
alter table public.gp_app_admins enable row level security;
alter table public.gp_app_bootstrap enable row level security;
alter table public.gp_app_invites enable row level security;
-- Intentional: no client table policies; only restricted RPCs.
revoke all on public.gp_app_members, public.gp_app_admins,
 public.gp_app_bootstrap, public.gp_app_invites
 from public, anon, authenticated;

create or replace function public.gp_has_app_access()
returns boolean language sql stable security definer set search_path=''
as $$
 select auth.uid() is not null and (
  exists(select 1 from public.gp_app_members a where a.user_id=auth.uid())
  or exists(select 1 from public.gp_projects p where p.owner_id=auth.uid())
  or exists(select 1 from public.gp_members m where m.user_id=auth.uid())
 );
$$;

create or replace function public.gp_is_app_admin()
returns boolean language sql stable security definer set search_path=''
as $$
 select auth.uid() is not null
  and exists(select 1 from public.gp_app_admins a where a.user_id=auth.uid());
$$;

create or replace function public.gp_app_access_status()
returns jsonb language sql stable security definer set search_path=''
as $$
 select jsonb_build_object(
  'access',public.gp_has_app_access(),
  'admin',public.gp_is_app_admin()
 );
$$;

create or replace function public.gp_create_app_invite(
 p_expires_days integer default 7, p_max_uses integer default 25
)
returns table(invite_id uuid,invite_token text,expires_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
 v_token text;
 v_id uuid;
 v_expiry timestamptz;
begin
 if not public.gp_is_app_admin() then
  raise exception 'Only GamePlan invitation admins can create access links'
   using errcode='42501';
 end if;
 if p_expires_days is null or p_expires_days not between 1 and 30 then
  raise exception 'Expiration must be between 1 and 30 days';
 end if;
 if p_max_uses is null or p_max_uses not between 1 and 100 then
  raise exception 'Usage limit must be between 1 and 100';
 end if;
 v_token:=replace(gen_random_uuid()::text,'-','')
       || replace(gen_random_uuid()::text,'-','');
 insert into public.gp_app_invites(token_hash,created_by,expires_at,max_uses)
 values(
  encode(sha256(convert_to(v_token,'UTF8')),'hex'),
  auth.uid(),now()+make_interval(days=>p_expires_days),p_max_uses
 )
 returning id,gp_app_invites.expires_at into v_id,v_expiry;
 return query select v_id,v_token,v_expiry;
end;
$$;

create or replace function public.gp_list_app_invites()
returns table(invite_id uuid,created_at timestamptz,
 expires_at timestamptz,revoked_at timestamptz,
 use_count integer,max_uses integer)
language plpgsql security definer set search_path=''
as $$
begin
 if not public.gp_is_app_admin() then
  raise exception 'Only GamePlan invitation admins can list access links'
   using errcode='42501';
 end if;
 return query select i.id,i.created_at,i.expires_at,i.revoked_at,
   i.use_count,i.max_uses
  from public.gp_app_invites i
  order by i.created_at desc limit 100;
end;
$$;

create or replace function public.gp_revoke_app_invite(p_invite uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare changed integer;
begin
 if not public.gp_is_app_admin() then
  raise exception 'Only GamePlan invitation admins can revoke access links'
   using errcode='42501';
 end if;
 update public.gp_app_invites
  set revoked_at=now()
  where id=p_invite and revoked_at is null;
 get diagnostics changed=row_count;
 return changed>0;
end;
$$;

create or replace function public.gp_accept_app_invite(p_token text)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
 found_invite public.gp_app_invites%rowtype;
 added integer;
begin
 if auth.uid() is null then
  raise exception 'Sign in before accepting an invitation'
   using errcode='42501';
 end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  raise exception 'Invalid GamePlan invitation link';
 end if;
 select i.* into found_invite from public.gp_app_invites i
  where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
   and i.revoked_at is null and i.expires_at>now()
   and i.use_count<i.max_uses
  for update;
 if not found then
  raise exception 'This GamePlan invite expired, was revoked, or is full';
 end if;
 insert into public.gp_app_members(user_id,granted_by)
  values(auth.uid(),found_invite.created_by)
  on conflict(user_id) do nothing;
 get diagnostics added=row_count;
 if added>0 then
  update public.gp_app_invites set use_count=use_count+1
   where id=found_invite.id;
 end if;
 return true;
end;
$$;

-- New authenticated users cannot create projects until approved by
-- an app invite or explicitly added as a member of an existing project.
-- Existing auth users remain approved via the one-time bootstrap above.
drop policy if exists "users create owned projects" on public.gp_projects;
create policy "users create owned projects" on public.gp_projects
 for insert to authenticated
 with check (owner_id=(select auth.uid()) and public.gp_has_app_access());

revoke all on function public.gp_has_app_access() from public,anon;
revoke all on function public.gp_is_app_admin() from public,anon;
revoke all on function public.gp_app_access_status() from public,anon;
revoke all on function public.gp_create_app_invite(integer,integer) from public,anon;
revoke all on function public.gp_list_app_invites() from public,anon;
revoke all on function public.gp_revoke_app_invite(uuid) from public,anon;
revoke all on function public.gp_accept_app_invite(text) from public,anon;
grant execute on function public.gp_has_app_access(),
 public.gp_is_app_admin(),public.gp_app_access_status(),
 public.gp_create_app_invite(integer,integer),
 public.gp_list_app_invites(),public.gp_revoke_app_invite(uuid),
 public.gp_accept_app_invite(text) to authenticated;
