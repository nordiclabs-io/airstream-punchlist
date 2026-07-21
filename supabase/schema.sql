-- ============================================================
-- Sr Air Bud — Fix-It List : database setup
-- Paste this entire file into Supabase > SQL Editor > New query
-- and click RUN. Safe to run more than once.
-- ============================================================

-- Issues on the punch list
create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  num int not null,
  loc text not null default '',
  descr text not null default '',
  safety boolean not null default false,
  status text not null default 'open',
  x real not null default 500,
  y real not null default 180,
  created_at timestamptz not null default now()
);

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

-- Open access: anyone with the site link can read and edit.
alter table issues enable row level security;
alter table notes  enable row level security;
alter table photos enable row level security;

drop policy if exists "public all issues" on issues;
create policy "public all issues" on issues for all using (true) with check (true);
drop policy if exists "public all notes" on notes;
create policy "public all notes" on notes for all using (true) with check (true);
drop policy if exists "public all photos" on photos;
create policy "public all photos" on photos for all using (true) with check (true);

-- Storage bucket for photos (public read)
insert into storage.buckets (id, name, public)
values ('punchlist-photos', 'punchlist-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read punchlist photos" on storage.objects;
create policy "public read punchlist photos" on storage.objects
  for select using (bucket_id = 'punchlist-photos');
drop policy if exists "public upload punchlist photos" on storage.objects;
create policy "public upload punchlist photos" on storage.objects
  for insert with check (bucket_id = 'punchlist-photos');
drop policy if exists "public delete punchlist photos" on storage.objects;
create policy "public delete punchlist photos" on storage.objects
  for delete using (bucket_id = 'punchlist-photos');

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
