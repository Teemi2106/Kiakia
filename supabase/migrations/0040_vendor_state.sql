-- vendors.state — free-typed text, same idiom as addresses.state
-- (0002_identity.sql), not derived from geocoding (this repo deliberately
-- avoids a second Mapbox Geocoding API surface — see AddressSection.tsx's
-- comment on location capture). Needed so the customer-facing vendor
-- listing (home/page.tsx) can exclude vendors outside the customer's own
-- state entirely and order the rest by distance, per product decision.
-- Nullable: existing vendors (registered before this column existed) have
-- no value until backfilled via the settings form below.
alter table vendors add column state text;

-- register_vendor() gains p_state as a new trailing default-null parameter.
-- Postgres identifies functions by name + argument-type list, so appending
-- a parameter is a NEW overload as far as `create or replace function` is
-- concerned, not a replacement of the old one — left in place, the old
-- 8-arg version would coexist and PostgREST's named-argument RPC calls
-- could end up ambiguous between the two. Drop the old signature first,
-- then create the 9-arg one. Collected on the onboarding form the same way
-- address_line/landmark already are.
drop function if exists register_vendor(text, text, text, text, text, text, geography, uuid);

create or replace function register_vendor(
  p_name            text,
  p_slug            text,
  p_category        text,
  p_description     text default null,
  p_address_line    text default null,
  p_landmark        text default null,
  p_location        geography(point, 4326) default null,
  p_service_area_id uuid default null,
  p_state           text default null
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

  insert into vendors (owner_user_id, name, slug, category, description, address_line, landmark, location, service_area_id, state)
  values (auth.uid(), p_name, p_slug, p_category, p_description, p_address_line, p_landmark, p_location, p_service_area_id, p_state)
  returning * into v_vendor;
  -- A duplicate p_slug surfaces as a unique_violation on vendors.slug
  -- (0003_catalog.sql) — the caller maps that to "this store name is taken".

  insert into vendor_staff (vendor_id, user_id, role)
  values (v_vendor.id, auth.uid(), 'vendor_owner');

  insert into user_roles (user_id, role)
  values (auth.uid(), 'vendor_owner')
  on conflict do nothing;

  return v_vendor;
end;
$$;

comment on function register_vendor(text, text, text, text, text, text, geography, uuid, text) is
  'One atomic vendor + vendor_staff + user_roles elevation. Vendor starts pending/pending — no admin console exists yet to approve it (§22).';

revoke execute on function register_vendor(text, text, text, text, text, text, geography, uuid, text) from public;
grant execute on function register_vendor(text, text, text, text, text, text, geography, uuid, text) to authenticated;
