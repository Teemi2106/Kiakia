-- KiaKia — vendors go live immediately on registration.
--
-- Product decision (2026-08-27): the pending/approve queue added no real
-- screening — 0021_admin_vendor_approval.sql's approve_vendor()/reject_vendor()
-- never checked any document, KYC provider, or business record; it was a
-- manual status flip an admin could do sight-unseen. Gating a vendor's
-- ability to receive orders behind that added onboarding friction without
-- adding trust. Fraud/quality control moves from "gate before" to "police
-- after": reject_vendor() (suspend) and the flagged-orders admin view
-- (0017_fix_capture_payment_amount_mismatch.sql's amount_mismatch/
-- duplicate_capture_attempt flags) both still exist and are the intended
-- lever now, same as how a rejected order is handled after the fact rather
-- than pre-screened.
--
-- register_vendor() (0009_register_vendor.sql) relied on vendors.status's
-- column default ('pending', 0003_catalog.sql) rather than setting it
-- explicitly. This redefinition sets status = 'active' explicitly instead
-- of touching the column default, so any other future insert path into
-- vendors still defaults to the conservative 'pending' unless it
-- deliberately opts in, the same way register_vendor() now does.
--
-- kyc_status is left untouched (stays 'pending' on insert) — nothing in
-- the schema currently gates on vendors.kyc_status (only riders.kyc_status
-- is checked, by dispatch — see 0023_rider_dispatch_kyc_hardening.sql), so
-- there's no gate to remove there; it's just an unused column today.
--
-- The admin approve/reject queue at (admin)/admin/vendors is left in place
-- unchanged — it becomes a manual re-review tool for the rare case a
-- vendor is moved back to 'pending' by hand, not the default path.

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

  insert into vendors (owner_user_id, name, slug, category, description, address_line, landmark, location, service_area_id, status)
  values (auth.uid(), p_name, p_slug, p_category, p_description, p_address_line, p_landmark, p_location, p_service_area_id, 'active')
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
  'One atomic vendor + vendor_staff + user_roles elevation. Vendor starts active immediately (2026-08-27 product decision) — reject_vendor()/the flagged-orders admin view are the post-hoc levers, not a pre-approval gate.';

revoke execute on function register_vendor(text, text, text, text, text, text, geography, uuid) from public;
grant execute on function register_vendor(text, text, text, text, text, text, geography, uuid) to authenticated;

-- One-time backfill: activate any vendor already stuck in 'pending' under
-- the old gate. Does not touch anything already 'suspended' — that's a
-- deliberate admin action (reject_vendor()), not the default this migration
-- is retiring.
update vendors set status = 'active' where status = 'pending';
