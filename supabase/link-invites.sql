-- GamePlan invite links · one-time migration for an EXISTING Supabase project.
-- Run this in SQL Editor. Existing projects, email invites, tasks and time logs are untouched.
-- Invite secrets are generated server-side, hashed at rest and never listed again.

create table if not exists public.gp_link_invites (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.gp_projects(id) on delete cascade,
 token_hash text not null unique,
 role text not null default 'editor' check (role in ('editor','viewer')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 use_count integer not null default 0 check (use_count >= 0),
 max_uses integer not null default 25 check (max_uses between 1 and 100)
);
create index if not exists gp_link_invites_project_idx on public.gp_link_invites(project_id,created_at desc);
alter table public.gp_link_invites enable row level security;
-- There are intentionally no RLS policies on this table. All access goes through
-- functions with explicit owner checks / unguessable invite tokens.
revoke all on public.gp_link_invites from public, anon, authenticated;

create or replace function public.gp_create_link_invite(
 p_project uuid, p_role text default 'editor', p_expires_days integer default 7
)
returns table(invite_id uuid, invite_token text, invite_role text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
 v_token text;
 v_id uuid;
 v_role text;
 v_expiry timestamptz;
begin
 if auth.uid() is null or not public.gp_is_owner(p_project) then
  raise exception 'Only the project owner can create invite links' using errcode = '42501';
 end if;
 if p_role is null or p_role not in ('editor','viewer') then
  raise exception 'Invalid invite role';
 end if;
 if p_expires_days is null or p_expires_days not between 1 and 30 then
  raise exception 'Invite expiry must be between 1 and 30 days';
 end if;
 -- 256 bits of randomness from two independent UUIDv4 values.
 v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
 insert into public.gp_link_invites
  (project_id,token_hash,role,created_by,expires_at)
 values
  (p_project,encode(sha256(convert_to(v_token,'UTF8')),'hex'),p_role,auth.uid(),
   now()+make_interval(days => p_expires_days))
 returning id,role,gp_link_invites.expires_at into v_id,v_role,v_expiry;
 return query select v_id,v_token,v_role,v_expiry;
end;
$$;

create or replace function public.gp_list_link_invites(p_project uuid)
returns table(
 invite_id uuid, invite_role text, created_at timestamptz,
 expires_at timestamptz, revoked_at timestamptz,
 use_count integer, max_uses integer
)
language plpgsql security definer set search_path = ''
as $$
begin
 if auth.uid() is null or not public.gp_is_owner(p_project) then
  raise exception 'Only the project owner can manage invite links' using errcode='42501';
 end if;
 return query
  select l.id,l.role,l.created_at,l.expires_at,l.revoked_at,l.use_count,l.max_uses
  from public.gp_link_invites l
  where l.project_id=p_project
  order by l.created_at desc
  limit 100;
end;
$$;

create or replace function public.gp_revoke_link_invite(p_invite uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
 v_changed integer;
begin
 if auth.uid() is null then
  raise exception 'Sign in required' using errcode='42501';
 end if;
 update public.gp_link_invites l
  set revoked_at=now()
  where l.id=p_invite and l.revoked_at is null
    and exists (
     select 1 from public.gp_projects p
     where p.id=l.project_id and p.owner_id=auth.uid()
    );
 get diagnostics v_changed = row_count;
 return v_changed>0;
end;
$$;

create or replace function public.gp_accept_link_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
 v_invite public.gp_link_invites%rowtype;
 v_added integer;
begin
 if auth.uid() is null then
  raise exception 'Sign in with Discord to join the project' using errcode='42501';
 end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  raise exception 'Invalid invite link';
 end if;
 select l.* into v_invite
  from public.gp_link_invites l
  where l.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
    and l.revoked_at is null
    and l.expires_at>now()
    and l.use_count<l.max_uses
  for update;
 if not found then
  raise exception 'This invite link has expired, been revoked, or reached its usage limit';
 end if;
 insert into public.gp_members(project_id,user_id,role)
  values(v_invite.project_id,auth.uid(),v_invite.role)
  on conflict (project_id,user_id) do nothing;
 get diagnostics v_added = row_count;
 if v_added>0 then
  update public.gp_link_invites
   set use_count=use_count+1
   where id=v_invite.id;
 end if;
 return v_invite.project_id;
end;
$$;

revoke all on function public.gp_create_link_invite(uuid,text,integer) from public, anon;
revoke all on function public.gp_list_link_invites(uuid) from public, anon;
revoke all on function public.gp_revoke_link_invite(uuid) from public, anon;
revoke all on function public.gp_accept_link_invite(text) from public, anon;
grant execute on function public.gp_create_link_invite(uuid,text,integer),
 public.gp_list_link_invites(uuid), public.gp_revoke_link_invite(uuid),
 public.gp_accept_link_invite(text) to authenticated;
