-- ============================================================
-- Sr Air Bud — Fix-It List : database setup
-- Paste this entire file into Supabase > SQL Editor > New query
-- and click RUN. Safe to run more than once.
--
-- BEFORE RUNNING: replace REPLACE-WITH-YOUR-ACCESS-CODE below with
-- the code you want to share with the dealer. Never commit the real
-- code to this repository — it is public.
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
-- Shared login
-- Everyone (owner + service team) signs in as one account using the
-- access code. The app does this behind the scenes when someone types
-- the code, so nobody sees an email prompt.
-- ============================================================

do $$
declare
  crew_id uuid := '70c77437-7c19-4b50-af94-5e508642ebac';
  crew_email text := 'crew@srairbud.app';
  crew_code text := 'REPLACE-WITH-YOUR-ACCESS-CODE';
begin
  if exists (select 1 from auth.users where id = crew_id) then
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
    -- GoTrue reads these as non-null strings; leaving them NULL breaks sign-in.
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change, phone_change,
    phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', crew_id, 'authenticated', 'authenticated',
    crew_email, extensions.crypt(crew_code, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false,
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    crew_id::text, crew_id,
    jsonb_build_object('sub', crew_id::text, 'email', crew_email,
                       'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );
end $$;

-- ============================================================
-- Access rules
-- Bound to the one crew account rather than to "any signed-in user",
-- so that creating an account is not by itself a way past the gate.
-- ============================================================

alter table issues enable row level security;
alter table notes  enable row level security;
alter table photos enable row level security;

drop policy if exists "public all issues" on issues;
drop policy if exists "public all notes"  on notes;
drop policy if exists "public all photos" on photos;

drop policy if exists "crew all issues" on issues;
create policy "crew all issues" on issues for all to authenticated
  using ((select auth.uid()) = '70c77437-7c19-4b50-af94-5e508642ebac')
  with check ((select auth.uid()) = '70c77437-7c19-4b50-af94-5e508642ebac');

drop policy if exists "crew all notes" on notes;
create policy "crew all notes" on notes for all to authenticated
  using ((select auth.uid()) = '70c77437-7c19-4b50-af94-5e508642ebac')
  with check ((select auth.uid()) = '70c77437-7c19-4b50-af94-5e508642ebac');

drop policy if exists "crew all photos" on photos;
create policy "crew all photos" on photos for all to authenticated
  using ((select auth.uid()) = '70c77437-7c19-4b50-af94-5e508642ebac')
  with check ((select auth.uid()) = '70c77437-7c19-4b50-af94-5e508642ebac');

-- Private photo bucket; the app serves images through signed URLs.
insert into storage.buckets (id, name, public)
values ('punchlist-photos', 'punchlist-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "public read punchlist photos"   on storage.objects;
drop policy if exists "public upload punchlist photos" on storage.objects;
drop policy if exists "public delete punchlist photos" on storage.objects;

drop policy if exists "crew read punchlist photos" on storage.objects;
create policy "crew read punchlist photos" on storage.objects for select to authenticated
  using (bucket_id = 'punchlist-photos' and (select auth.uid()) = '70c77437-7c19-4b50-af94-5e508642ebac');

drop policy if exists "crew upload punchlist photos" on storage.objects;
create policy "crew upload punchlist photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'punchlist-photos' and (select auth.uid()) = '70c77437-7c19-4b50-af94-5e508642ebac');

drop policy if exists "crew delete punchlist photos" on storage.objects;
create policy "crew delete punchlist photos" on storage.objects for delete to authenticated
  using (bucket_id = 'punchlist-photos' and (select auth.uid()) = '70c77437-7c19-4b50-af94-5e508642ebac');

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
