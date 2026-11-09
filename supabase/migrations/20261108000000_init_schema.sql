-- =============================================================================
-- Noted (Smart Notepad) — initial schema
--
-- Security model
--   * Every application table has Row Level Security enabled.
--   * The `anon` role has NO table privileges: guests never touch the database.
--   * The `authenticated` role gets only the minimum column-level privileges it
--     needs. `owner_id` is never insertable/updatable by clients; it defaults to
--     auth.uid(), so ownership cannot be forged or transferred.
--   * Cross-table ownership (note→folder, note↔tag) is enforced by composite
--     foreign keys and triggers, not only by the UI.
--   * note_versions is read-only for clients. Versions are written exclusively
--     by SECURITY DEFINER functions that verify ownership first.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  avatar_path  text check (avatar_path is null or char_length(avatar_path) <= 512),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- user_preferences (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.user_preferences (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  theme            text    not null default 'system' check (theme in ('light', 'dark', 'system')),
  font_size        integer not null default 16 check (font_size between 12 and 28),
  autosave_enabled boolean not null default true
);

-- -----------------------------------------------------------------------------
-- folders (users 1:N folders)
-- -----------------------------------------------------------------------------
create table public.folders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target for the composite FK from notes: guarantees same-owner linking.
  constraint folders_id_owner_key unique (id, owner_id)
);

-- No duplicate folder names per user (case/whitespace-insensitive).
create unique index folders_owner_name_key on public.folders (owner_id, lower(btrim(name)));

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- notes (users 1:N notes, folders 1:N notes)
-- -----------------------------------------------------------------------------
create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id   uuid,
  title       text    not null default '' check (char_length(title) <= 200),
  content     text    not null default '' check (char_length(content) <= 1000000),
  is_pinned   boolean not null default false,
  is_archived boolean not null default false,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint notes_id_owner_key unique (id, owner_id),
  -- A note can only reference a folder with the SAME owner. Deleting a folder
  -- moves its notes to "uncategorized" (only folder_id is nulled).
  constraint notes_folder_same_owner_fk
    foreign key (folder_id, owner_id)
    references public.folders (id, owner_id)
    on delete set null (folder_id)
);

create index notes_owner_updated_idx on public.notes (owner_id, updated_at desc);
create index notes_owner_created_idx on public.notes (owner_id, created_at desc);
create index notes_owner_folder_idx  on public.notes (owner_id, folder_id);
create index notes_owner_deleted_idx on public.notes (owner_id, deleted_at);
create index notes_title_trgm_idx    on public.notes using gin (title extensions.gin_trgm_ops);
create index notes_content_trgm_idx  on public.notes using gin (content extensions.gin_trgm_ops);

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- tags (users 1:N tags)
-- -----------------------------------------------------------------------------
create table public.tags (
  id       uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name     text not null check (char_length(btrim(name)) between 1 and 40),
  constraint tags_id_owner_key unique (id, owner_id)
);

create unique index tags_owner_name_key on public.tags (owner_id, lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- note_tags (notes N:M tags)
-- -----------------------------------------------------------------------------
create table public.note_tags (
  note_id uuid not null references public.notes (id) on delete cascade,
  tag_id  uuid not null references public.tags (id) on delete cascade,
  primary key (note_id, tag_id)
);

create index note_tags_tag_idx on public.note_tags (tag_id);

-- Integrity guard (independent of RLS): note and tag must share an owner.
create or replace function private.note_tags_same_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note_owner uuid;
  v_tag_owner  uuid;
begin
  select owner_id into v_note_owner from public.notes where id = new.note_id;
  select owner_id into v_tag_owner  from public.tags  where id = new.tag_id;
  if v_note_owner is null or v_tag_owner is null or v_note_owner <> v_tag_owner then
    raise exception 'note and tag must belong to the same user'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger note_tags_same_owner
  before insert or update on public.note_tags
  for each row execute function private.note_tags_same_owner();

-- -----------------------------------------------------------------------------
-- note_versions (notes 1:N versions) — written only by trusted functions
-- -----------------------------------------------------------------------------
create table public.note_versions (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  title      text not null default '',
  content    text not null default '',
  created_at timestamptz not null default now(),
  constraint note_versions_note_version_key unique (note_id, version_no)
);

create index note_versions_note_idx on public.note_versions (note_id, version_no desc);

-- Insert a snapshot of (title, content) for a note unless it duplicates the
-- latest snapshot. Caller MUST hold a row lock on the note and have verified
-- ownership. Not callable by clients (private schema, no grants).
create or replace function private.insert_note_version(p_note_id uuid, p_title text, p_content text)
returns public.note_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last public.note_versions;
  v_row  public.note_versions;
begin
  select * into v_last
    from public.note_versions
   where note_id = p_note_id
   order by version_no desc
   limit 1;

  if found and v_last.title = p_title and v_last.content = p_content then
    return v_last;
  end if;

  insert into public.note_versions (note_id, version_no, title, content)
  values (p_note_id, coalesce(v_last.version_no, 0) + 1, p_title, p_content)
  returning * into v_row;
  return v_row;
end;
$$;

-- Automatic checkpoints: when title/content change, snapshot the PREVIOUS
-- content if the last checkpoint (or note creation) is >= 10 minutes old.
-- This yields meaningful history without a row per keystroke/autosave.
create or replace function private.notes_auto_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_at timestamptz;
begin
  if new.title is not distinct from old.title and new.content is not distinct from old.content then
    return new;
  end if;
  if old.title = '' and old.content = '' then
    return new;
  end if;

  select max(created_at) into v_last_at from public.note_versions where note_id = old.id;

  if coalesce(v_last_at, old.created_at) <= now() - interval '10 minutes' then
    perform private.insert_note_version(old.id, old.title, old.content);
  end if;
  return new;
end;
$$;

create trigger notes_auto_version
  before update of title, content on public.notes
  for each row execute function private.notes_auto_version();

-- -----------------------------------------------------------------------------
-- New user bootstrap: profile + preferences
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80), '')
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles         enable row level security;
alter table public.user_preferences enable row level security;
alter table public.folders          enable row level security;
alter table public.notes            enable row level security;
alter table public.tags             enable row level security;
alter table public.note_tags        enable row level security;
alter table public.note_versions    enable row level security;

