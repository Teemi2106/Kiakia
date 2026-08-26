-- KiaKia — Phase 3/4 build-out, part 3/3: the minimal admin surface. Before
-- this migration there was no admin RLS policy anywhere and no path from
-- vendors.status = 'pending' to 'active' except manual SQL
-- (0009_register_vendor.sql's own comment: "There is still no admin console
-- (§22) — this migration does not add one"). This migration adds exactly
-- two RPCs and nothing else — no admin UI belongs in this repo; a
-- separate frontend-dev agent builds the (admin) route group against this
-- contract.
--
-- Both RPCs mirror 0018_fix_transition_order_edge_restrictions.sql's admin
-- branch EXACTLY: restricted to service_role callers
-- (coalesce(auth.role(), current_setting('role', true)) is distinct from
-- 'service_role') with a real admin/superadmin user_roles row for the
-- caller-supplied p_actor_id — admin identity works the same way as every
-- other privileged actor_type in this codebase: service-role-fronted, with
-- the actor's admin-ness verified by a real row, never just trusted from
-- the argument alone. This means these RPCs need a p_actor_id parameter,
-- same reasoning as transition_order()'s own admin branch.
--
-- Never grant to `authenticated` — these must be called from a Server
-- Action using the service-role admin client, after that Server Action's
-- own DAL check (a requireAdminContext()-equivalent — see this migration's
-- footer note for exactly what the frontend-dev agent needs to build)
-- verifies the caller holds admin/superadmin. Same shape as
-- updateVendorSettingsAction (app/actions/vendor.ts) already uses for
-- vendor-settings writes where RLS revokes the column-level write from
-- `authenticated` entirely.

create or replace function approve_vendor(p_vendor_id uuid, p_actor_id uuid)
returns vendors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor       vendors;
  -- Same NULL-safe role check as 0018's admin/system branches — auth.role()
  -- returns NULL for a direct (non-PostgREST) service-role session, and
  -- comparing NULL <> 'service_role' would fail open; current_setting is the
  -- non-null fallback, `is distinct from` treats NULL as a real mismatch.
  v_caller_role  text := coalesce(auth.role(), current_setting('role', true));
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'approve_vendor: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'approve_vendor: actor % is not an admin', p_actor_id;
  end if;

  update vendors set status = 'active' where id = p_vendor_id
  returning * into v_vendor;

  if not found then
    raise exception 'approve_vendor: vendor % does not exist', p_vendor_id
      using errcode = 'no_data_found';
  end if;

  return v_vendor;
end;
$$;

comment on function approve_vendor(uuid, uuid) is
  'Sets vendors.status = ''active''. service_role callers only, with a real admin/superadmin user_roles row for p_actor_id — mirrors transition_order()''s admin branch (0018_fix_transition_order_edge_restrictions.sql). Never grant to authenticated.';

revoke execute on function approve_vendor(uuid, uuid) from public, authenticated;
grant execute on function approve_vendor(uuid, uuid) to service_role;

create or replace function reject_vendor(p_vendor_id uuid, p_actor_id uuid)
returns vendors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor       vendors;
  v_caller_role  text := coalesce(auth.role(), current_setting('role', true));
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'reject_vendor: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'reject_vendor: actor % is not an admin', p_actor_id;
  end if;

  -- vendors.status has no 'rejected' value — its check constraint
  -- (0003_catalog.sql) only allows 'pending' | 'active' | 'suspended'.
  -- 'suspended' is the correct terminal non-active state here, not an
  -- invented value.
  update vendors set status = 'suspended' where id = p_vendor_id
  returning * into v_vendor;

  if not found then
    raise exception 'reject_vendor: vendor % does not exist', p_vendor_id
      using errcode = 'no_data_found';
  end if;

  return v_vendor;
end;
$$;

comment on function reject_vendor(uuid, uuid) is
  'Sets vendors.status = ''suspended'' (the only non-active terminal value the column''s check constraint allows — there is no ''rejected'' value). service_role callers only, with a real admin/superadmin user_roles row for p_actor_id. Never grant to authenticated.';

revoke execute on function reject_vendor(uuid, uuid) from public, authenticated;
grant execute on function reject_vendor(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Frontend-dev note: apps/web/src/lib/auth/dal.ts already has a
-- requireAdminContext() (ADMIN_ROLES = ["admin", "superadmin"], same
-- redirect-if-absent shape as requireRole()/requireVendorContext()) and
-- app/actions/admin.ts already calls approve_vendor/reject_vendor exactly
-- as this migration defines them (p_vendor_id, p_actor_id: session.userId)
-- via createAdminClient() — a parallel frontend-dev pass built against this
-- contract ahead of this migration landing. Nothing further needed on the
-- TypeScript side for these two RPCs; packages/db/src/generated.ts is
-- updated in this same round to match (Args/Returns for both functions,
-- plus dispatch_offers and the two Phase 3 RPCs from
-- 0019_rider_dispatch.sql / 0020_verify_delivery_and_release_escrow.sql).
-- ---------------------------------------------------------------------------
