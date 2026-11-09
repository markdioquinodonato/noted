-- Supabase Storage is optional in local SQL harnesses; this migration requires it.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('note-attachments', 'note-attachments', false, 10485760,
  array['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','audio/webm','audio/ogg','audio/mp4','audio/wav'])
on conflict(id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create policy "noted: private downloads" on storage.objects for select to authenticated
using(bucket_id='note-attachments' and exists(select 1 from public.attachments a where a.path=storage.objects.name and a.owner_id=(select auth.uid())));
create policy "noted: owned uploads" on storage.objects for insert to authenticated
with check(bucket_id='note-attachments' and exists(select 1 from public.attachments a join public.notes n on n.id=a.note_id
  where a.path=storage.objects.name and a.owner_id=(select auth.uid()) and n.owner_id=(select auth.uid()) and n.deleted_at is null));
create policy "noted: owned removals" on storage.objects for delete to authenticated
using(bucket_id='note-attachments' and split_part(name,'/',1)=(select auth.uid())::text);
