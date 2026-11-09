-- =============================================================================
-- Noted accounts are restricted to Gmail addresses (@gmail.com).
--
-- The web app validates this as the user types, but client checks can be
-- bypassed by calling the Auth API directly, so the rule is enforced here on
-- auth.users: sign-ups and email changes to any other domain are rejected.
-- Rows without an email (e.g. phone or anonymous sign-ins) are not affected.
--
-- SECURITY DEFINER (like private.handle_new_user) so the trigger works when it
-- is fired by the Auth service role, which has no access to schema `private`.
-- =============================================================================

create or replace function private.enforce_gmail_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pattern constant text := '^[a-z0-9]([a-z0-9.+]{0,62}[a-z0-9])?@gmail\.com$';
begin
  if nullif(btrim(new.email), '') is not null
     and (lower(btrim(new.email)) !~ v_pattern or position('..' in new.email) > 0) then
    raise exception 'Only Gmail addresses (@gmail.com) can be used for Noted accounts.'
      using errcode = '22023';
  end if;
  -- Pending email change (copied into `email` after confirmation).
  if tg_op = 'UPDATE'
     and nullif(btrim(new.email_change), '') is not null
     and (lower(btrim(new.email_change)) !~ v_pattern or position('..' in new.email_change) > 0) then
    raise exception 'Only Gmail addresses (@gmail.com) can be used for Noted accounts.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_gmail_only on auth.users;
create trigger enforce_gmail_only
  before insert or update of email, email_change on auth.users
  for each row execute function private.enforce_gmail_only();

revoke all on function private.enforce_gmail_only() from public, anon, authenticated;
