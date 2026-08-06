-- KiaKia — register_vendor(): the customer-app-equivalent of a signup
-- Server Action, except this one has to write three tables atomically
-- (vendors, vendor_staff, user_roles) — writes revoked from `authenticated`
-- on every one of them individually (0007_rls.sql), so this is the single
-- trusted entry point, mirroring why transition_order() bundles its writes.
--
-- The vendor is created `status = 'pending'`, `kyc_status = 'pending'`
-- (both column defaults — see 0003_catalog.sql) and stays that way until
-- someone flips it manually in SQL. There is still no admin console (§22)
-- — this migration does not add one, same boundary Phase 0 already drew.

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
  on conflict do nothing;

  return v_vendor;
end;
$$;

comment on function register_vendor(text, text, text, text, text, text, geography, uuid) is
  'One atomic vendor + vendor_staff + user_roles elevation. Vendor starts pending/pending — no admin console exists yet to approve it (§22).';

revoke execute on function register_vendor(text, text, text, text, text, text, geography, uuid) from public;
grant execute on function register_vendor(text, text, text, text, text, text, geography, uuid) to authenticated;
