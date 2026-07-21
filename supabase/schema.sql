-- ============================================================
-- Sr Air Bud — Fix-It List : database setup
-- Paste this entire file into Supabase > SQL Editor > New query
-- and click RUN. Safe to run more than once.
--
-- BEFORE RUNNING: replace the two placeholder codes below. Never commit
-- the real codes to this repository — it is public.
--
-- There are two shared logins:
--   view code — opens the list read-only
--   edit code — also allows changes
-- The split is enforced by the policies at the bottom of this file, not by
-- the app, so the view code cannot change anything even outside the website.
-- ============================================================

-- Issues on the punch list
create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  num int not null unique,
  loc text not null default '',
  descr text not null default '',
  safety boolean not null default false,
  status text not null default 'open',
  x real not null default 500,
  y real not null default 180,
  created_at timestamptz not null default now()
);

-- Backfill the unique constraint on databases created before it was added.
-- Without it, two first-time visitors racing each other each seed the list.
do $$
begin
  alter table issues add constraint issues_num_key unique (num);
exception when duplicate_table or duplicate_object then null;
end $$;

-- Notes & questions on an issue
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  author text not null default '',
  type text not null default 'note',      -- 'note' | 'question'
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Photo records (files live in the storage bucket)
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- The two shared logins
-- The app signs in behind the scenes when someone types a code, so
-- nobody ever sees an email prompt.
-- ============================================================

create or replace function public.ensure_crew_user(
  user_id uuid, user_email text, user_code text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users where id = user_id) then return; end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
    -- GoTrue reads these as non-null strings; leaving them NULL breaks sign-in.
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change, phone_change,
    phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', user_id, 'authenticated', 'authenticated',
    user_email, extensions.crypt(user_code, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false,
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    user_id::text, user_id,
    jsonb_build_object('sub', user_id::text, 'email', user_email,
                       'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );
end $$;

select public.ensure_crew_user(
  '70c77437-7c19-4b50-af94-5e508642ebac', 'crew@srairbud.app',
  'REPLACE-WITH-YOUR-VIEW-CODE');

select public.ensure_crew_user(
  'b1e4d2a7-9c33-4f18-8a6b-2d5e7f019c44', 'editor@srairbud.app',
  'REPLACE-WITH-YOUR-EDIT-CODE');

drop function public.ensure_crew_user(uuid, text, text);

-- ============================================================
-- Access rules
-- Bound to specific account ids rather than to "any signed-in user", so
-- that creating an account is not by itself a way past the gate.
-- Reading needs either code; writing needs the edit code.
-- ============================================================

alter table issues enable row level security;
alter table notes  enable row level security;
alter table photos enable row level security;

create or replace function public.is_editor() returns boolean
language sql stable security invoker set search_path = ''
as $$ select (select auth.uid()) = 'b1e4d2a7-9c33-4f18-8a6b-2d5e7f019c44'::uuid $$;

create or replace function public.is_crew() returns boolean
language sql stable security invoker set search_path = ''
as $$ select (select auth.uid()) in (
  '70c77437-7c19-4b50-af94-5e508642ebac'::uuid,
  'b1e4d2a7-9c33-4f18-8a6b-2d5e7f019c44'::uuid) $$;

drop policy if exists "public all issues" on issues;
drop policy if exists "public all notes"  on notes;
drop policy if exists "public all photos" on photos;
drop policy if exists "crew all issues" on issues;
drop policy if exists "crew all notes"  on notes;
drop policy if exists "crew all photos" on photos;

drop policy if exists "read issues" on issues;
create policy "read issues" on issues for select to authenticated using (public.is_crew());
drop policy if exists "write issues" on issues;
create policy "write issues" on issues for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read notes" on notes;
create policy "read notes" on notes for select to authenticated using (public.is_crew());
drop policy if exists "write notes" on notes;
create policy "write notes" on notes for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read photos" on photos;
create policy "read photos" on photos for select to authenticated using (public.is_crew());
drop policy if exists "write photos" on photos;
create policy "write photos" on photos for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

-- Private photo bucket; the app serves images through signed URLs.
insert into storage.buckets (id, name, public)
values ('punchlist-photos', 'punchlist-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "public read punchlist photos"   on storage.objects;
drop policy if exists "public upload punchlist photos" on storage.objects;
drop policy if exists "public delete punchlist photos" on storage.objects;

drop policy if exists "crew read punchlist photos"   on storage.objects;
drop policy if exists "crew upload punchlist photos" on storage.objects;
drop policy if exists "crew delete punchlist photos" on storage.objects;

drop policy if exists "read punchlist photos" on storage.objects;
create policy "read punchlist photos" on storage.objects for select to authenticated
  using (bucket_id = 'punchlist-photos' and public.is_crew());

drop policy if exists "upload punchlist photos" on storage.objects;
create policy "upload punchlist photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'punchlist-photos' and public.is_editor());

drop policy if exists "delete punchlist photos" on storage.objects;
create policy "delete punchlist photos" on storage.objects for delete to authenticated
  using (bucket_id = 'punchlist-photos' and public.is_editor());

-- Live updates: lets the owner and dealer see each other's changes instantly
do $$
begin
  begin
    alter publication supabase_realtime add table issues;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table notes;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table photos;
  exception when duplicate_object then null;
  end;
end $$;
