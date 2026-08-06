-- KiaKia — the switch from phone-OTP to email+password auth means
-- `auth.users.phone` is null for every signup now (phone is collected as
-- a plain form field, passed through `signUp()`'s `options.data`, landing
-- in `raw_user_meta_data`, not the dedicated phone-auth column). Re-defines
-- handle_new_auth_user() (0002_identity.sql) to fall back to that metadata
-- field so profiles.phone still gets populated.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone, full_name)
  values (
    new.id,
    coalesce(new.phone, new.raw_user_meta_data ->> 'phone'),
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict do nothing;

  return new;
end;
$$;
