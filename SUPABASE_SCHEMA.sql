create extension if not exists pgcrypto;

create table if not exists public.service_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null default 'agent' check (role in ('admin', 'agent')),
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.service_cases (
  id uuid primary key default gen_random_uuid(),
  citizen_name text not null,
  national_id text not null,
  status text not null default 'pending' check (status in ('pending', 'open', 'closed')),
  interview_status text not null default 'idle' check (interview_status in ('idle', 'active')),
  assigned_user_id uuid references public.service_users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (citizen_name, national_id)
);

create table if not exists public.service_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.service_cases(id) on delete cascade,
  sender_type text not null check (sender_type in ('system', 'citizen', 'agent', 'admin')),
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.service_files (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.service_cases(id) on delete cascade,
  uploaded_by text not null,
  original_name text not null,
  stored_name text not null,
  mime_type text not null,
  size bigint not null default 0,
  kind text not null default 'upload' check (kind in ('upload', 'recording')),
  public_url text not null,
  created_at timestamptz not null default now()
);

alter table public.service_cases add column if not exists interview_status text not null default 'idle';

create index if not exists service_cases_created_at_idx on public.service_cases(created_at desc);
create index if not exists service_cases_status_idx on public.service_cases(status);
create index if not exists service_cases_interview_status_idx on public.service_cases(interview_status);
create index if not exists service_messages_case_id_created_at_idx on public.service_messages(case_id, created_at);
create index if not exists service_files_case_id_created_at_idx on public.service_files(case_id, created_at desc);

alter table public.service_users enable row level security;
alter table public.service_cases enable row level security;
alter table public.service_messages enable row level security;
alter table public.service_files enable row level security;

drop policy if exists service_users_service_role_all on public.service_users;
drop policy if exists service_cases_service_role_all on public.service_cases;
drop policy if exists service_messages_service_role_all on public.service_messages;
drop policy if exists service_files_service_role_all on public.service_files;

create policy service_users_service_role_all on public.service_users
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy service_cases_service_role_all on public.service_cases
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy service_messages_service_role_all on public.service_messages
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy service_files_service_role_all on public.service_files
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

insert into storage.buckets (id, name, public)
values ('report-videos', 'report-videos', true)
on conflict (id) do update set public = excluded.public;