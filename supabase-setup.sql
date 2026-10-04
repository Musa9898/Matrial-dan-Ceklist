create table if not exists public.project_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  employee_id text not null unique,
  full_name text not null,
  role text not null check (role in (
    'Administrator',
    'Site Engineer',
    'Pelaksana Lapangan',
    'Logistik',
    'Estimator/MEP'
  )),
  project_id text not null,
  project_name text not null,
  created_at timestamptz not null default now()
);

alter table public.project_access enable row level security;

alter table public.project_access
  drop constraint if exists project_access_role_check;
alter table public.project_access
  add constraint project_access_role_check
  check (role in (
    'Administrator',
    'Site Engineer',
    'Pelaksana Lapangan',
    'Logistik',
    'Estimator/MEP'
  ));

revoke all on table public.project_access from public, anon, authenticated;
grant select on table public.project_access to authenticated;

drop policy if exists "Users can read their own project access" on public.project_access;
create policy "Users can read their own project access"
  on public.project_access
  for select
  to authenticated
  using ((select auth.uid()) = user_id);