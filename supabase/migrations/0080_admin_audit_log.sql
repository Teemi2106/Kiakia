-- KiaKia - admin audit trail, and every existing admin RPC moved onto it.
--
-- Until now an admin action left no record of who did it or why: approve_vendor,
-- refund_order_escrow and friends each carried their own copy of the
-- "service role + real admin row" predicate and wrote nothing. The admin
-- dashboard multiplies the number of privileged writes, so this migration puts
-- the two things every one of them needs in exactly one place:
--
--   _assert_admin_actor()   who is allowed to act
--   _write_admin_audit()    what they did, written in the SAME transaction
--
-- AUDIT TABLE. Append-only is enforced structurally, not by convention: RLS is
-- on with no policies, anon/authenticated hold no privilege, service_role may
-- only SELECT, and a trigger rejects UPDATE/DELETE/TRUNCATE for every role
-- (including the table owner) so a compromised service key cannot rewrite
-- history either. The only writer is _write_admin_audit(), reachable solely
-- from SECURITY DEFINER callers. actor_id references auth.users WITHOUT
-- cascade on purpose: deleting an auth user who has acted as an admin fails
-- rather than erasing the trail.
--
-- ACTOR CHECK. Same NULL-safe service-role test as 0018/0021 (auth.role() is
-- NULL for a direct service-role session, so `is distinct from`). Two
-- tightenings over the copies it replaces: the role row must be platform-scoped,
-- and the actor's profile must be 'active' - a suspended admin can no longer act
-- even though their user_roles row still exists. The "requires the service-role
-- key" / "is not an admin" messages and their default SQLSTATE are unchanged so
-- supabase/tests/refund_and_escrow_unwind.sql keeps passing; the two new
-- failures (inactive actor, superadmin required, finance required) use
-- insufficient_privilege. The required level is one argument - 'admin'
-- (default), 'finance' (a superadmin, or an admin who also holds the 'finance'
-- role; for changes that shape money) or 'superadmin' - so every tier is
-- decided in this one function.
--
-- RETROFIT. Each function below reproduces its LATEST definition (0021, 0027,
-- 0045 for refund_order_escrow, 0031, 0052 - confirmed by grepping every later
-- migration; 0075's mentions are comments only) with the inline authorization
-- block replaced by the helper and an audit row added. Functions that gain a
-- trailing `p_reason text default null` are dropped first and re-granted: a
-- defaulted extra parameter beside the old signature would make two-argument
-- calls ambiguous (see 0040's header). Existing two-argument callers still
-- resolve to the new function through the default.

-- ---------------------------------------------------------------------------
-- admin_audit_log
-- ---------------------------------------------------------------------------

create table admin_audit_log (
  id           uuid primary key default uuid_generate_v7(),
  actor_id     uuid not null references auth.users (id),
  action       text not null check (char_length(action) between 3 and 80),
  target_type  text not null check (target_type in ('user', 'vendor', 'rider', 'rider_document', 'order', 'service_area')),
  target_id    uuid not null,
  reason       text check (char_length(reason) between 1 and 1000),
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table admin_audit_log is
  'Append-only record of every privileged admin action, written by the same SECURITY DEFINER function, in the same transaction, as the change it describes. details holds before/after snapshots. For payouts target_type/target_id is the paid vendor or rider and details.transaction_id points at the ledger transaction.';

create index admin_audit_log_created_at_idx on admin_audit_log (created_at desc);
create index admin_audit_log_target_idx on admin_audit_log (target_type, target_id, created_at desc);
create index admin_audit_log_actor_idx on admin_audit_log (actor_id, created_at desc);

alter table admin_audit_log enable row level security;

revoke all on admin_audit_log from public, anon, authenticated, service_role;
grant select on admin_audit_log to service_role;

create function admin_audit_log_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_log is append-only (% rejected)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger admin_audit_log_no_update_delete
  before update or delete on admin_audit_log
  for each row execute function admin_audit_log_reject_mutation();

create trigger admin_audit_log_no_truncate
  before truncate on admin_audit_log
  for each statement execute function admin_audit_log_reject_mutation();

-- ---------------------------------------------------------------------------
-- Internal helpers. Granted to nobody; SECURITY DEFINER callers owned by the
-- same role keep execute regardless of these revokes (same as 0075's core).
-- ---------------------------------------------------------------------------

create function _assert_admin_actor(
  p_caller    text,
  p_actor_id  uuid,
  p_required  text default 'admin'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception '%: requires the service-role key', p_caller;
  end if;

  if p_required not in ('admin', 'finance', 'superadmin') then
    raise exception '%: unknown authorization level %', p_caller, p_required;
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles
    where user_id = p_actor_id
      and scope_type = 'platform'
      and role in ('admin', 'superadmin')
  ) then
    raise exception '%: actor % is not an admin', p_caller, p_actor_id;
  end if;

  if not exists (select 1 from profiles where id = p_actor_id and status = 'active') then
    raise exception '%: actor % is not an active account', p_caller, p_actor_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_required = 'superadmin' and not exists (
    select 1 from user_roles
    where user_id = p_actor_id and scope_type = 'platform' and role = 'superadmin'
  ) then
    raise exception '%: actor % is not a superadmin', p_caller, p_actor_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_required = 'finance' and not exists (
    select 1 from user_roles
    where user_id = p_actor_id and scope_type = 'platform' and role in ('superadmin', 'finance')
  ) then
    raise exception '%: actor % is not a superadmin or finance', p_caller, p_actor_id
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function _assert_admin_actor(text, uuid, text) is
  'Internal: the single authorization predicate for every admin RPC. Caller must hold the service-role key, p_actor_id must hold a platform admin/superadmin role and have an active profile, plus superadmin (p_required = ''superadmin'') or superadmin/finance (''finance''). Never grant to any role.';

revoke all on function _assert_admin_actor(text, uuid, text) from public, anon, authenticated, service_role;

create function _write_admin_audit(
  p_actor_id     uuid,
  p_action       text,
  p_target_type  text,
  p_target_id    uuid,
  p_reason       text,
  p_details      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into admin_audit_log (actor_id, action, target_type, target_id, reason, details)
  values (p_actor_id, p_action, p_target_type, p_target_id, nullif(btrim(p_reason), ''), coalesce(p_details, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function _write_admin_audit(uuid, text, text, uuid, text, jsonb) is
  'Internal: the only writer of admin_audit_log. No authorization of its own - every caller has already run _assert_admin_actor() in the same transaction. Never grant to any role.';

revoke all on function _write_admin_audit(uuid, text, text, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- Normalises a free-text reason and, where the action demands one, refuses a
-- blank. Returned value is what gets audited.
create function _admin_reason(p_caller text, p_reason text, p_required boolean)
returns text
language plpgsql
immutable
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_required and v_reason is null then
    raise exception '%: a reason is required', p_caller using errcode = 'check_violation';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception '%: reason must be at most 1000 characters', p_caller using errcode = 'check_violation';
  end if;
  return v_reason;
end;
$$;

revoke all on function _admin_reason(text, text, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- approve_vendor / reject_vendor (latest: 0021)
-- ---------------------------------------------------------------------------

drop function if exists approve_vendor(uuid, uuid);
drop function if exists reject_vendor(uuid, uuid);

create function approve_vendor(p_vendor_id uuid, p_actor_id uuid, p_reason text default null)
returns vendors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor  vendors;
  v_before  text;
  v_reason  text := _admin_reason('approve_vendor', p_reason, false);
begin
  perform _assert_admin_actor('approve_vendor', p_actor_id);

  select status into v_before from vendors where id = p_vendor_id for update;
  if not found then
    raise exception 'approve_vendor: vendor % does not exist', p_vendor_id
      using errcode = 'no_data_found';
  end if;

  update vendors set status = 'active' where id = p_vendor_id
  returning * into v_vendor;

  perform _write_admin_audit(p_actor_id, 'vendor.approve', 'vendor', p_vendor_id, v_reason,
    jsonb_build_object('from_status', v_before, 'to_status', 'active'));

  return v_vendor;
end;
$$;

comment on function approve_vendor(uuid, uuid, text) is
  'Sets vendors.status = ''active'' (also reinstates a suspended vendor) and audits it. service_role only, actor verified by _assert_admin_actor(). Never grant to authenticated.';

revoke execute on function approve_vendor(uuid, uuid, text) from public, anon, authenticated;
grant execute on function approve_vendor(uuid, uuid, text) to service_role;

create function reject_vendor(p_vendor_id uuid, p_actor_id uuid, p_reason text default null)
returns vendors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor  vendors;
  v_before  text;
  v_reason  text := _admin_reason('reject_vendor', p_reason, false);
begin
  perform _assert_admin_actor('reject_vendor', p_actor_id);

  select status into v_before from vendors where id = p_vendor_id for update;
  if not found then
    raise exception 'reject_vendor: vendor % does not exist', p_vendor_id
      using errcode = 'no_data_found';
  end if;

  -- vendors.status has no 'rejected' value (0003's check constraint);
  -- 'suspended' is the terminal non-active state, as in 0021.
  update vendors set status = 'suspended' where id = p_vendor_id
  returning * into v_vendor;

  perform _write_admin_audit(p_actor_id, 'vendor.reject', 'vendor', p_vendor_id, v_reason,
    jsonb_build_object('from_status', v_before, 'to_status', 'suspended'));

  return v_vendor;
end;
$$;

comment on function reject_vendor(uuid, uuid, text) is
  'Sets vendors.status = ''suspended'' (the only non-active terminal value the column allows) and audits it. service_role only, actor verified by _assert_admin_actor(). Never grant to authenticated.';

revoke execute on function reject_vendor(uuid, uuid, text) from public, anon, authenticated;
grant execute on function reject_vendor(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- approve_rider / reject_rider (latest: 0027)
-- ---------------------------------------------------------------------------

drop function if exists approve_rider(uuid, uuid);
drop function if exists reject_rider(uuid, uuid);

create function approve_rider(p_rider_id uuid, p_actor_id uuid, p_reason text default null)
returns riders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider   riders;
  v_before  text;
  v_reason  text := _admin_reason('approve_rider', p_reason, false);
begin
  perform _assert_admin_actor('approve_rider', p_actor_id);

  select kyc_status into v_before from riders where user_id = p_rider_id for update;
  if not found then
    raise exception 'approve_rider: rider % does not exist', p_rider_id
      using errcode = 'no_data_found';
  end if;

  update riders set kyc_status = 'approved' where user_id = p_rider_id
  returning * into v_rider;

  perform _write_admin_audit(p_actor_id, 'rider.approve', 'rider', p_rider_id, v_reason,
    jsonb_build_object('from_kyc_status', v_before, 'to_kyc_status', 'approved'));

  return v_rider;
end;
$$;

comment on function approve_rider(uuid, uuid, text) is
  'Sets riders.kyc_status = ''approved'' and audits it. service_role only, actor verified by _assert_admin_actor(). Never grant to authenticated.';

revoke execute on function approve_rider(uuid, uuid, text) from public, anon, authenticated;
grant execute on function approve_rider(uuid, uuid, text) to service_role;

create function reject_rider(p_rider_id uuid, p_actor_id uuid, p_reason text default null)
returns riders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider   riders;
  v_before  text;
  v_reason  text := _admin_reason('reject_rider', p_reason, false);
begin
  perform _assert_admin_actor('reject_rider', p_actor_id);

  select kyc_status into v_before from riders where user_id = p_rider_id for update;
  if not found then
    raise exception 'reject_rider: rider % does not exist', p_rider_id
      using errcode = 'no_data_found';
  end if;

  update riders set kyc_status = 'rejected' where user_id = p_rider_id
  returning * into v_rider;

  perform _write_admin_audit(p_actor_id, 'rider.reject', 'rider', p_rider_id, v_reason,
    jsonb_build_object('from_kyc_status', v_before, 'to_kyc_status', 'rejected'));

  return v_rider;
end;
$$;

comment on function reject_rider(uuid, uuid, text) is
  'Sets riders.kyc_status = ''rejected'' and audits it with the admin''s reason. service_role only, actor verified by _assert_admin_actor(). Never grant to authenticated.';

revoke execute on function reject_rider(uuid, uuid, text) from public, anon, authenticated;
grant execute on function reject_rider(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- approve_rider_document / reject_rider_document (latest: 0052; signatures
-- unchanged - reject's p_note is the audited reason)
-- ---------------------------------------------------------------------------

create or replace function approve_rider_document(p_document_id uuid, p_actor_id uuid)
returns rider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document  rider_documents;
  v_before    text;
begin
  perform _assert_admin_actor('approve_rider_document', p_actor_id);

  select status into v_before from rider_documents where id = p_document_id for update;
  if not found then
    raise exception 'approve_rider_document: document % does not exist', p_document_id
      using errcode = 'no_data_found';
  end if;

  update rider_documents
  set status = 'approved', review_note = null
  where id = p_document_id
  returning * into v_document;

  perform _write_admin_audit(p_actor_id, 'rider_document.approve', 'rider_document', p_document_id, null,
    jsonb_build_object('rider_id', v_document.rider_id, 'doc_type', v_document.doc_type,
                       'from_status', v_before, 'to_status', 'approved'));

  return v_document;
end;
$$;

create or replace function reject_rider_document(p_document_id uuid, p_actor_id uuid, p_note text)
returns rider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document  rider_documents;
  v_before    text;
  -- Required: the rider app shows this note as the reason to resubmit.
  v_note      text := _admin_reason('reject_rider_document', p_note, true);
begin
  perform _assert_admin_actor('reject_rider_document', p_actor_id);

  select status into v_before from rider_documents where id = p_document_id for update;
  if not found then
    raise exception 'reject_rider_document: document % does not exist', p_document_id
      using errcode = 'no_data_found';
  end if;

  update rider_documents
  set status = 'rejected', review_note = v_note
  where id = p_document_id
  returning * into v_document;

  perform _write_admin_audit(p_actor_id, 'rider_document.reject', 'rider_document', p_document_id, v_note,
    jsonb_build_object('rider_id', v_document.rider_id, 'doc_type', v_document.doc_type,
                       'from_status', v_before, 'to_status', 'rejected'));

  return v_document;
end;
$$;

-- Grants carry over from 0052 (create or replace keeps them); restated so this
-- file is self-evidently correct on its own.
revoke execute on function approve_rider_document(uuid, uuid) from public, anon, authenticated;
grant execute on function approve_rider_document(uuid, uuid) to service_role;
revoke execute on function reject_rider_document(uuid, uuid, text) from public, anon, authenticated;
grant execute on function reject_rider_document(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- order_refund_destination: where an order's '<code>-refund' ledger transaction
-- actually put the money ('wallet' or 'gateway'; null if never refunded),
-- derived from the credited account rather than from event meta. One definition
-- shared by refund_order_escrow's replay guard, admin_request_gateway_refund and
-- the app's Monnify call, so a wallet-refunded order can never also be refunded
-- to the card.
-- ---------------------------------------------------------------------------

create function order_refund_destination(p_order_code text)
returns text
language sql
stable
set search_path = public
as $$
  select case
           when a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway' then 'gateway'
           when a.owner_type = 'customer' and a.kind = 'wallet' then 'wallet'
         end
  from transactions t
  join ledger_entries le on le.transaction_id = t.id and le.direction = 'credit'
  join accounts a on a.id = le.account_id
  where t.reference = p_order_code || '-refund'
  limit 1;
$$;

comment on function order_refund_destination(text) is
  'Returns ''wallet'' or ''gateway'' according to the account credited by the order''s <code>-refund ledger transaction, or null if there is none. service_role only.';

revoke execute on function order_refund_destination(text) from public, anon, authenticated;
grant execute on function order_refund_destination(text) to service_role;

-- ---------------------------------------------------------------------------
-- refund_order_escrow (latest: 0045). The audit row carries the destination
-- and the amount actually moved, read back from the refund transaction's
-- ledger entries rather than from anything the caller supplied. An idempotent
-- replay (already_refunded) changes nothing and is therefore not audited again,
-- but only when it names the destination the refund already went to: replaying
-- with the other one would report success and the Server Action would then
-- refund the same money a second time.
-- ---------------------------------------------------------------------------

create or replace function refund_order_escrow(
  p_order_id    uuid,
  p_actor_id    uuid,
  p_reason      text,
  p_destination text default 'wallet'
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order          orders;
  v_unwind_result  text;
  v_refunded_kobo  bigint;
  v_prior_dest     text;
  v_reason         text := _admin_reason('refund_order_escrow', p_reason, false);
begin
  perform _assert_admin_actor('refund_order_escrow', p_actor_id);

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'refund_order_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_unwind_result := _unwind_order_escrow_ledger(p_order_id, p_reason, p_destination);

  if v_unwind_result = 'already_refunded' then
    v_prior_dest := order_refund_destination(v_order.code);
    if v_prior_dest is distinct from p_destination then
      raise exception 'refund_order_escrow: order % was already refunded to the %, not the % - refusing to refund it twice', v_order.code, coalesce(v_prior_dest, 'an unknown account'), p_destination
        using errcode = 'check_violation';
    end if;

    select * into v_order from orders where id = p_order_id;
    return v_order;
  end if;

  if v_unwind_result = 'already_released' then
    raise exception 'refund_order_escrow: order % escrow has already been released to vendor/rider/platform — refusing to refund and pay out twice', p_order_id
      using errcode = 'check_violation';
  end if;

  if v_unwind_result = 'nothing_captured' then
    raise exception 'refund_order_escrow: order % has no captured payment held in escrow to refund (payment_status=%)', p_order_id, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from order_status_transitions
    where from_status = v_order.status and to_status = 'cancelled_by_platform'
  ) then
    v_order := transition_order(
      p_order_id, 'cancelled_by_platform', 'admin', p_actor_id,
      jsonb_build_object('reason', p_reason, 'refund_transaction', v_order.code || '-refund', 'refund_destination', p_destination)
    );
  else
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (
      p_order_id, v_order.status, v_order.status, 'admin', p_actor_id,
      jsonb_build_object('reason', p_reason, 'refund_transaction', v_order.code || '-refund', 'escrow_refunded', true, 'refund_destination', p_destination)
    );
    select * into v_order from orders where id = p_order_id;
  end if;

  select coalesce(sum(le.amount_kobo), 0) into v_refunded_kobo
  from ledger_entries le
  join transactions t on t.id = le.transaction_id
  where t.reference = v_order.code || '-refund' and le.direction = 'debit';

  perform _write_admin_audit(p_actor_id, 'order.refund_escrow', 'order', p_order_id, v_reason,
    jsonb_build_object('destination', p_destination, 'refunded_kobo', v_refunded_kobo,
                       'refund_transaction', v_order.code || '-refund', 'order_code', v_order.code));

  return v_order;
end;
$$;

revoke execute on function refund_order_escrow(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function refund_order_escrow(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- admin_reset_delivery_code_attempts (latest: 0031). Gains an optional reason.
-- ---------------------------------------------------------------------------

drop function if exists admin_reset_delivery_code_attempts(uuid, uuid);

create function admin_reset_delivery_code_attempts(
  p_order_id uuid,
  p_actor_id uuid,
  p_reason   text default null
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   orders;
  v_reason  text := _admin_reason('admin_reset_delivery_code_attempts', p_reason, false);
begin
  perform _assert_admin_actor('admin_reset_delivery_code_attempts', p_actor_id);

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'admin_reset_delivery_code_attempts: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.status <> 'arrived' then
    raise exception 'admin_reset_delivery_code_attempts: order % is not awaiting delivery-code verification (status=%)', p_order_id, v_order.status
      using errcode = 'check_violation';
  end if;

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (
    p_order_id, v_order.status, v_order.status, 'admin', p_actor_id,
    jsonb_build_object('delivery_code_attempts_reset', true)
  );

  perform _write_admin_audit(p_actor_id, 'order.reset_delivery_code_attempts', 'order', p_order_id, v_reason,
    jsonb_build_object('order_code', v_order.code));

  return v_order;
end;
$$;

comment on function admin_reset_delivery_code_attempts(uuid, uuid, text) is
  'Clears the delivery-code failed-attempt lockout (0022/0025) by writing an admin-authored order_events marker that verify_delivery_and_release_escrow() treats as the start of a fresh window (0031/0057), and audits it. service_role only, actor verified by _assert_admin_actor(). Never grant to authenticated.';

revoke execute on function admin_reset_delivery_code_attempts(uuid, uuid, text) from public, anon, authenticated;
grant execute on function admin_reset_delivery_code_attempts(uuid, uuid, text) to service_role;
