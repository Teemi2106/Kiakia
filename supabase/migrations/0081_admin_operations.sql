-- KiaKia - admin dashboard operations: the privileged writes and the read
-- aggregates the (admin) route group needs.
--
-- Every write below follows one shape: SECURITY DEFINER, granted to
-- service_role only, _assert_admin_actor() first (0080), the change and its
-- admin_audit_log row in the same transaction. A Server Action calls them via
-- the service-role client after its own requireAdminContext(); the RPC
-- re-verifying p_actor_id is defense in depth, not the only gate. The read
-- RPCs (admin_dashboard_metrics, admin_ledger_health, admin_list_balances)
-- take no actor: they are not callable by anything but service_role, and the
-- action/page has already run requireAdminContext().
--
-- COMMISSION AND RELEASE SEMANTICS (admin_set_vendor_commission). Verified
-- against 0057's verify_delivery_and_release_escrow(): the vendor/platform
-- split is computed at RELEASE time from vendors.commission_bps as it is then,
-- not snapshotted when the order was placed or paid. A commission change
-- therefore applies to every order that has not yet been delivered, including
-- ones already paid for. This migration deliberately does not change release
-- semantics; if per-order commission snapshots are wanted that is a separate
-- change to place_order() and the release function.
--
-- PAYOUTS (admin_record_payout). Records a COMPLETED manual bank transfer; it
-- moves no money itself. Ledger shape: DR owner:available, CR platform:gateway.
-- The gateway account holds net external flows (capture debits it when money
-- arrives), so a payout leaving the platform credits it back. 0074's rider
-- "disbursed" total is the sum of DEBIT entries on kind='payout' transactions
-- against the rider's accounts, which is exactly what this writes, so
-- get_rider_earnings() reflects these payouts with no change.
-- check_payee_available_not_negative() makes an overdrawn vendor/rider
-- available account impossible to commit whoever writes the entries; the RPC's
-- row lock and balance check are the first line, the trigger the backstop.
--
-- Error codes: check_violation (23514) for rejected input or state (including
-- self-targeting), no_data_found (P0002) for a missing target,
-- insufficient_privilege (42501, from _assert_admin_actor) for an inactive actor
-- or a missing superadmin, unique_violation (23505) for a payout reference
-- reused with different parameters. The app maps 23514/23505 messages to the
-- admin verbatim, so those messages are written to be shown.

-- ---------------------------------------------------------------------------
-- Indexes for the admin list pages and dashboard aggregates.
-- ---------------------------------------------------------------------------

-- Orders list: newest first, optionally narrowed by status. orders_status_idx
-- cannot serve "status = x order by created_at desc limit n" without a sort.
create index orders_created_at_idx on orders (created_at desc);
create index orders_status_created_at_idx on orders (status, created_at desc);

-- Capture anomalies are a handful of rows among every order event; the
-- dashboard counts the last 7 days of them.
create index order_events_capture_anomaly_idx on order_events (at desc)
  where meta ? 'duplicate_capture_attempt'
     or meta ? 'underpaid_capture'
     or meta @> '{"amount_mismatch": true}';

-- Platform revenue over a window reads one account's entries by time.
create index ledger_entries_account_created_idx on ledger_entries (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Vendor/rider available accounts can never go negative.
-- ---------------------------------------------------------------------------
--
-- Modelled on check_customer_wallet_not_negative() (0045), SECURITY DEFINER
-- for the same reason as 0059: a deferred trigger fires at COMMIT, after
-- PostgREST has reset the connection role. Scoped to vendor/rider 'available'
-- accounts only; platform:gateway is expected to run negative. Only debit rows
-- can lower a balance, so the trigger's WHEN clause skips credits entirely (no
-- function call, no balance scan on the hot capture/release credit paths).
create function check_payee_available_not_negative()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if not exists (
    select 1 from accounts
    where id = new.account_id and owner_type in ('vendor', 'rider') and kind = 'available'
  ) then
    return new;
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
  into v_balance
  from ledger_entries
  where account_id = new.account_id;

  if v_balance < 0 then
    raise exception
      'Payee available account % would be overdrawn (resulting balance % kobo) - a payout can never exceed what was earned',
      new.account_id, v_balance
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function check_payee_available_not_negative() is
  'Deferred constraint trigger on ledger_entries: a vendor or rider available account can never go negative, checked once at commit regardless of who wrote the entries. Fires for debit rows only (a credit cannot overdraw). SECURITY DEFINER per 0059.';

create constraint trigger ledger_entries_payee_available_not_negative
  after insert or update on ledger_entries
  deferrable initially deferred
  for each row
  when (new.direction = 'debit')
  execute function check_payee_available_not_negative();

