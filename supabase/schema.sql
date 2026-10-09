-- =====================================================================
-- Skema Supabase — Aplikasi Monitoring Material & Checklist MEP
-- Project ref : ktmbunxnmdmrhpffjbxg  ("Project Monitor MEP")
-- Status      : SUDAH DITERAPKAN di database (lihat SQL Editor)
--
-- File ini adalah cerminan kondisi database saat ini dan bersifat
-- idempotent, jadi aman dijalankan ulang di SQL Editor.
--
-- Struktur tabel data mengikuti sheet yang dipakai Code.gs supaya
-- migrasi dari Google Sheets bisa 1:1:
--   Materials -> materials, Assets -> assets,
--   Checklists -> checklists, DailyReports -> daily_reports,
--   Projects -> projects, Access -> project_members,
--   ProjectFiles -> project_files, ProjectFolders -> project_folders,
--   ProjectData -> project_snapshots
-- =====================================================================

create extension if not exists citext with schema extensions;
create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. Tabel inti (akun, proyek, keanggotaan)
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        extensions.citext not null unique,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.projects (
  id          text primary key,
  name        text not null,
  owner_email extensions.citext,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Padanan sheet "Access"
create table if not exists public.project_members (
  project_id text not null references public.projects (id) on delete cascade,
  email      extensions.citext not null,
  user_id    uuid references auth.users (id) on delete set null,
  role       text not null default 'viewer',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, email)
);

