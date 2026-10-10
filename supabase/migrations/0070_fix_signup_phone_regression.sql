-- KiaKia — fixes a regression, found while adding a required phone field to
-- the kiakia-rider sign-up form: `handle_new_auth_user()` has been silently
-- ignoring `raw_user_meta_data->>'phone'` since migration 0014, so
-- `profiles.phone` has been null for every email+password signup (every
-- signup in this project, on both the web app and the rider app) since then.
--
-- WHAT HAPPENED, stated plainly because this is the same class of bug
-- 0050_restore_order_status_transitions.sql's own header calls out by name:
-- "create or replace on a whole function body is not composable."
--
--   0002_identity.sql defined handle_new_auth_user() reading `new.phone`
--   only — correct at the time, when signup was phone-OTP and
--   auth.users.phone was actually populated by Supabase Auth itself.
--
--   0012_signup_phone_from_metadata.sql redefined it to
--   `coalesce(new.phone, new.raw_user_meta_data ->> 'phone')`, because the
--   auth mechanism had switched to email+password, `auth.users.phone` is
--   null for every such signup, and phone became a plain metadata field
--   instead — exactly the shape it is collected in today, both apps.
--
--   0014_fix_user_roles_scope_id.sql redefined the function AGAIN, for a
--   completely unrelated reason (a user_roles primary-key fix requiring a
--   new ON CONFLICT target), and its own header claims "Both functions
--   below are unchanged except for the on-conflict target." That claim is
--   false for this function: the body it substituted was copied from 0002,
--   not from 0012's then-current version, so it silently reverted the
--   phone coalesce — `raw_user_meta_data->>'phone'` has not been read since.
--
-- This migration restores the union: 0012's coalesce fix, and 0014's
-- on-conflict fix, together — the same shape 0050 restored for
-- transition_order(). No data backfill: existing profiles.phone rows stay
-- whatever they were (mostly null); this only fixes it going forward. A
-- backfill would need the raw signup metadata, which is not retained
-- anywhere after this trigger discards it.

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
  on conflict (user_id, role) where (scope_type = 'platform') do nothing;

  return new;
end;
$$;

comment on function handle_new_auth_user() is
  'AFTER INSERT trigger on auth.users: provisions profiles + a default customer role for every new signup. profiles.phone reads new.phone first (populated by phone-OTP signup, which no app in this project currently uses) and falls back to raw_user_meta_data->>''phone'' (populated by email+password signup passing phone via signUp()''s options.data, both the kiakia web app and kiakia-rider). That fallback was correct as of 0012_signup_phone_from_metadata.sql and was silently dropped by 0014_fix_user_roles_scope_id.sql''s own unrelated redefinition — restored here, unioned with 0014''s still-necessary on-conflict target fix for user_roles. See this migration''s own header before touching this function again: read the CURRENT body via \df+ or the latest migration that touches it, never copy from an earlier one from memory.';
