-- Welcome email is sent after signup is complete:
--   * Google accounts are confirmed when auth.users is inserted.
--   * Email/password accounts become confirmed after the verification code.
-- The existing queue helper in 0119 writes to the transactional outbox and
-- deduplicates by user id, so retries cannot send a second welcome message.

create or replace function queue_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  )), '');
begin
  -- On UPDATE, only queue when the address changes from unconfirmed to
  -- confirmed. On INSERT, only Google/provider signups are normally confirmed.
  if new.email_confirmed_at is null
     or (tg_op = 'UPDATE' and old.email_confirmed_at is not null) then
    return new;
  end if;

  perform _queue_transactional_email(
    new.id,
    'Welcome to KiaKia',
    format(
      'Hi %s, welcome to KiaKia. Your account is ready. Sign in to browse local restaurants and place your first order.',
      coalesce(v_name, 'there')
    ),
    'welcome:' || new.id::text
  );
  return new;
exception when others then
  -- Email is best-effort and must never prevent an account from being created
  -- or confirmed. The outbox helper logs provider delivery separately.
  raise warning 'queue_welcome_email: user % - %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists auth_user_queue_welcome_email on auth.users;
create trigger auth_user_queue_welcome_email
  after insert or update of email_confirmed_at on auth.users
  for each row execute function queue_welcome_email();

comment on function queue_welcome_email() is
  'Queues one transactional welcome email once a new account is confirmed, through the Resend-backed message outbox.';