-- Padanan sheet "ProjectData" (snapshot JSON seluruh proyek)
create table if not exists public.project_snapshots (
  project_id text primary key references public.projects (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  version    bigint not null default 1,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Tabel data per proyek
-- ---------------------------------------------------------------------

create table if not exists public.materials (
  record_id     text primary key,
  project_id    text not null references public.projects (id) on delete cascade,
  material_name text,
  unit          text,
  qty_received  numeric,
  qty_issued    numeric,
  qty_balance   numeric,
  target        numeric,
  status        text,
  date          date,
  reporter      text,
  notes         text,
  drive_url     text,
  payload_json  jsonb,
  email         text,
  updated_at    timestamptz not null default now()
);

create table if not exists public.assets (
  record_id    text primary key,
  project_id   text not null references public.projects (id) on delete cascade,
  asset_name   text,
  asset_code   text,
  category     text,
  quantity     numeric,
  status       text,
  location     text,
  date         date,
  reporter     text,
  notes        text,
  drive_url    text,
  payload_json jsonb,
  email        text,
  updated_at   timestamptz not null default now()
);

create table if not exists public.checklists (
  record_id    text primary key,
  project_id   text not null references public.projects (id) on delete cascade,
  date         date,
  area         text,
  discipline   text,
  work         text,
  status       text,
  progress     numeric,
  supervisor   text,
  assignee     text,
  due_date     date,
  notes        text,
  drive_url    text,
  payload_json jsonb,
  email        text,
  updated_at   timestamptz not null default now()
);

create table if not exists public.daily_reports (
  record_id     text primary key,
  project_id    text not null references public.projects (id) on delete cascade,
  report_title  text,
  date          date,
  supervisor    text,
  task_count    integer,
  total_workers integer,
  task_summary  text,
  payload_json  jsonb,
  email         text,
  updated_at    timestamptz not null default now()
);

create table if not exists public.project_folders (
  id         text primary key,
  project_id text not null references public.projects (id) on delete cascade,
  name       text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lampiran disimpan di Supabase Storage (storage_path), bukan Google Drive
create table if not exists public.project_files (
  id           text primary key,
  project_id   text not null references public.projects (id) on delete cascade,
  folder_id    text references public.project_folders (id) on delete set null,
  name         text,
  storage_path text,
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists materials_project_idx       on public.materials (project_id);
create index if not exists assets_project_idx          on public.assets (project_id);
create index if not exists checklists_project_idx      on public.checklists (project_id);
create index if not exists daily_reports_project_idx   on public.daily_reports (project_id);
create index if not exists project_folders_project_idx on public.project_folders (project_id);
create index if not exists project_files_project_idx   on public.project_files (project_id);

-- ---------------------------------------------------------------------
-- 3. Helper RLS (schema private, tidak diekspos ke PostgREST)
-- ---------------------------------------------------------------------

create or replace function private.request_email()
returns extensions.citext
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))::extensions.citext;
$$;

create or replace function private.member_role(target_project_id text)
returns text
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select pm.role
  from public.project_members pm
  where pm.project_id = target_project_id
    and pm.active
    and (pm.user_id = auth.uid() or pm.email = private.request_email())
  limit 1;
$$;

-- Pemetaan role -> izin, mengikuti aturan di Code.gs
create or replace function private.has_project_permission(
  target_project_id text,
  requested_permission text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  member_role text := private.member_role(target_project_id);
begin
  if member_role is null then
    return false;
  end if;

  -- Semua anggota aktif boleh membaca
  if requested_permission = 'read' then
    return true;
  end if;

  if member_role in ('admin', 'owner') then
    return true;
  end if;

  if requested_permission in ('material', 'asset')
     and member_role in ('engineering', 'enginering', 'engineer', 'spv', 'supervisor', 'logistik') then
    return true;
  end if;

  if requested_permission in ('checklist', 'daily_report')
     and member_role in ('engineering', 'enginering', 'engineer', 'spv', 'supervisor') then
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

-- ---------------------------------------------------------------------
-- 4. Trigger
-- ---------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Sinkronisasi profil + klaim baris Access yang menunggu user_id
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
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
    set email        = excluded.email,
        display_name = excluded.display_name,
        avatar_url   = excluded.avatar_url,
        updated_at   = now();

  update public.project_members
     set user_id = new.id, updated_at = now()
   where email = lower(new.email)::extensions.citext
     and user_id is null;

  return new;
end;
$$;

drop trigger if exists auth_user_created on auth.users;
create trigger auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.create_project_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.project_snapshots (project_id)
  values (new.id)
  on conflict (project_id) do nothing;
  return new;
end;
$$;

-- Pembuat proyek otomatis menjadi owner, agar tidak terkunci oleh RLS
create or replace function private.add_owner_member()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  insert into public.project_members (project_id, email, user_id, role, active)
  values (new.id, new.owner_email, auth.uid(), 'owner', true)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists project_created_snapshot on public.projects;
create trigger project_created_snapshot after insert on public.projects
  for each row execute function private.create_project_snapshot();

drop trigger if exists project_created_owner on public.projects;
create trigger project_created_owner after insert on public.projects
  for each row execute function private.add_owner_member();

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'projects', 'project_members', 'project_folders',
    'materials', 'assets', 'checklists', 'daily_reports'
  ] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$s', t);
    execute format(
      'create trigger %1$s_set_updated_at before update on public.%1$s
         for each row execute function private.set_updated_at()', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.projects          enable row level security;
alter table public.project_members   enable row level security;
alter table public.project_snapshots enable row level security;
alter table public.materials         enable row level security;
alter table public.assets            enable row level security;
alter table public.checklists        enable row level security;
alter table public.daily_reports     enable row level security;
alter table public.project_folders   enable row level security;
alter table public.project_files     enable row level security;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists projects_read_members on public.projects;
create policy projects_read_members on public.projects
  for select to authenticated
  using (private.has_project_permission(id, 'read'));

-- Pembuat proyek wajib mendaftarkan dirinya sendiri sebagai owner_email
drop policy if exists projects_insert_owner on public.projects;
create policy projects_insert_owner on public.projects
  for insert to authenticated
  with check (owner_email = private.request_email());

drop policy if exists projects_update_admins on public.projects;
create policy projects_update_admins on public.projects
  for update to authenticated
  using (private.has_project_permission(id, 'manage_members'))
  with check (private.has_project_permission(id, 'manage_members'));

drop policy if exists projects_delete_admins on public.projects;
create policy projects_delete_admins on public.projects
  for delete to authenticated
  using (private.has_project_permission(id, 'manage_members'));

drop policy if exists project_members_read_members on public.project_members;
create policy project_members_read_members on public.project_members
  for select to authenticated
  using (private.has_project_permission(project_id, 'read'));

drop policy if exists project_members_manage_admins on public.project_members;
create policy project_members_manage_admins on public.project_members
  for all to authenticated
  using (private.has_project_permission(project_id, 'manage_members'))
  with check (private.has_project_permission(project_id, 'manage_members'));

drop policy if exists project_snapshots_read_members on public.project_snapshots;
create policy project_snapshots_read_members on public.project_snapshots
  for select to authenticated
  using (private.has_project_permission(project_id, 'read'));

drop policy if exists project_snapshots_write_members on public.project_snapshots;
create policy project_snapshots_write_members on public.project_snapshots
  for all to authenticated
  using (private.has_project_permission(project_id, 'material'))
  with check (private.has_project_permission(project_id, 'material'));

drop policy if exists project_folders_read_members on public.project_folders;
create policy project_folders_read_members on public.project_folders
  for select to authenticated
  using (private.has_project_permission(project_id, 'read'));

drop policy if exists project_folders_manage_files on public.project_folders;
create policy project_folders_manage_files on public.project_folders
  for all to authenticated
  using (private.has_project_permission(project_id, 'files'))
  with check (private.has_project_permission(project_id, 'files'));

drop policy if exists project_files_read_members on public.project_files;
create policy project_files_read_members on public.project_files
  for select to authenticated
  using (private.has_project_permission(project_id, 'read'));

drop policy if exists project_files_manage_files on public.project_files;
create policy project_files_manage_files on public.project_files
  for all to authenticated
  using (private.has_project_permission(project_id, 'files'))
  with check (private.has_project_permission(project_id, 'files'));

-- Tabel data per proyek: baca untuk semua anggota, tulis sesuai role
do $$
declare rec record;
begin
  for rec in select * from (values
      ('materials',     'material'),
      ('assets',        'asset'),
      ('checklists',    'checklist'),
      ('daily_reports', 'daily_report')
    ) as t(tbl, kind)
  loop
    execute format('drop policy if exists %1$s_read_members on public.%1$s', rec.tbl);
    execute format(
      'create policy %1$s_read_members on public.%1$s
         for select to authenticated
         using (private.has_project_permission(project_id, ''read''))', rec.tbl);

    execute format('drop policy if exists %1$s_manage on public.%1$s', rec.tbl);
    execute format(
      'create policy %1$s_manage on public.%1$s
         for all to authenticated
         using (private.has_project_permission(project_id, %2$L))
         with check (private.has_project_permission(project_id, %2$L))', rec.tbl, rec.kind);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 6. Hak akses role Supabase
--    anon sengaja tidak diberi akses tabel: semua data wajib lewat login.
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