-- ---------------------------------------------------------------------------
-- a) admin_set_user_status
-- ---------------------------------------------------------------------------
--
-- profiles.status alone blocks nothing (no policy reads it); the Server Action
-- follows this with a Supabase Auth ban, which is what actually stops sign-in
-- and token refresh across the web and rider apps. DB first so the intent is
-- audited even if the ban call fails; a replay of the same status is a no-op
-- here (no duplicate audit) and the action simply re-applies the ban.
--
-- A ban does not end sessions that already exist, so suspending also deletes
-- the user's auth.sessions rows (their refresh tokens cascade): the web and
-- rider apps validate the session on every request, so a suspended user is
-- signed out at once rather than when their access token expires. The delete
-- runs on a replayed suspension too, which keeps a re-run after a failed ban
-- call complete.
--
-- Returns {status, previous_status, changed}. The action lifts the ban only
-- for a real suspended -> active transition, so reinstating an account that
-- was never suspended cannot clear an unrelated ban.
--
-- Suspending a superadmin first locks every superadmin row and then requires
-- another ACTIVE superadmin to remain, so two superadmins suspending each
-- other concurrently serialise instead of both succeeding.

create function admin_set_user_status(
  p_user_id   uuid,
  p_status    text,
  p_reason    text,
  p_actor_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile      profiles;
  v_previous     text;
  v_reason       text;
  v_was_online   boolean := false;
  v_target_super boolean;
begin
  perform _assert_admin_actor('admin_set_user_status', p_actor_id);

  if p_status not in ('active', 'suspended') then
    raise exception 'admin_set_user_status: status must be active or suspended, got %', p_status
      using errcode = 'check_violation';
  end if;
  v_reason := _admin_reason('admin_set_user_status', p_reason, p_status = 'suspended');

  if p_user_id is not distinct from p_actor_id then
    raise exception 'admin_set_user_status: you cannot change your own account status'
      using errcode = 'check_violation';
  end if;

  v_target_super := exists (
    select 1 from user_roles where user_id = p_user_id and scope_type = 'platform' and role = 'superadmin'
  );
  if p_status = 'suspended' and v_target_super then
    perform 1 from user_roles where role = 'superadmin' and scope_type = 'platform' order by id for update;
  end if;

  select * into v_profile from profiles where id = p_user_id for update;
  if not found then
    raise exception 'admin_set_user_status: user % does not exist', p_user_id
      using errcode = 'no_data_found';
  end if;

  if v_profile.status = 'deleted' then
    raise exception 'admin_set_user_status: user % is deleted and cannot be reinstated', p_user_id
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from user_roles
    where user_id = p_user_id and scope_type = 'platform' and role in ('admin', 'superadmin')
  ) then
    perform _assert_admin_actor('admin_set_user_status', p_actor_id, 'superadmin');
  end if;

  v_previous := v_profile.status;

  if p_status = 'suspended' and v_target_super and v_previous = 'active' and not exists (
    select 1
    from user_roles ur
    join profiles pr on pr.id = ur.user_id and pr.status = 'active'
    where ur.role = 'superadmin' and ur.scope_type = 'platform' and ur.user_id <> p_user_id
  ) then
    raise exception 'admin_set_user_status: refusing to suspend the last active superadmin'
      using errcode = 'check_violation';
  end if;

  if p_status = 'suspended' then
    delete from auth.sessions where user_id = p_user_id;
  end if;

  if v_previous = p_status then
    return jsonb_build_object('status', p_status, 'previous_status', v_previous, 'changed', false);
  end if;

  update profiles set status = p_status where id = p_user_id;

  if p_status = 'suspended' then
    update riders set is_online = false where user_id = p_user_id and is_online
    returning true into v_was_online;
  end if;

  perform _write_admin_audit(
    p_actor_id,
    case when p_status = 'suspended' then 'user.suspend' else 'user.reinstate' end,
    'user', p_user_id, v_reason,
    jsonb_build_object('to_status', p_status, 'rider_taken_offline', coalesce(v_was_online, false))
  );

  return jsonb_build_object('status', p_status, 'previous_status', v_previous, 'changed', true);
end;
$$;

comment on function admin_set_user_status(uuid, text, text, uuid) is
  'Suspends or reinstates a user (profiles.status), audited, and returns {status, previous_status, changed}. Refuses self-targeting; changing an admin/superadmin requires a superadmin actor and cannot suspend the last active superadmin; suspending revokes the user''s auth sessions and takes a rider offline. Idempotent: an unchanged status is a no-op with no audit row. The caller must also apply the Supabase Auth ban (and lift it only when changed and previous_status was suspended) - this records the account state. service_role only.';

