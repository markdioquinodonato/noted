-- Additive upgrade: existing notes and content are preserved. Apply after the initial schema.
alter table public.notes add column if not exists is_favorite boolean not null default false;
alter table public.notes add column if not exists color text not null default 'default' check (color in ('default','rose','amber','sage','sky','violet'));
alter table public.notes add column if not exists reminder_at timestamptz;
alter table public.notes add column if not exists reminder_completed_at timestamptz;
alter table public.folders add column if not exists color text not null default 'default' check (color in ('default','rose','amber','sage','sky','violet'));
alter table public.folders add column if not exists icon text not null default 'folder' check (icon in ('folder','home','school','briefcase','book','heart'));
grant insert (is_favorite, color, reminder_at, reminder_completed_at), update (is_favorite, color, reminder_at, reminder_completed_at) on public.notes to authenticated;
grant insert (color, icon), update (color, icon) on public.folders to authenticated;
create index if not exists notes_reminder_idx on public.notes(owner_id, reminder_at) where deleted_at is null and reminder_completed_at is null;
create index if not exists notes_favorite_idx on public.notes(owner_id, updated_at desc) where is_favorite and deleted_at is null;

create table if not exists public.note_shares (
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check(permission in ('read','edit')),
  created_at timestamptz not null default now(),
  primary key(note_id, user_id)
);
create index if not exists note_shares_user_idx on public.note_shares(user_id, note_id);
alter table public.note_shares enable row level security;
revoke all on public.note_shares from public, anon, authenticated;
grant select, delete on public.note_shares to authenticated;
-- Security definer helper avoids RLS recursion and reveals only a boolean for the caller.
create or replace function public.has_note_access(p_note_id uuid, p_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.notes n where n.id=p_note_id and
    (n.owner_id=(select auth.uid()) or (n.deleted_at is null and exists(
      select 1 from public.note_shares s where s.note_id=n.id and s.user_id=(select auth.uid()) and (not p_edit or s.permission='edit')))));
$$;
create policy "shares: participants read" on public.note_shares for select to authenticated using
  (user_id=(select auth.uid()) or exists(select 1 from public.notes n where n.id=note_id and n.owner_id=(select auth.uid())));
create policy "shares: owner revoke" on public.note_shares for delete to authenticated using
  (exists(select 1 from public.notes n where n.id=note_id and n.owner_id=(select auth.uid())));
create policy "notes: shared read" on public.notes for select to authenticated using (public.has_note_access(id));

create or replace function public.share_note(p_note_id uuid, p_email text, p_permission text)
returns void language plpgsql security definer set search_path = '' as $$
declare recipient uuid;
begin
  perform 1 from public.notes where id=p_note_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then raise exception 'not allowed' using errcode='42501'; end if;
  if p_permission not in ('read','edit') then raise exception 'invalid permission' using errcode='23514'; end if;
  select id into recipient from auth.users where lower(email)=lower(btrim(p_email));
  if recipient is null or recipient=(select auth.uid()) then raise exception 'recipient unavailable' using errcode='P0002'; end if;
  insert into public.note_shares(note_id,user_id,permission) values(p_note_id,recipient,p_permission)
    on conflict(note_id,user_id) do update set permission=excluded.permission;
end; $$;

create or replace function public.update_shared_note(p_note_id uuid, p_title text, p_content text, p_expected timestamptz)
returns setof public.notes language plpgsql security definer set search_path = '' as $$
begin
  -- Lock first, then recheck authorization and revision. Concurrent editors never silently overwrite.
  perform 1 from public.notes where id=p_note_id for update;
  if not public.has_note_access(p_note_id,true) then raise exception 'not allowed' using errcode='42501'; end if;
  return query update public.notes set title=p_title, content=p_content
    where id=p_note_id and updated_at=p_expected and deleted_at is null returning *;
end; $$;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 255),
  mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','audio/webm','audio/ogg','audio/mp4','audio/wav')),
  size integer not null check(size between 1 and 10485760),
  path text not null unique,
  created_at timestamptz not null default now(),
  check(path=owner_id::text || '/' || note_id::text || '/' || id::text)
);
create index if not exists attachments_note_idx on public.attachments(note_id);
alter table public.attachments enable row level security;
revoke all on public.attachments from public, anon, authenticated;
grant select, delete on public.attachments to authenticated;
grant insert (id,note_id,name,mime_type,size,path) on public.attachments to authenticated;
create policy "attachments: owner read" on public.attachments for select to authenticated using(owner_id=(select auth.uid()));
create policy "attachments: owner insert" on public.attachments for insert to authenticated with check(owner_id=(select auth.uid()) and exists(select 1 from public.notes n where n.id=note_id and n.owner_id=(select auth.uid()) and n.deleted_at is null));
create policy "attachments: owner delete" on public.attachments for delete to authenticated using(owner_id=(select auth.uid()));

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  scheduled_at timestamptz not null,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(owner_id,note_id,scheduled_at)
);
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant insert (note_id,scheduled_at), update(dismissed) on public.notifications to authenticated;
create policy "notifications: own read" on public.notifications for select to authenticated using(owner_id=(select auth.uid()));
create policy "notifications: own insert" on public.notifications for insert to authenticated with check(owner_id=(select auth.uid()) and exists(select 1 from public.notes n where n.id=note_id and n.owner_id=(select auth.uid()) and n.reminder_at=scheduled_at and n.deleted_at is null));
create policy "notifications: own update" on public.notifications for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));

