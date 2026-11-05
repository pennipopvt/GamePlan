-- GamePlan Cloud v1: one row per item, so teammates never overwrite an entire project.
-- Run in a NEW Supabase project's SQL Editor. Keep the existing local site unchanged.
create extension if not exists pgcrypto;

create table if not exists public.gp_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gp_projects_owner_idx on public.gp_projects(owner_id);

create table if not exists public.gp_members (
  project_id uuid not null references public.gp_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key (project_id,user_id)
);
create index if not exists gp_members_user_idx on public.gp_members(user_id);

create table if not exists public.gp_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.gp_projects(id) on delete cascade,
  email text not null check (length(trim(email)) between 3 and 254 and position('@' in email)>1),
  role text not null default 'editor' check (role in ('editor','viewer')),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id,email)
);

-- Existing app identifiers are strings; keep them stable during migration.
-- Every task/feature/milestone/log/tag/template gets its own row.
create table if not exists public.gp_items (
  project_id uuid not null references public.gp_projects(id) on delete cascade,
  kind text not null check (kind in ('milestones','features','tasks','logs','tags','templates','team','custom_tag_colors')),
  item_id text not null check (length(item_id) between 1 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key(project_id,kind,item_id)
);
create index if not exists gp_items_kind_idx on public.gp_items(project_id,kind,sort_order);

-- Security-definer checks avoid recursive membership policy evaluation.
create or replace function public.gp_is_member(p_id uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gp_members
    where project_id=p_id and user_id=(select auth.uid())
  );
$$;
create or replace function public.gp_can_edit(p_id uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gp_members
    where project_id=p_id and user_id=(select auth.uid()) and role in ('owner','editor')
  );
$$;
create or replace function public.gp_is_owner(p_id uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gp_projects
    where id=p_id and owner_id=(select auth.uid())
  );
$$;
revoke all on function public.gp_is_member(uuid) from public;
revoke all on function public.gp_can_edit(uuid) from public;
revoke all on function public.gp_is_owner(uuid) from public;
grant execute on function public.gp_is_member(uuid),public.gp_can_edit(uuid),public.gp_is_owner(uuid) to authenticated;

-- New projects automatically include their creator.
create or replace function public.gp_add_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
 insert into public.gp_members(project_id,user_id,role) values(new.id,new.owner_id,'owner');
 return new;
end;
$$;
drop trigger if exists gp_add_owner_trigger on public.gp_projects;
create trigger gp_add_owner_trigger after insert on public.gp_projects
for each row execute function public.gp_add_owner();

-- Invite access is granted only to an authenticated account whose email matches.
-- Call on sign-in to accept any pending invitations automatically.
create or replace function public.gp_claim_invites()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  matching_email text;
  accepted integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select lower(email) into matching_email from auth.users where id=auth.uid();
 if matching_email is null then return 0; end if;
 insert into public.gp_members(project_id,user_id,role)
 select inv.project_id,auth.uid(),inv.role
 from public.gp_invites inv
 where inv.email=matching_email
 on conflict(project_id,user_id) do nothing;
 get diagnostics accepted = row_count;
 delete from public.gp_invites where email=matching_email
   and exists(select 1 from public.gp_members m
              where m.project_id=gp_invites.project_id and m.user_id=auth.uid());
 return accepted;
end;
$$;
revoke all on function public.gp_claim_invites() from public;
grant execute on function public.gp_claim_invites() to authenticated;

alter table public.gp_projects enable row level security;
alter table public.gp_members enable row level security;
alter table public.gp_invites enable row level security;
alter table public.gp_items enable row level security;

create policy "members see projects" on public.gp_projects for select to authenticated
 using (public.gp_is_member(id));
create policy "users create owned projects" on public.gp_projects for insert to authenticated
 with check (owner_id=(select auth.uid()));
create policy "owners edit projects" on public.gp_projects for update to authenticated
 using (public.gp_is_owner(id)) with check (public.gp_is_owner(id) and owner_id=(select auth.uid()));
create policy "owners delete projects" on public.gp_projects for delete to authenticated
 using (public.gp_is_owner(id));

create policy "members see members" on public.gp_members for select to authenticated
 using (public.gp_is_member(project_id));
create policy "owners remove members" on public.gp_members for delete to authenticated
 using (public.gp_is_owner(project_id) and role<>'owner');

create policy "owners see invites" on public.gp_invites for select to authenticated
 using (public.gp_is_owner(project_id));
create policy "owners invite" on public.gp_invites for insert to authenticated
 with check (public.gp_is_owner(project_id) and invited_by=(select auth.uid()) and email=lower(trim(email)));
create policy "owners revoke invites" on public.gp_invites for delete to authenticated
 using (public.gp_is_owner(project_id));

create policy "members read project items" on public.gp_items for select to authenticated
 using (public.gp_is_member(project_id));
create policy "editors insert project items" on public.gp_items for insert to authenticated
 with check (public.gp_can_edit(project_id) and updated_by=(select auth.uid()));
create policy "editors update project items" on public.gp_items for update to authenticated
 using (public.gp_can_edit(project_id))
 with check (public.gp_can_edit(project_id) and updated_by=(select auth.uid()));
create policy "editors delete project items" on public.gp_items for delete to authenticated
 using (public.gp_can_edit(project_id));

revoke all on public.gp_projects,public.gp_members,public.gp_invites,public.gp_items from anon;
grant select,insert,update,delete on public.gp_projects to authenticated;
grant select,delete on public.gp_members to authenticated;
grant select,insert,delete on public.gp_invites to authenticated;
grant select,insert,update,delete on public.gp_items to authenticated;

-- Enable gp_items under Database > Publications > supabase_realtime
-- or run the next statement ONCE after confirming it isn't already published:
-- alter publication supabase_realtime add table public.gp_items;
