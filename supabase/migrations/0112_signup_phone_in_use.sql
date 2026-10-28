-- KiaKia - 0112: lets the sign-up actions ask whether a phone number already
-- belongs to a profile before calling auth.signUp().
--
-- profiles.phone is unique (profiles_phone_key) and, since 0070, is filled at
-- signup from the metadata phone. When that number is already taken the
-- handle_new_auth_user() trigger raises 23505, the whole signup rolls back and
-- Supabase Auth answers with an empty 500 - the form could only say "We
-- couldn't create your account". The Server Action now asks this function
-- first and shows a real message instead.
--
-- service_role only: the web app calls it through the admin client, so anon
-- cannot use it to enumerate which numbers are registered. The trigger keeps
-- the unique constraint as the actual authority; this is only for the message.

create or replace function phone_in_use(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where phone = p_phone);
$$;

revoke all on function phone_in_use(text) from public, anon, authenticated;
grant execute on function phone_in_use(text) to service_role;

comment on function phone_in_use(text) is
  'True when profiles.phone already holds this E.164 number. service_role only (called by the register Server Actions through the admin client) so it cannot be used to enumerate registered numbers from the browser.';