revoke execute on function admin_set_user_status(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function admin_set_user_status(uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- b) admin_set_platform_role
-- ---------------------------------------------------------------------------
--
-- 'rider' is granted exactly as register_rider() does (0026): a platform-scoped
-- row with no scope_id, so support can restore the role on an account that lost
-- it without touching the riders row. Granting or revoking admin/superadmin
-- needs a superadmin actor, and so does ANY change to an account that already
-- holds admin/superadmin (a plain admin must not be able to strip a colleague's
-- rider role, or anything else, from an admin). Changing superadmin first locks
-- every superadmin row, then re-runs the actor check, so two superadmins
-- revoking each other concurrently serialise and the second sees the first's
-- result instead of both succeeding and leaving none.

create function admin_set_platform_role(
  p_user_id   uuid,
  p_role      text,
  p_grant     boolean,
  p_reason    text,
  p_actor_id  uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason   text;
  v_changed  integer;
begin
  if p_role not in ('admin', 'superadmin', 'rider') then
    raise exception 'admin_set_platform_role: role must be admin, superadmin or rider, got %', p_role
      using errcode = 'check_violation';
  end if;
  if p_grant is null then
    raise exception 'admin_set_platform_role: p_grant is required' using errcode = 'check_violation';
  end if;

  if p_role = 'superadmin' then
    perform 1 from user_roles where role = 'superadmin' and scope_type = 'platform' order by id for update;
  end if;

  perform _assert_admin_actor('admin_set_platform_role', p_actor_id);
  v_reason := _admin_reason('admin_set_platform_role', p_reason, true);

  if p_user_id is not distinct from p_actor_id then
    raise exception 'admin_set_platform_role: you cannot change your own roles'
      using errcode = 'check_violation';
  end if;

  if p_role in ('admin', 'superadmin') or exists (
    select 1 from user_roles
    where user_id = p_user_id and scope_type = 'platform' and role in ('admin', 'superadmin')
  ) then
    perform _assert_admin_actor('admin_set_platform_role', p_actor_id, 'superadmin');
  end if;

  if not exists (select 1 from profiles where id = p_user_id and status <> 'deleted') then
    raise exception 'admin_set_platform_role: user % does not exist', p_user_id
      using errcode = 'no_data_found';
  end if;

  if p_grant then
    insert into user_roles (user_id, role) values (p_user_id, p_role)
    on conflict (user_id, role) where (scope_type = 'platform') do nothing;
  else
    if p_role = 'superadmin' and not exists (
      select 1
      from user_roles ur
      join profiles pr on pr.id = ur.user_id and pr.status = 'active'
      where ur.role = 'superadmin' and ur.scope_type = 'platform' and ur.user_id <> p_user_id
    ) then
      raise exception 'admin_set_platform_role: refusing to remove the last active superadmin'
        using errcode = 'check_violation';
    end if;

    delete from user_roles where user_id = p_user_id and role = p_role and scope_type = 'platform';
  end if;

  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return false;
  end if;

  perform _write_admin_audit(
    p_actor_id,
    case when p_grant then 'user.grant_role' else 'user.revoke_role' end,
    'user', p_user_id, v_reason,
    jsonb_build_object('role', p_role)
  );

  return true;
end;
$$;

comment on function admin_set_platform_role(uuid, text, boolean, text, uuid) is
  'Grants or revokes a platform-scoped admin/superadmin/rider role, audited. Changing admin/superadmin, or any role of an account that holds admin/superadmin, needs a superadmin actor; self-targeting is refused; the last active superadmin cannot be removed. Returns true if a row changed, false for an idempotent no-op (no audit row). service_role only.';

revoke execute on function admin_set_platform_role(uuid, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function admin_set_platform_role(uuid, text, boolean, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- c) admin_set_vendor_commission - see header for release semantics.
-- ---------------------------------------------------------------------------

create function admin_set_vendor_commission(
  p_vendor_id        uuid,
  p_commission_bps   integer,
  p_reason           text,
  p_actor_id         uuid
)
returns vendors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor  vendors;
  v_before  integer;
  v_reason  text;
begin
  perform _assert_admin_actor('admin_set_vendor_commission', p_actor_id, 'finance');
  v_reason := _admin_reason('admin_set_vendor_commission', p_reason, true);

  if p_commission_bps is null or p_commission_bps not between 0 and 10000 then
    raise exception 'admin_set_vendor_commission: commission must be between 0 and 10000 basis points, got %', p_commission_bps
      using errcode = 'check_violation';
  end if;

  select commission_bps into v_before from vendors where id = p_vendor_id for update;
  if not found then
    raise exception 'admin_set_vendor_commission: vendor % does not exist', p_vendor_id
      using errcode = 'no_data_found';
  end if;

  if v_before = p_commission_bps then
    select * into v_vendor from vendors where id = p_vendor_id;
    return v_vendor;
  end if;

  update vendors set commission_bps = p_commission_bps where id = p_vendor_id
  returning * into v_vendor;

  perform _write_admin_audit(p_actor_id, 'vendor.set_commission', 'vendor', p_vendor_id, v_reason,
    jsonb_build_object('from_bps', v_before, 'to_bps', p_commission_bps));

  return v_vendor;
end;
$$;

comment on function admin_set_vendor_commission(uuid, integer, text, uuid) is
  'Sets vendors.commission_bps (0-10000), audited with before/after. Release computes the split from the vendor''s commission at release time (0057), so this also changes the payout of orders already paid but not yet delivered. Unchanged value is a no-op with no audit row. service_role only; actor must be a superadmin or hold the finance role.';

revoke execute on function admin_set_vendor_commission(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function admin_set_vendor_commission(uuid, integer, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- d) admin_update_service_area (fees and activation only; geometry is out of
-- scope). launched_at is left alone: nothing sets it today and activating an
-- area is not obviously the same event as launching it.
--
-- Fees are customer-visible prices and rider pay, so the actor must be a
-- superadmin or hold the finance role, and each fee is capped at NGN 100,000.
-- Real Abuja fees are hundreds to a few thousand naira; the cap is a ceiling
-- that stops a slipped decimal or a compromised session from pricing a
-- delivery at millions, not a pricing rule.
-- ---------------------------------------------------------------------------

create function admin_update_service_area(
  p_service_area_id          uuid,
  p_base_delivery_fee_kobo   bigint,
  p_per_km_fee_kobo          bigint,
  p_rider_base_fee_kobo      bigint,
  p_rider_per_km_fee_kobo    bigint,
  p_is_active                boolean,
  p_reason                   text,
  p_actor_id                 uuid
)
returns service_areas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area    service_areas;
  v_before  jsonb;
  v_after   jsonb;
  v_reason  text;
begin
  perform _assert_admin_actor('admin_update_service_area', p_actor_id, 'finance');
  v_reason := _admin_reason('admin_update_service_area', p_reason, true);

  if p_is_active is null
     or p_base_delivery_fee_kobo is null or p_base_delivery_fee_kobo not between 0 and 10000000
     or p_per_km_fee_kobo is null or p_per_km_fee_kobo not between 0 and 10000000
     or p_rider_base_fee_kobo is null or p_rider_base_fee_kobo not between 0 and 10000000
     or p_rider_per_km_fee_kobo is null or p_rider_per_km_fee_kobo not between 0 and 10000000 then
    raise exception 'admin_update_service_area: every fee must be between 0 and 10000000 kobo (NGN 100,000) and is_active is required'
      using errcode = 'check_violation';
  end if;

  select * into v_area from service_areas where id = p_service_area_id for update;
  if not found then
    raise exception 'admin_update_service_area: service area % does not exist', p_service_area_id
      using errcode = 'no_data_found';
  end if;

  v_before := jsonb_build_object(
    'base_delivery_fee_kobo', v_area.base_delivery_fee_kobo,
    'per_km_fee_kobo', v_area.per_km_fee_kobo,
    'rider_base_fee_kobo', v_area.rider_base_fee_kobo,
    'rider_per_km_fee_kobo', v_area.rider_per_km_fee_kobo,
    'is_active', v_area.is_active
  );
  v_after := jsonb_build_object(
    'base_delivery_fee_kobo', p_base_delivery_fee_kobo,
    'per_km_fee_kobo', p_per_km_fee_kobo,
    'rider_base_fee_kobo', p_rider_base_fee_kobo,
    'rider_per_km_fee_kobo', p_rider_per_km_fee_kobo,
    'is_active', p_is_active
  );

  if v_before = v_after then
    return v_area;
  end if;

  update service_areas set
    base_delivery_fee_kobo = p_base_delivery_fee_kobo,
    per_km_fee_kobo        = p_per_km_fee_kobo,
    rider_base_fee_kobo    = p_rider_base_fee_kobo,
    rider_per_km_fee_kobo  = p_rider_per_km_fee_kobo,
    is_active              = p_is_active
  where id = p_service_area_id
  returning * into v_area;

  perform _write_admin_audit(p_actor_id, 'service_area.update', 'service_area', p_service_area_id, v_reason,
    jsonb_build_object('name', v_area.name, 'before', v_before, 'after', v_after));

  return v_area;
end;
$$;

comment on function admin_update_service_area(uuid, bigint, bigint, bigint, bigint, boolean, text, uuid) is
  'Updates a service area''s four fee columns and is_active, audited with before/after. Polygon editing is out of scope. Each fee must be 0-10000000 kobo. Unchanged values are a no-op with no audit row. service_role only; actor must be a superadmin or hold the finance role.';

revoke execute on function admin_update_service_area(uuid, bigint, bigint, bigint, bigint, boolean, text, uuid) from public, anon, authenticated;
grant execute on function admin_update_service_area(uuid, bigint, bigint, bigint, bigint, boolean, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- e) admin_record_payout
-- ---------------------------------------------------------------------------
--
-- Idempotency: the transaction reference is 'payout-' || the bank's reference,
-- so a retry resolves to the same transactions row. The owner's available
-- account is locked BEFORE the replay check, so two concurrent first attempts
-- with the same reference serialise and the second takes the replay path
-- instead of racing the unique constraint. Same reference with a different
-- owner or amount raises rather than silently returning someone else's payout.

create function admin_record_payout(
  p_owner_type          text,
  p_owner_id            uuid,
  p_amount_kobo         bigint,
  p_external_reference  text,
  p_reason              text,
  p_actor_id            uuid
)
returns transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_external    text := btrim(p_external_reference);
  v_reference   text;
  v_reason      text;
  v_account_id  uuid;
  v_gateway_id  uuid;
  v_balance     bigint;
  v_bank        jsonb;
  v_tx          transactions;
begin
  perform _assert_admin_actor('admin_record_payout', p_actor_id, 'finance');
  v_reason := _admin_reason('admin_record_payout', p_reason, false);

  if p_owner_type not in ('vendor', 'rider') then
    raise exception 'admin_record_payout: owner type must be vendor or rider, got %', p_owner_type
      using errcode = 'check_violation';
  end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'admin_record_payout: amount must be a positive number of kobo'
      using errcode = 'check_violation';
  end if;
  if v_external is null or v_external !~ '^[A-Za-z0-9._-]{3,64}$' then
    raise exception 'admin_record_payout: external reference must be 3-64 characters of letters, digits, dot, dash or underscore'
      using errcode = 'check_violation';
  end if;
  v_reference := 'payout-' || v_external;

  if p_owner_type = 'vendor' then
    perform 1 from vendors where id = p_owner_id;
  else
    select jsonb_build_object(
      'bank_name', bank_name,
      'bank_account_name', bank_account_name,
      'bank_account_number_masked', '******' || right(bank_account_number, 4)
    ) into v_bank
    from riders where user_id = p_owner_id;
  end if;
  if not found then
    raise exception 'admin_record_payout: % % does not exist', p_owner_type, p_owner_id
      using errcode = 'no_data_found';
  end if;

  insert into accounts (owner_type, owner_id, kind) values (p_owner_type, p_owner_id, 'available')
  on conflict (owner_type, owner_id, kind) do nothing;

  select id into v_account_id
  from accounts
  where owner_type = p_owner_type and owner_id = p_owner_id and kind = 'available'
  for no key update;

  select * into v_tx from transactions where reference = v_reference;
  if found then
    if v_tx.kind = 'payout' and exists (
      select 1 from ledger_entries
      where transaction_id = v_tx.id and account_id = v_account_id
        and direction = 'debit' and amount_kobo = p_amount_kobo
    ) then
      return v_tx;
    end if;
    raise exception 'admin_record_payout: reference % was already used for a different payout', v_external
      using errcode = 'unique_violation';
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
  into v_balance
  from ledger_entries where account_id = v_account_id;

  if p_amount_kobo > v_balance then
    raise exception 'admin_record_payout: % available balance is % kobo, cannot pay out % kobo', p_owner_type, v_balance, p_amount_kobo
      using errcode = 'check_violation';
  end if;

  select id into v_gateway_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  if v_gateway_id is null then
    raise exception 'admin_record_payout: platform gateway account is not seeded';
  end if;

  insert into transactions (kind, reference, description)
  values ('payout', v_reference, 'Manual bank payout, reference ' || v_external)
  returning * into v_tx;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
  values
    (v_tx.id, v_account_id, 'debit',  p_amount_kobo, 'payout'),
    (v_tx.id, v_gateway_id, 'credit', p_amount_kobo, 'payout');

  perform _write_admin_audit(p_actor_id, 'payout.record', p_owner_type, p_owner_id, v_reason,
    jsonb_build_object(
      'transaction_id', v_tx.id,
      'reference', v_reference,
      'external_reference', v_external,
      'amount_kobo', p_amount_kobo,
      'balance_before_kobo', v_balance,
      'balance_after_kobo', v_balance - p_amount_kobo,
      'bank', v_bank
    ));

  return v_tx;
end;
$$;

comment on function admin_record_payout(text, uuid, bigint, text, text, uuid) is
  'Records a COMPLETED manual bank transfer: DR owner:available, CR platform:gateway on a kind=payout transaction whose reference is payout-<external reference>. Locks the owner''s available account, derives the balance from the ledger and requires 0 < amount <= balance. Idempotent on the reference (same owner+amount returns the existing transaction; different parameters raise). Audits with the balance before/after and, for riders, a snapshot of their bank details with the account number masked to its last 4 digits. service_role only; actor must be a superadmin or hold the finance role.';

revoke execute on function admin_record_payout(text, uuid, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function admin_record_payout(text, uuid, bigint, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- f) admin_request_gateway_refund
-- ---------------------------------------------------------------------------
--
-- The refund_order_escrow(..., 'gateway') path reverses the ledger and then the
-- Server Action asks Monnify. The action claims payments.refund_reference
-- BEFORE calling Monnify, so a request that was claimed (even if its outcome is
-- unknown) is never re-requestable here - that could refund the card twice; the
-- admin reconciles it in Monnify instead. What this retries is an order whose
-- ledger refund went to the gateway and that was never claimed at all. It
-- validates from the LEDGER (the '<code>-refund' transaction credited
-- platform:gateway, not event meta), audits the attempt, and hands back the
-- order code for the action to pass to requestMonnifyRefundForOrder().

create function admin_request_gateway_refund(
  p_order_id   uuid,
  p_reason     text,
  p_actor_id   uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders;
  v_payment  payments;
  v_reason   text;
begin
  perform _assert_admin_actor('admin_request_gateway_refund', p_actor_id);
  v_reason := _admin_reason('admin_request_gateway_refund', p_reason, false);

  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'admin_request_gateway_refund: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  select * into v_payment from payments where idempotency_key = v_order.code for update;
  if not found then
    raise exception 'admin_request_gateway_refund: order % has no card payment to refund', v_order.code
      using errcode = 'check_violation';
  end if;

  if v_payment.provider_ref is null then
    raise exception 'admin_request_gateway_refund: order % has no captured card payment at the provider to refund', v_order.code
      using errcode = 'check_violation';
  end if;

  if order_refund_destination(v_order.code) is distinct from 'gateway' then
    raise exception 'admin_request_gateway_refund: order % was not refunded to the gateway in the ledger', v_order.code
      using errcode = 'check_violation';
  end if;

  if v_payment.refund_reference is not null then
    raise exception 'admin_request_gateway_refund: a gateway refund was already requested for order % (status %); if that status is unknown, check Monnify rather than requesting again', v_order.code, coalesce(v_payment.refund_status, 'unknown')
      using errcode = 'check_violation';
  end if;

  perform _write_admin_audit(p_actor_id, 'order.request_gateway_refund', 'order', p_order_id, v_reason,
    jsonb_build_object('order_code', v_order.code, 'payment_id', v_payment.id,
                       'provider_ref', v_payment.provider_ref, 'amount_kobo', v_payment.amount_kobo));

  return v_order.code;
end;
$$;

comment on function admin_request_gateway_refund(uuid, text, uuid) is
  'Authorises and audits a retry of the Monnify refund call for an order whose ledger refund went to platform:gateway, whose payment was captured at the provider (payments.provider_ref set; looked up by idempotency_key = order code, as requestMonnifyRefundForOrder() does) and whose payments.refund_reference is still null (a claimed refund of any status is refused). Returns the order code for requestMonnifyRefundForOrder(). service_role only.';

revoke execute on function admin_request_gateway_refund(uuid, text, uuid) from public, anon, authenticated;
grant execute on function admin_request_gateway_refund(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- g) admin_dashboard_metrics
-- ---------------------------------------------------------------------------
--
-- One round trip for the overview page, restricted to what the schema models.
-- Stuck-order definitions: ready_for_pickup with no rider for 15 minutes;
-- arrived and locked out of the delivery code (5 failures inside the window
-- verify_delivery_and_release_escrow() uses: since arrived_at and since the
-- last admin reset marker); failed_delivery whose payment is still paid, i.e.
-- escrow never released or refunded. A "gateway refund" is an order whose
-- '<code>-refund' ledger transaction credited platform:gateway.

create function admin_dashboard_metrics()
returns jsonb
language sql
stable
set search_path = public
as $$
  with
  delivered as (
    select total_kobo, delivered_at
    from orders
    where status = 'delivered' and delivered_at >= now() - interval '30 days'
  ),
  gateway_refunds as (
    select p.refund_reference, p.refund_status
    from payments p
    join transactions t on t.reference = p.idempotency_key || '-refund'
    where exists (
      select 1
      from ledger_entries le
      join accounts a on a.id = le.account_id
      where le.transaction_id = t.id and le.direction = 'credit'
        and a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway'
    )
  )
  select jsonb_build_object(
    'generated_at', now(),
    'orders_by_status', (
      select jsonb_object_agg(s.status, coalesce(c.n, 0))
      from unnest(array['placed', 'accepted', 'preparing', 'ready_for_pickup', 'rider_assigned',
                        'picked_up', 'in_transit', 'arrived']) as s(status)
      left join (
        select status::text as status, count(*) as n
        from orders
        where status in ('placed', 'accepted', 'preparing', 'ready_for_pickup', 'rider_assigned',
                         'picked_up', 'in_transit', 'arrived')
        group by status
      ) c on c.status = s.status
    ),
    'delivered', jsonb_build_object(
      'last_24h', (select jsonb_build_object('orders', count(*), 'gmv_kobo', coalesce(sum(total_kobo), 0))
                   from delivered where delivered_at >= now() - interval '24 hours'),
      'last_7d',  (select jsonb_build_object('orders', count(*), 'gmv_kobo', coalesce(sum(total_kobo), 0))
                   from delivered where delivered_at >= now() - interval '7 days'),
      'last_30d', (select jsonb_build_object('orders', count(*), 'gmv_kobo', coalesce(sum(total_kobo), 0))
                   from delivered)
    ),
    'platform_revenue_30d_kobo', (
      select coalesce(sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end), 0)
      from ledger_entries le
      join accounts a on a.id = le.account_id
      where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'revenue'
        and le.created_at >= now() - interval '30 days'
    ),
    'riders', jsonb_build_object(
      'online', (select count(*) from riders where is_online and kyc_status = 'approved'),
      'pending_kyc', (select count(*) from riders where kyc_status = 'pending'),
      'documents_pending', (select count(*) from rider_documents where status = 'pending')
    ),
    'vendors_suspended', (select count(*) from vendors where status = 'suspended'),
    'stuck_orders', jsonb_build_object(
      'ready_without_rider', (
        select count(*) from orders
        where status = 'ready_for_pickup' and rider_id is null and ready_at < now() - interval '15 minutes'
      ),
      'delivery_code_locked', (
        select count(*) from orders o
        where o.status = 'arrived'
          and (
            select count(*) from order_events e
            where e.order_id = o.id
              and (e.meta ->> 'delivery_code_failed')::boolean is true
              and e.at >= o.arrived_at
              and e.at > coalesce((
                select max(r.at) from order_events r
                where r.order_id = o.id and r.actor_type = 'admin'
                  and (r.meta ->> 'delivery_code_attempts_reset')::boolean is true
              ), '-infinity'::timestamptz)
          ) >= 5
      ),
      'failed_delivery_escrow_held', (
        select count(*) from orders where status = 'failed_delivery' and payment_status = 'paid'
      )
    ),
    'capture_anomalies_7d', jsonb_build_object(
      'duplicate_capture', (select count(*) from order_events
                            where meta ? 'duplicate_capture_attempt' and at >= now() - interval '7 days'),
      'underpaid_capture', (select count(*) from order_events
                            where meta ? 'underpaid_capture' and at >= now() - interval '7 days'),
      'amount_mismatch',   (select count(*) from order_events
                            where meta @> '{"amount_mismatch": true}' and at >= now() - interval '7 days')
    ),
    'gateway_refunds', jsonb_build_object(
      'not_requested', (select count(*) from gateway_refunds where refund_reference is null),
      'pending',       (select count(*) from gateway_refunds where refund_status = 'pending'),
      'failed',        (select count(*) from gateway_refunds where refund_status = 'failed')
    )
  );
$$;

comment on function admin_dashboard_metrics() is
  'Counts and totals for the admin overview, as one jsonb document. service_role only; the caller has already run requireAdminContext().';

revoke execute on function admin_dashboard_metrics() from public, anon, authenticated;
grant execute on function admin_dashboard_metrics() to service_role;

-- ---------------------------------------------------------------------------
-- h) admin_ledger_health - on-demand reconciliation (the nightly job from 0005
-- is not built). Expected escrow = every escrow credit captured for an order
-- that has neither an '-escrow' release nor a '-refund' transaction.
-- ---------------------------------------------------------------------------

create function admin_ledger_health()
returns jsonb
language sql
stable
set search_path = public
as $$
  with
  per_tx as (
    select transaction_id,
           coalesce(sum(amount_kobo) filter (where direction = 'debit'), 0)  as debit_kobo,
           coalesce(sum(amount_kobo) filter (where direction = 'credit'), 0) as credit_kobo
    from ledger_entries
    group by transaction_id
  ),
  unbalanced as (
    select t.id, t.reference, p.debit_kobo, p.credit_kobo
    from per_tx p
    join transactions t on t.id = p.transaction_id
    where p.debit_kobo <> p.credit_kobo
  ),
  escrow_actual as (
    select coalesce(sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end), 0) as kobo
    from ledger_entries le
    join accounts a on a.id = le.account_id
    where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow'
  ),
  escrow_expected as (
    select coalesce(sum(le.amount_kobo), 0) as kobo
    from ledger_entries le
    join accounts a on a.id = le.account_id
      and a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow'
    join orders o on o.id = le.order_id
    where le.direction = 'credit' and le.entry_type = 'payment_capture'
      and not exists (
        select 1 from transactions t
        where t.reference in (o.code || '-escrow', o.code || '-refund')
      )
  )
  select jsonb_build_object(
    'checked_at', now(),
    'unbalanced_transactions', jsonb_build_object(
      'count', (select count(*) from unbalanced),
      'sample', coalesce((
        select jsonb_agg(jsonb_build_object('transaction_id', u.id, 'reference', u.reference,
                                            'debit_kobo', u.debit_kobo, 'credit_kobo', u.credit_kobo))
        from (select * from unbalanced order by id limit 20) u
      ), '[]'::jsonb)
    ),
    'totals', (
      select jsonb_build_object('debit_kobo', coalesce(sum(debit_kobo), 0),
                                'credit_kobo', coalesce(sum(credit_kobo), 0),
                                'difference_kobo', coalesce(sum(debit_kobo), 0) - coalesce(sum(credit_kobo), 0))
      from per_tx
    ),
    'escrow', jsonb_build_object(
      'actual_kobo', (select kobo from escrow_actual),
      'expected_kobo', (select kobo from escrow_expected),
      'drift_kobo', (select kobo from escrow_actual) - (select kobo from escrow_expected)
    ),
    'negative_accounts', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', n.id, 'owner_type', n.owner_type, 'owner_id', n.owner_id,
                                          'kind', n.kind, 'balance_kobo', n.balance_kobo))
      from (
        select a.id, a.owner_type, a.owner_id, a.kind, ab.balance_kobo
        from accounts a
        join account_balances ab on ab.account_id = a.id
        where a.kind <> 'gateway' and ab.balance_kobo < 0
        order by ab.balance_kobo
        limit 50
      ) n
    ), '[]'::jsonb)
  );
