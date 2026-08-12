-- KiaKia — fix: user_roles' composite primary key (0002_identity.sql)
-- includes scope_id, and Postgres implicitly makes every column in a
-- PRIMARY KEY constraint NOT NULL — even though scope_id itself was never
-- declared NOT NULL. scope_id's whole purpose per that migration's own
-- comment is to be absent ("scope_type/scope_id let a role be global
-- (scope_type = 'platform') ... or scoped to one vendor"), so every
-- platform-scoped grant leaves it NULL and violates that implicit
-- constraint. That is not a seed-data problem: handle_new_auth_user()
-- hits it on every real signup, and register_vendor() hits it on every
-- real vendor registration — both insert `(user_id, role)` only, relying
-- on scope_id defaulting to NULL, exactly as 0002 intended.
--
-- Fix: replace scope_id in the primary key with a surrogate id, and
-- express the original "no duplicate role grant" intent as two partial
-- unique indexes instead — one for platform-scoped rows (dedupes on
-- user_id + role only, since scope_id is meaningless there) and one for
-- vendor-scoped rows (dedupes on user_id + role + scope_id). A single
-- non-partial unique index couldn't express this: it wouldn't dedupe
-- platform-scoped NULLs at all (unique constraints treat NULL <> NULL),
-- and would demand a scope_id that vendor-scoped rows don't have.

alter table user_roles drop constraint user_roles_pkey;

-- Dropping a PRIMARY KEY constraint does NOT clear the implicit NOT NULL
-- it stamped onto each key column — that flag lives on the column itself,
-- independent of the constraint that originally caused it, and Postgres
-- leaves it in place. Without this line scope_id is still unable to hold
-- NULL and every platform-scoped insert keeps failing exactly as before.
alter table user_roles alter column scope_id drop not null;

alter table user_roles add column id uuid not null default uuid_generate_v7();
alter table user_roles add primary key (id);

create unique index user_roles_platform_uidx on user_roles (user_id, role) where scope_type = 'platform';
create unique index user_roles_vendor_uidx on user_roles (user_id, role, scope_id) where scope_type = 'vendor';

-- Both functions below are unchanged except for the on-conflict target,
-- which now has to name the partial index it's relying on — neither ever
-- sets scope_type, so both always land in the 'platform' partial index.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone, full_name)
  values (new.id, new.phone, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id, role) where (scope_type = 'platform') do nothing;

  return new;
end;
$$;

create or replace function register_vendor(
  p_name            text,
  p_slug            text,
  p_category        text,
  p_description     text default null,
  p_address_line    text default null,
  p_landmark        text default null,
  p_location        geography(point, 4326) default null,
  p_service_area_id uuid default null
)
returns vendors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor vendors;
begin
  if exists (select 1 from vendor_staff where user_id = auth.uid()) then
    raise exception 'register_vendor: this account already has a vendor — one vendor per account in this release'
      using errcode = 'unique_violation';
  end if;

  insert into vendors (owner_user_id, name, slug, category, description, address_line, landmark, location, service_area_id)
  values (auth.uid(), p_name, p_slug, p_category, p_description, p_address_line, p_landmark, p_location, p_service_area_id)
  returning * into v_vendor;
  -- A duplicate p_slug surfaces as a unique_violation on vendors.slug
  -- (0003_catalog.sql) — the caller maps that to "this store name is taken".

  insert into vendor_staff (vendor_id, user_id, role)
  values (v_vendor.id, auth.uid(), 'vendor_owner');

  insert into user_roles (user_id, role)
  values (auth.uid(), 'vendor_owner')
  on conflict (user_id, role) where (scope_type = 'platform') do nothing;

  return v_vendor;
end;
$$;
