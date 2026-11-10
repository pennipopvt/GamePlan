-- Run once in the Supabase SQL editor before enabling account-synced drafts.
-- Drafts are never stored in gp_items, which is readable by project teammates.
create table if not exists public.gp_private_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.gp_projects(id) on delete cascade,
  kind text not null check (kind in ('milestones','features','tasks','logs')),
  item_id text not null,
  payload jsonb not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id, kind, item_id)
);

alter table public.gp_private_items enable row level security;
revoke all on public.gp_private_items from anon;
grant select, insert, update, delete on public.gp_private_items to authenticated;

drop policy if exists gp_private_items_select_own on public.gp_private_items;
create policy gp_private_items_select_own on public.gp_private_items
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists gp_private_items_insert_own on public.gp_private_items;
create policy gp_private_items_insert_own on public.gp_private_items
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists gp_private_items_update_own on public.gp_private_items;
create policy gp_private_items_update_own on public.gp_private_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists gp_private_items_delete_own on public.gp_private_items;
create policy gp_private_items_delete_own on public.gp_private_items
  for delete to authenticated using (user_id = (select auth.uid()));
