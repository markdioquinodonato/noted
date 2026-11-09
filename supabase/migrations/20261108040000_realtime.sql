-- Supabase environments have this publication; embedded PostgreSQL tests do not.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notes') then
    alter publication supabase_realtime add table public.notes;
  end if;
end; $$;