-- profiles ---------------------------------------------------------------------
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- user_preferences ---------------------------------------------------------------
create policy "preferences: read own" on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "preferences: insert own" on public.user_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "preferences: update own" on public.user_preferences
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- folders ------------------------------------------------------------------------
create policy "folders: read own" on public.folders
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "folders: insert own" on public.folders
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "folders: update own" on public.folders
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "folders: delete own" on public.folders
  for delete to authenticated using (owner_id = (select auth.uid()));

-- notes --------------------------------------------------------------------------
create policy "notes: read own" on public.notes
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "notes: insert own" on public.notes
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "notes: update own" on public.notes
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "notes: delete own" on public.notes
  for delete to authenticated using (owner_id = (select auth.uid()));

-- tags ---------------------------------------------------------------------------
create policy "tags: read own" on public.tags
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "tags: insert own" on public.tags
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "tags: update own" on public.tags
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "tags: delete own" on public.tags
  for delete to authenticated using (owner_id = (select auth.uid()));

-- note_tags: both sides must be owned by the caller --------------------------------
create policy "note_tags: read own" on public.note_tags
  for select to authenticated using (
    exists (select 1 from public.notes n where n.id = note_id and n.owner_id = (select auth.uid()))
  );
create policy "note_tags: insert own" on public.note_tags
  for insert to authenticated with check (
    exists (select 1 from public.notes n where n.id = note_id and n.owner_id = (select auth.uid()))
    and exists (select 1 from public.tags t where t.id = tag_id and t.owner_id = (select auth.uid()))
  );
create policy "note_tags: delete own" on public.note_tags
  for delete to authenticated using (
    exists (select 1 from public.notes n where n.id = note_id and n.owner_id = (select auth.uid()))
  );

-- note_versions: read-only for owners ------------------------------------------------
create policy "note_versions: read own" on public.note_versions
  for select to authenticated using (
    exists (select 1 from public.notes n where n.id = note_id and n.owner_id = (select auth.uid()))
  );

-- =============================================================================
-- Privileges (least privilege; column-level where it matters)
-- =============================================================================
revoke all on table
  public.profiles, public.user_preferences, public.folders, public.notes,
  public.tags, public.note_tags, public.note_versions
from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_path) on public.profiles to authenticated;

grant select on public.user_preferences to authenticated;
grant insert (user_id, theme, font_size, autosave_enabled) on public.user_preferences to authenticated;
grant update (theme, font_size, autosave_enabled) on public.user_preferences to authenticated;

grant select, delete on public.folders to authenticated;
grant insert (id, name, created_at) on public.folders to authenticated;
grant update (name) on public.folders to authenticated;

grant select, delete on public.notes to authenticated;
grant insert (id, folder_id, title, content, is_pinned, is_archived, deleted_at, created_at, updated_at)
  on public.notes to authenticated;
grant update (folder_id, title, content, is_pinned, is_archived, deleted_at)
  on public.notes to authenticated;

grant select, delete on public.tags to authenticated;
grant insert (id, name) on public.tags to authenticated;
grant update (name) on public.tags to authenticated;

grant select, delete on public.note_tags to authenticated;
grant insert (note_id, tag_id) on public.note_tags to authenticated;

grant select on public.note_versions to authenticated;

-- =============================================================================
-- RPC functions (exposed through the API)
-- =============================================================================

