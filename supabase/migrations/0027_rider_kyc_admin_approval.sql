-- KiaKia — rider KYC admin approval. Before this migration there was no
-- path from riders.kyc_status = 'pending' (the column default,
-- 0002_identity.sql) to 'approved' except manual SQL — same gap
-- 0021_admin_vendor_approval.sql closed for vendors.status. Modelled
-- directly on 0021's approve_vendor()/reject_vendor(): identical
-- service-role-only + real-admin-actor authorization predicate, reused
-- verbatim rather than inventing a second, different admin check. No admin
-- UI belongs in this repo — a separate frontend-dev agent builds the
-- (admin) route group against this contract, same footer-note convention
-- 0021 used.
--
-- Unlike vendors.status (no 'rejected' value, 0021 has to reuse
-- 'suspended'), riders.kyc_status's own check constraint already includes
-- 'rejected' (0002_identity.sql), so reject_rider() sets exactly that —
-- no awkward reuse of an unrelated value needed here.
--
-- Neither function forces riders.is_online back to false on rejection.
-- Considered and rejected as unnecessary: dispatch_order_to_nearby_riders()
-- (0023) and accept_dispatch_offer() (0023) both independently re-check
-- kyc_status = 'approved' on every call, so a rejected-but-still-online
-- rider can neither receive a new offer nor accept one — forcing
-- is_online = false here would be redundant defense with no additional
-- protection, not a gap.

create or replace function approve_rider(p_rider_id uuid, p_actor_id uuid)
returns riders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider        riders;
  -- Same NULL-safe role check as 0018/0021's admin branches — auth.role()
  -- returns NULL for a direct (non-PostgREST) service-role session, and
  -- comparing NULL <> 'service_role' would fail open; current_setting is the
  -- non-null fallback, `is distinct from` treats NULL as a real mismatch.
  v_caller_role  text := coalesce(auth.role(), current_setting('role', true));
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'approve_rider: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'approve_rider: actor % is not an admin', p_actor_id;
  end if;

  update riders set kyc_status = 'approved' where user_id = p_rider_id
  returning * into v_rider;

  if not found then
    raise exception 'approve_rider: rider % does not exist', p_rider_id
      using errcode = 'no_data_found';
  end if;

  return v_rider;
end;
$$;

comment on function approve_rider(uuid, uuid) is
  'Sets riders.kyc_status = ''approved''. service_role callers only, with a real admin/superadmin user_roles row for p_actor_id — mirrors approve_vendor() (0021_admin_vendor_approval.sql), which itself mirrors transition_order()''s admin branch (0018). Never grant to authenticated.';

revoke execute on function approve_rider(uuid, uuid) from public, authenticated;
grant execute on function approve_rider(uuid, uuid) to service_role;

create or replace function reject_rider(p_rider_id uuid, p_actor_id uuid)
returns riders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider        riders;
  v_caller_role  text := coalesce(auth.role(), current_setting('role', true));
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'reject_rider: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'reject_rider: actor % is not an admin', p_actor_id;
  end if;

  update riders set kyc_status = 'rejected' where user_id = p_rider_id
  returning * into v_rider;

  if not found then
    raise exception 'reject_rider: rider % does not exist', p_rider_id
      using errcode = 'no_data_found';
  end if;

  return v_rider;
end;
$$;

comment on function reject_rider(uuid, uuid) is
  'Sets riders.kyc_status = ''rejected'' (a real value on this column''s check constraint, unlike vendors.status which has no ''rejected'' and has to reuse ''suspended'' in reject_vendor()). service_role callers only, with a real admin/superadmin user_roles row for p_actor_id. Never grant to authenticated.';

revoke execute on function reject_rider(uuid, uuid) from public, authenticated;
grant execute on function reject_rider(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Frontend-dev note: same shape as 0021_admin_vendor_approval.sql's own
-- footer note — an admin Server Action should call these via
-- createAdminClient() (lib/supabase/admin.ts), after requireAdminContext()
-- (apps/web/src/lib/auth/dal.ts) verifies the caller holds admin/superadmin,
-- passing (p_rider_id, p_actor_id: session.userId). Nothing further needed
-- on the TypeScript side for these two RPCs beyond what this same round
-- adds to packages/db/src/generated.ts.
-- ---------------------------------------------------------------------------
