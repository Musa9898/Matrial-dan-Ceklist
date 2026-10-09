create extension if not exists citext with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null unique,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id text primary key,
  name text not null check (char_length(trim(name)) between 1 and 120),
  owner_email extensions.citext not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id text not null references public.projects(id) on delete cascade,
  email extensions.citext not null,
  user_id uuid references auth.users(id) on delete set null,
  role text not null check (
    role in (
      'admin', 'owner', 'engineering', 'enginering', 'engineer',
      'spv', 'supervisor', 'logistik', 'viewer'
    )
  ),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, email)
);

create unique index project_members_project_user_unique
  on public.project_members(project_id, user_id)
  where user_id is not null;

create index project_members_email_active_idx
  on public.project_members(email)
  where active;

create table public.project_snapshots (
  project_id text primary key references public.projects(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(data) = 'object')
);

create table public.project_folders (
  id text not null,
  project_id text not null references public.projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id),
  unique (project_id, name)
);

create table public.project_files (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  folder_id text,
  name text not null check (char_length(trim(name)) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (project_id, folder_id)
    references public.project_folders(project_id, id)
    on delete restrict
);

create index project_files_project_folder_idx
  on public.project_files(project_id, folder_id, created_at desc);

create or replace function private.request_email()
returns extensions.citext
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))::extensions.citext
$$;

create or replace function private.member_role(target_project_id text)
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select pm.role
  from public.project_members pm
  where pm.project_id = target_project_id
    and pm.active
    and (
      pm.user_id = auth.uid()
      or pm.email = private.request_email()
    )
  limit 1
$$;