$$;

comment on function admin_ledger_health() is
  'On-demand ledger reconciliation as one jsonb document: unbalanced transactions (should be 0), global debit/credit totals, platform escrow actual vs expected, and any non-gateway account with a negative balance. The gateway account is expected to run negative and is excluded. service_role only.';

revoke execute on function admin_ledger_health() from public, anon, authenticated;
grant execute on function admin_ledger_health() to service_role;

-- ---------------------------------------------------------------------------
-- i) admin_list_balances - for the payouts page. Owners appear once they have
-- an account row (first earning / first wallet credit). total_count repeats on
-- every row so the page paginates from one query. p_owner_id narrows it to one
-- owner so a detail page gets the same ledger-derived figures as the list.
-- ---------------------------------------------------------------------------

create function admin_list_balances(
  p_owner_type  text,
  p_limit       integer default 50,
  p_offset      integer default 0,
  p_owner_id    uuid default null
)
returns table (
  owner_id             uuid,
  display_name         text,
  balance_kobo         bigint,
  disbursed_kobo       bigint,
  bank_name            text,
  bank_account_name    text,
  bank_account_number  text,
  total_count          bigint
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_kind text;
begin
  if p_owner_type not in ('vendor', 'rider', 'customer') then
    raise exception 'admin_list_balances: owner type must be vendor, rider or customer, got %', p_owner_type
      using errcode = 'check_violation';
  end if;
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    raise exception 'admin_list_balances: limit must be 1-200 and offset non-negative'
      using errcode = 'check_violation';
  end if;

  v_kind := case when p_owner_type = 'customer' then 'wallet' else 'available' end;

  return query
  with bal as (
    select a.owner_id,
           coalesce(sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end), 0)::bigint as balance_kobo,
           coalesce(sum(le.amount_kobo) filter (where le.direction = 'debit' and t.kind = 'payout'), 0)::bigint as disbursed_kobo
    from accounts a
    left join ledger_entries le on le.account_id = a.id
    left join transactions t on t.id = le.transaction_id
    where a.owner_type = p_owner_type and a.kind = v_kind
      and (p_owner_id is null or a.owner_id = p_owner_id)
    group by a.owner_id
  )
  select b.owner_id,
         case when p_owner_type = 'vendor' then v.name else pr.full_name end,
         b.balance_kobo,
         b.disbursed_kobo,
         r.bank_name,
         r.bank_account_name,
         r.bank_account_number,
         count(*) over ()
  from bal b
  left join vendors v on p_owner_type = 'vendor' and v.id = b.owner_id
  left join profiles pr on p_owner_type <> 'vendor' and pr.id = b.owner_id
  left join riders r on p_owner_type = 'rider' and r.user_id = b.owner_id
  order by b.balance_kobo desc, b.owner_id
  limit p_limit offset p_offset;
end;
$$;

comment on function admin_list_balances(text, integer, integer, uuid) is
  'Per-owner ledger balance (vendor/rider available, customer wallet), total already disbursed by payout transactions, and for riders their bank details. Paginated, richest balance first. Exposes bank account numbers: service_role only.';

revoke execute on function admin_list_balances(text, integer, integer, uuid) from public, anon, authenticated;
grant execute on function admin_list_balances(text, integer, integer, uuid) to service_role;
