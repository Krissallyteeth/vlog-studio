-- Vlog Studio sync — run once in Supabase: SQL Editor → New query → paste → Run.
-- Safe to run again.

create table if not exists public.projects (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb,                               -- the whole project (null when deleted)
  updated_at bigint not null,               -- project.updatedAt in ms: newest edit wins
  deleted boolean not null default false,   -- kept as a marker so other devices delete it too
  server_updated_at timestamptz not null default now(),  -- what devices pull by
  primary key (user_id, id)
);

create index if not exists projects_pull_idx on public.projects (user_id, server_updated_at);

-- Defense in depth: reject absurdly large project blobs (~512 KB) so a tampered client
-- (which holds the user's own token) cannot abuse storage. RLS still guards other users' rows.
alter table public.projects drop constraint if exists projects_data_size;
alter table public.projects add constraint projects_data_size
  check (data is null or pg_column_size(data) <= 512 * 1024);

grant select, insert, update, delete on public.projects to authenticated;
revoke all on public.projects from anon;

-- Each signed-in user only ever sees and changes their own rows.
alter table public.projects enable row level security;
drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.projects_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before insert or update on public.projects
  for each row execute function public.projects_touch();

-- Upload from a device: insert, or overwrite only when the device's copy is newer.
-- Validates its input (row count, id length, numeric timestamp) so a tampered client can only
-- ever touch its own rows, within sane bounds.
create or replace function public.push_projects(rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(rows) > 500 then
    raise exception 'too many rows in one call (max 500)' using errcode = '54000';
  end if;

  insert into public.projects as p (user_id, id, data, updated_at, deleted)
  select auth.uid(),
         r ->> 'id',
         case when coalesce((r ->> 'deleted')::boolean, false) then null else r -> 'data' end,
         (r ->> 'updated_at')::bigint,
         coalesce((r ->> 'deleted')::boolean, false)
  from jsonb_array_elements(rows) as r
  where auth.uid() is not null
    and r ->> 'id' is not null
    and length(r ->> 'id') <= 64
    and (r ->> 'updated_at') ~ '^[0-9]{1,19}$'
  on conflict (user_id, id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at,
        deleted = excluded.deleted
    where excluded.updated_at > p.updated_at;
end $$;

revoke all on function public.push_projects(jsonb) from public, anon;
grant execute on function public.push_projects(jsonb) to authenticated;

-- ── Shot-list photos ────────────────────────────────────────────────
-- Private bucket; files live at <user id>/<media id>. The app shrinks photos to ~1024 px WebP/JPEG
-- (usually 40–120 KB) before upload, so 1 MB per file is a generous ceiling.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/webp', 'image/jpeg'];

drop policy if exists "media: read own" on storage.objects;
drop policy if exists "media: add own" on storage.objects;
drop policy if exists "media: update own" on storage.objects;
drop policy if exists "media: delete own" on storage.objects;

create policy "media: read own" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media: add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media: update own" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 小红书 performance data ─────────────────────────────────────────
-- Posts, sponsorship income and settings/baselines, synced per user like projects.
create table if not exists public.xhs_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('post', 'income', 'meta')),
  id text not null check (length(id) <= 64),
  data jsonb check (data is null or pg_column_size(data) <= 512 * 1024),
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);
create index if not exists xhs_records_pull_idx on public.xhs_records (user_id, server_updated_at);

grant select, insert, update, delete on public.xhs_records to authenticated;
revoke all on public.xhs_records from anon;

alter table public.xhs_records enable row level security;
drop policy if exists "own xhs records" on public.xhs_records;
create policy "own xhs records" on public.xhs_records
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists xhs_records_touch on public.xhs_records;
create trigger xhs_records_touch before insert or update on public.xhs_records
  for each row execute function public.projects_touch();

create or replace function public.push_xhs(rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(rows) > 500 then
    raise exception 'too many rows in one call (max 500)' using errcode = '54000';
  end if;

  insert into public.xhs_records as x (user_id, kind, id, data, updated_at, deleted)
  select auth.uid(),
         r ->> 'kind',
         r ->> 'id',
         case when coalesce((r ->> 'deleted')::boolean, false) then null else r -> 'data' end,
         (r ->> 'updated_at')::bigint,
         coalesce((r ->> 'deleted')::boolean, false)
  from jsonb_array_elements(rows) as r
  where auth.uid() is not null
    and r ->> 'kind' in ('post', 'income', 'meta')
    and r ->> 'id' is not null
    and length(r ->> 'id') <= 64
    and (r ->> 'updated_at') ~ '^[0-9]{1,19}$'
  on conflict (user_id, kind, id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at,
        deleted = excluded.deleted
    where excluded.updated_at > x.updated_at;
end $$;

revoke all on function public.push_xhs(jsonb) from public, anon;
grant execute on function public.push_xhs(jsonb) to authenticated;