create or replace function private.has_project_permission(
  target_project_id text,
  requested_permission text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  member_role text := private.member_role(target_project_id);
begin
  if member_role is null then
    return false;
  end if;

  if requested_permission = 'read' then
    return true;
  end if;

  if member_role in ('admin', 'owner') then
    return true;
  end if;

  if requested_permission in ('material', 'asset')
    and member_role in (
      'engineering', 'enginering', 'engineer',
      'spv', 'supervisor', 'logistik'
    ) then
    return true;
  end if;

  if requested_permission in ('checklist', 'daily_report')
    and member_role in (
      'engineering', 'enginering', 'engineer',
      'spv', 'supervisor'
    ) then
    return true;
  end if;

  if requested_permission in ('files', 'create_project')
    and member_role in ('engineering', 'enginering', 'engineer') then
    return true;
  end if;

  if requested_permission = 'manage_members'
    and member_role in ('admin', 'owner') then
    return true;
  end if;

  return false;
end;
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row execute function private.set_updated_at();

create trigger project_members_set_updated_at
before update on public.project_members
for each row execute function private.set_updated_at();

create trigger project_folders_set_updated_at
before update on public.project_folders
for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    lower(new.email)::extensions.citext,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();

  update public.project_members
  set user_id = new.id, updated_at = now()
  where email = lower(new.email)::extensions.citext
    and user_id is null;

  return new;
end;
$$;

create trigger auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function private.handle_new_user();

create or replace function private.create_project_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.project_snapshots (project_id)
  values (new.id)
  on conflict (project_id) do nothing;
  return new;
end;
$$;

create trigger project_created_snapshot
after insert on public.projects
for each row execute function private.create_project_snapshot();

create or replace function public.save_project_snapshot(
  target_project_id text,
  requested_snapshot jsonb,
  expected_version bigint default null
)
returns public.project_snapshots
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  current_row public.project_snapshots;
  next_data jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(requested_snapshot) <> 'object' then
    raise exception 'Snapshot must be a JSON object';
  end if;

  if not private.has_project_permission(target_project_id, 'read') then
    raise exception 'Project access denied';
  end if;

  select *
  into current_row
  from public.project_snapshots
  where project_id = target_project_id
  for update;

  if not found then
    raise exception 'Project snapshot not found';
  end if;

  if expected_version is not null and expected_version <> current_row.version then
    raise exception 'Snapshot has changed; reload before saving'
      using errcode = '40001';
  end if;

  next_data := current_row.data;

  if private.has_project_permission(target_project_id, 'material') then
    if requested_snapshot ? 'materialItems' then
      next_data := jsonb_set(next_data, '{materialItems}', requested_snapshot -> 'materialItems', true);
    end if;
    if requested_snapshot ? 'deliveryHistory' then
      next_data := jsonb_set(next_data, '{deliveryHistory}', requested_snapshot -> 'deliveryHistory', true);
    end if;
    if requested_snapshot ? 'usageHistory' then
      next_data := jsonb_set(next_data, '{usageHistory}', requested_snapshot -> 'usageHistory', true);
    end if;
  end if;

  if private.has_project_permission(target_project_id, 'asset')
    and requested_snapshot ? 'assetItems' then
    next_data := jsonb_set(next_data, '{assetItems}', requested_snapshot -> 'assetItems', true);
  end if;

  if private.has_project_permission(target_project_id, 'checklist')
    and requested_snapshot ? 'checklistItems' then
    next_data := jsonb_set(next_data, '{checklistItems}', requested_snapshot -> 'checklistItems', true);
  end if;

  if private.has_project_permission(target_project_id, 'daily_report')
    and requested_snapshot ? 'dailyWorkPlans' then
    next_data := jsonb_set(next_data, '{dailyWorkPlans}', requested_snapshot -> 'dailyWorkPlans', true);
  end if;

  if private.has_project_permission(target_project_id, 'files')
    and requested_snapshot ? 'projectFolders' then
    next_data := jsonb_set(next_data, '{projectFolders}', requested_snapshot -> 'projectFolders', true);
  end if;

  update public.project_snapshots
  set
    data = next_data,
    version = version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where project_id = target_project_id
  returning * into current_row;

  return current_row;
end;
$$;

revoke all on function public.save_project_snapshot(text, jsonb, bigint) from public;
grant execute on function public.save_project_snapshot(text, jsonb, bigint) to authenticated;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_snapshots enable row level security;
alter table public.project_folders enable row level security;
alter table public.project_files enable row level security;

create policy profiles_read_own
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy projects_read_members
on public.projects for select
to authenticated
using (private.has_project_permission(id, 'read'));

create policy project_members_read_members
on public.project_members for select
to authenticated
using (private.has_project_permission(project_id, 'read'));

create policy project_members_manage_admins
on public.project_members for all
to authenticated
using (private.has_project_permission(project_id, 'manage_members'))
with check (private.has_project_permission(project_id, 'manage_members'));

create policy project_snapshots_read_members
on public.project_snapshots for select
to authenticated
using (private.has_project_permission(project_id, 'read'));

create policy project_folders_read_members
on public.project_folders for select
to authenticated
using (private.has_project_permission(project_id, 'read'));

create policy project_folders_manage_files
on public.project_folders for all
to authenticated
using (private.has_project_permission(project_id, 'files'))
with check (private.has_project_permission(project_id, 'files'));

create policy project_files_read_members
on public.project_files for select
to authenticated
using (private.has_project_permission(project_id, 'read'));

create policy project_files_manage_files
on public.project_files for all
to authenticated
using (private.has_project_permission(project_id, 'files'))
with check (private.has_project_permission(project_id, 'files'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 26214400)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

create policy project_storage_read_members
on storage.objects for select
to authenticated
using (
  bucket_id = 'project-files'
  and private.has_project_permission((storage.foldername(name))[1], 'read')
);

create policy project_storage_insert_files
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-files'
  and private.has_project_permission((storage.foldername(name))[1], 'files')
);

create policy project_storage_update_files
on storage.objects for update
to authenticated
using (
  bucket_id = 'project-files'
  and private.has_project_permission((storage.foldername(name))[1], 'files')
)
with check (
  bucket_id = 'project-files'
  and private.has_project_permission((storage.foldername(name))[1], 'files')
);

create policy project_storage_delete_files
on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-files'
  and private.has_project_permission((storage.foldername(name))[1], 'files')
);