-- Paginated, filtered, searchable note listing. SECURITY INVOKER: RLS applies.
create or replace function public.list_notes(
  p_view          text    default 'all',      -- all | pinned | recent | archive | trash
  p_search        text    default null,
  p_folder_id     uuid    default null,
  p_uncategorized boolean default false,
  p_tag_id        uuid    default null,
  p_sort          text    default 'updated',  -- updated | created | title
  p_limit         integer default 50,
  p_offset        integer default 0
)
returns table (
  id          uuid,
  folder_id   uuid,
  title       text,
  preview     text,
  is_pinned   boolean,
  is_archived boolean,
  deleted_at  timestamptz,
  created_at  timestamptz,
  updated_at  timestamptz,
  tag_ids     uuid[],
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      case when nullif(btrim(p_search), '') is null then null
           else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as pattern
  )
  select
    n.id, n.folder_id, n.title, left(n.content, 240) as preview,
    n.is_pinned, n.is_archived, n.deleted_at, n.created_at, n.updated_at,
    coalesce(
      (select array_agg(nt.tag_id order by nt.tag_id) from public.note_tags nt where nt.note_id = n.id),
      '{}'::uuid[]
    ) as tag_ids,
    count(*) over () as total_count
  from public.notes n, params p
  where n.owner_id = (select auth.uid())
    and case p_view
          when 'trash'   then n.deleted_at is not null
          when 'archive' then n.deleted_at is null and n.is_archived
          when 'pinned'  then n.deleted_at is null and not n.is_archived and n.is_pinned
          when 'recent'  then n.deleted_at is null and not n.is_archived and n.updated_at >= now() - interval '7 days'
          else                n.deleted_at is null and not n.is_archived
        end
    and (p_folder_id is null or n.folder_id = p_folder_id)
    and (not p_uncategorized or n.folder_id is null)
    and (p_tag_id is null or exists (select 1 from public.note_tags nt where nt.note_id = n.id and nt.tag_id = p_tag_id))
    and (p.pattern is null or n.title ilike p.pattern or n.content ilike p.pattern)
  order by
    case when p_view in ('all', 'recent') and p_sort <> 'title' then n.is_pinned end desc nulls last,
    case when p_sort = 'title'   then lower(n.title) end asc,
    case when p_sort = 'created' then n.created_at end desc,
    case when p_view = 'trash' then n.deleted_at end desc,
    n.updated_at desc,
    n.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Sidebar counts in a single round trip. SECURITY INVOKER: RLS applies.
create or replace function public.sidebar_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'all',           count(*) filter (where deleted_at is null and not is_archived),
    'pinned',        count(*) filter (where deleted_at is null and not is_archived and is_pinned),
    'recent',        count(*) filter (where deleted_at is null and not is_archived and updated_at >= now() - interval '7 days'),
    'archive',       count(*) filter (where deleted_at is null and is_archived),
    'trash',         count(*) filter (where deleted_at is not null),
    'uncategorized', count(*) filter (where deleted_at is null and not is_archived and folder_id is null),
    'folders', coalesce((
      select jsonb_object_agg(f.id, (
        select count(*) from public.notes n2
         where n2.folder_id = f.id and n2.deleted_at is null and not n2.is_archived
      ))
      from public.folders f where f.owner_id = (select auth.uid())
    ), '{}'::jsonb),
    'tags', coalesce((
      select jsonb_object_agg(t.id, (
        select count(*) from public.note_tags nt join public.notes n3 on n3.id = nt.note_id
         where nt.tag_id = t.id and n3.deleted_at is null and not n3.is_archived
      ))
      from public.tags t where t.owner_id = (select auth.uid())
    ), '{}'::jsonb)
  )
  from public.notes
  where owner_id = (select auth.uid());
$$;

-- Manual checkpoint (e.g. Ctrl/Cmd+S). Verifies ownership, locks the note.
create or replace function public.create_note_checkpoint(p_note_id uuid)
returns public.note_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note public.notes;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_note
    from public.notes
   where id = p_note_id and owner_id = (select auth.uid())
   for update;

  if not found then
    raise exception 'note not found' using errcode = 'P0002';
  end if;

  if v_note.title = '' and v_note.content = '' then
    return null;
  end if;

  return private.insert_note_version(v_note.id, v_note.title, v_note.content);
end;
$$;

-- Restore a version. The current content is checkpointed first so restoring
-- is never destructive. Verifies ownership through the parent note.
create or replace function public.restore_note_version(p_version_id uuid)
returns public.notes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.note_versions;
  v_note    public.notes;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select v.* into v_version
    from public.note_versions v
    join public.notes n on n.id = v.note_id
   where v.id = p_version_id and n.owner_id = (select auth.uid());

  if not found then
    raise exception 'version not found' using errcode = 'P0002';
  end if;

  select * into v_note from public.notes where id = v_version.note_id for update;

  if v_note.title <> '' or v_note.content <> '' then
    perform private.insert_note_version(v_note.id, v_note.title, v_note.content);
  end if;

  update public.notes
     set title = v_version.title, content = v_version.content
   where id = v_note.id
  returning * into v_note;

  return v_note;
end;
$$;

revoke all on function public.list_notes(text, text, uuid, boolean, uuid, text, integer, integer) from public, anon;
revoke all on function public.sidebar_counts() from public, anon;
revoke all on function public.create_note_checkpoint(uuid) from public, anon;
revoke all on function public.restore_note_version(uuid) from public, anon;

grant execute on function public.list_notes(text, text, uuid, boolean, uuid, text, integer, integer) to authenticated;
grant execute on function public.sidebar_counts() to authenticated;
grant execute on function public.create_note_checkpoint(uuid) to authenticated;
grant execute on function public.restore_note_version(uuid) to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