-- Computed search text supports both legacy plain text and structured editor documents.
create or replace function public.note_plain_text(value text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if left(value,14)=E'NOTED_RICH_V1\n' then
    return coalesce((substring(value from 15)::jsonb)->>'text',value);
  end if;
  return value;
exception when others then return value;
end; $$;
create index if not exists notes_plain_trgm_idx on public.notes using gin(public.note_plain_text(content) extensions.gin_trgm_ops);
create or replace function public.list_notes_v2(
  p_view          text    default 'all',      -- all | pinned | recent | archive | trash
  p_search        text    default null,
  p_folder_id     uuid    default null,
  p_uncategorized boolean default false,
  p_tag_id        uuid    default null,
  p_sort          text    default 'updated',  -- updated | created | title
  p_limit         integer default 50,
  p_offset        integer default 0,
  p_created_after timestamptz default null,
  p_updated_after timestamptz default null
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
  is_favorite boolean,
  color text,
  reminder_at timestamptz,
  reminder_completed_at timestamptz,
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
    n.id, n.folder_id, n.title, left(public.note_plain_text(n.content), 240) as preview,
    n.is_pinned, n.is_archived, n.deleted_at, n.created_at, n.updated_at,
    coalesce(
      (select array_agg(nt.tag_id order by nt.tag_id) from public.note_tags nt where nt.note_id = n.id),
      '{}'::uuid[]
    ) as tag_ids,
    n.is_favorite, n.color, n.reminder_at, n.reminder_completed_at,
    count(*) over () as total_count
  from public.notes n, params p
  where (case when p_view='shared' then n.owner_id<>(select auth.uid()) else n.owner_id=(select auth.uid()) end)
    and case p_view
          when 'favorites' then n.deleted_at is null and not n.is_archived and n.is_favorite
          when 'reminders' then n.deleted_at is null and n.reminder_at is not null and n.reminder_completed_at is null
          when 'trash'   then n.deleted_at is not null
          when 'archive' then n.deleted_at is null and n.is_archived
          when 'pinned'  then n.deleted_at is null and not n.is_archived and n.is_pinned
          when 'recent'  then n.deleted_at is null and not n.is_archived and n.updated_at >= now() - interval '7 days'
          else                n.deleted_at is null and not n.is_archived
        end
    and (p_folder_id is null or n.folder_id = p_folder_id)
    and (not p_uncategorized or n.folder_id is null)
    and (p_tag_id is null or exists (select 1 from public.note_tags nt where nt.note_id = n.id and nt.tag_id = p_tag_id))
    and (p_created_after is null or n.created_at >= p_created_after)
    and (p_updated_after is null or n.updated_at >= p_updated_after)
    and (p.pattern is null or n.title ilike p.pattern or public.note_plain_text(n.content) ilike p.pattern
      or exists(select 1 from public.folders f where f.id=n.folder_id and f.name ilike p.pattern)
      or exists(select 1 from public.note_tags nt join public.tags t on t.id=nt.tag_id where nt.note_id=n.id and t.name ilike p.pattern))
  order by
    case when p_view='reminders' then n.reminder_at end asc,
    case when p_view in ('all', 'recent') and p_sort <> 'title' then n.is_pinned end desc nulls last,
    case when p_sort = 'title'   then lower(n.title) end asc,
    case when p_sort = 'created' then n.created_at end desc,
    case when p_view = 'trash' then n.deleted_at end desc,
    n.updated_at desc,
    n.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.sidebar_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'favorites', count(*) filter (where deleted_at is null and not is_archived and is_favorite),
    'reminders', count(*) filter (where deleted_at is null and reminder_at is not null and reminder_completed_at is null),
    'shared', (select count(*) from public.notes sn where sn.owner_id<>(select auth.uid()) and sn.deleted_at is null),
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


revoke all on function public.has_note_access(uuid,boolean), public.share_note(uuid,text,text), public.update_shared_note(uuid,text,text,timestamptz), public.list_notes_v2(text,text,uuid,boolean,uuid,text,integer,integer,timestamptz,timestamptz), public.note_plain_text(text) from public, anon;
grant execute on function public.has_note_access(uuid,boolean), public.share_note(uuid,text,text), public.update_shared_note(uuid,text,text,timestamptz), public.list_notes_v2(text,text,uuid,boolean,uuid,text,integer,integer,timestamptz,timestamptz), public.note_plain_text(text) to authenticated;
