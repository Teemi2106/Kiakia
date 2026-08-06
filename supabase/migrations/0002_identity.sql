-- KiaKia — Phase 0 foundation migration 2/7.
-- Identity: profiles (keyed off Supabase auth.users per §9), role
-- assignments, customer addresses, and a minimal rider identity table.
--
-- Note on `riders`: the rider *application* (Capacitor/dispatch/KYC review
-- UI) is explicitly out of scope for this foundation (Phase 3 of the
-- roadmap). This table exists only because `orders.rider_id` needs a
-- referential target and the "assigned rider reads their one order" RLS
-- policy in §5 needs a role to check against — it is intentionally minimal
-- and will grow KYC/vehicle/payout columns when Phase 3 starts.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Generic BEFORE UPDATE trigger that stamps updated_at = now(). Attached per-table below.';

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  phone        text unique,
  full_name    text,
  avatar_url   text,
  status       text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table profiles is 'One row per Supabase auth user. §9.';

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- user_roles — role bundles per §13 ("Permission model").
-- scope_type/scope_id let a role be global (scope_type = 'platform') or
-- scoped to one vendor/rider record, e.g. vendor_staff roles are also
-- mirrored here for a single source of truth for "what can this JWT do".
-- ---------------------------------------------------------------------------

create table user_roles (
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in (
                'customer', 'vendor_staff', 'vendor_manager', 'vendor_owner',
                'rider', 'support', 'finance', 'admin', 'superadmin'
              )),
  scope_type  text not null default 'platform' check (scope_type in ('platform', 'vendor')),
  scope_id    uuid,
  created_at  timestamptz not null default now(),
  primary key (user_id, role, scope_type, scope_id)
);

comment on table user_roles is
  'Role bundles per §13. JWT custom claim is populated from this table by an auth hook (Phase 0 exit criteria — hook wiring happens once a live Supabase project exists).';

create index user_roles_user_id_idx on user_roles (user_id);

-- ---------------------------------------------------------------------------
-- addresses
-- ---------------------------------------------------------------------------

create table addresses (
  id           uuid primary key default uuid_generate_v7(),
  customer_id  uuid not null references auth.users (id) on delete cascade,
  label        text,
  line1        text not null,
  landmark     text,
  city         text not null default 'Abuja',
  state        text not null default 'FCT',
  location     geography(point, 4326) not null,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);

comment on table addresses is
  'Landmark is first-class per §14 ("Landmark is a first-class field and often more useful than a street line").';

create index addresses_customer_id_idx on addresses (customer_id);
create index addresses_location_idx on addresses using gist (location);

-- Only one default address per customer.
create unique index addresses_one_default_per_customer
  on addresses (customer_id)
  where is_default;

-- ---------------------------------------------------------------------------
-- riders (minimal — see file header)
-- ---------------------------------------------------------------------------

create table riders (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  vehicle_type      text,
  plate_number      text,
  kyc_status        text not null default 'pending' check (kyc_status in ('pending', 'approved', 'rejected')),
  is_online         boolean not null default false,
  current_location  geography(point, 4326),
  last_ping_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table riders is
  'Minimal rider identity so orders.rider_id has a referential target. Full KYC/vehicle/payout schema is Phase 3 (§21) — not built here.';

create trigger riders_set_updated_at
  before update on riders
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-provision profiles + a default 'customer' role on signup.
--
-- INSERT on profiles is revoked from `authenticated` in 0007_rls.sql — the
-- client never creates its own profile row, this trigger does, the instant
-- Supabase Auth creates the underlying auth.users row. Becoming vendor
-- staff or a rider is a separate elevation (vendor onboarding + admin
-- approval, or rider KYC — both out of this foundation's scope) layered on
-- top of the default customer role, per §13.
-- ---------------------------------------------------------------------------

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
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
