-- KiaKia - audited admin CSV exports (orders for any admin, ledger for finance).
--
-- An export copies operational data out of the system, so it is a privileged
-- action in its own right: it is recorded in admin_audit_log BEFORE the first
-- byte is streamed, so an export that starts is always on the record even if
-- the download is abandoned half way. Three RPCs, all service_role only:
--
--   admin_log_export()          the audit write. Re-validates the kind and the
--                               filters, asserts the actor at the level the
--                               export needs ('admin' for orders, 'finance' for
--                               the ledger) and returns the id of the audit
--                               row. An export has no natural target row, so
--                               target_type is the new 'export' value and
--                               target_id a fresh uuid that identifies this one
--                               export (the same id is the audit row's handle
--                               in the response the app builds).
--   admin_export_orders_page()  one keyset page of orders with the vendor name
--                               joined in SQL, same shape and checks as the ledger
--                               page below but asserting 'admin'. No phone, address,
--                               email or delivery code.
--   admin_export_ledger_page()  one keyset page of ledger entries joined to
--                               their transaction and account. The join lives in
--                               SQL because the alternative (fetch entries, then
--                               `.in(id, [1000 uuids])` for transactions and
--                               accounts) overflows the PostgREST request URL.
--                               It selects only the columns the export may carry
--                               - never accounts' or riders' bank details - and
--                               re-asserts the finance actor on every page, so a
--                               caller that skips admin_log_export() still cannot
--                               read the ledger without being finance.
--
-- The orders page reads by (created_at, id), served by orders_created_at_idx /
-- orders_status_created_at_idx from 0081.
--
-- TARGET TYPE. The CHECK on admin_audit_log.target_type is the unnamed inline
-- constraint from 0080, so Postgres named it admin_audit_log_target_type_check.
-- It is dropped and re-added with 'export' appended; the table stays
-- append-only (triggers and grants are untouched, and ALTER TABLE ... CONSTRAINT
-- is not a row UPDATE, so the append-only trigger is not involved). Every
-- existing row already satisfies the wider list.
--
-- DEPLOY. lock_timeout makes a blocked statement fail fast instead of queueing
-- writers behind it. On a populated production DB pre-build the index by hand
-- (outside a transaction), which makes the create below a no-op:
--   create index concurrently if not exists ledger_entries_created_at_id_idx on ledger_entries (created_at, id);
-- The constraint is re-added NOT VALID and validated separately, so the swap
-- holds its lock briefly and the full-table check runs under a lighter one.
--
-- INDEX. The ledger export reads "entries created in [from, to) ordered by
-- (created_at, id)". ledger_entries has only (transaction_id), (account_id),
-- (account_id, created_at desc) and the primary key, none of which can serve a
-- time-range scan across all accounts, so without this every page would
-- sequentially scan and sort the whole ledger. (created_at, id) is exactly the
-- keyset order, making each page an index range scan. transactions is reached
-- by primary key and accounts by primary key, so they need nothing.
--
-- Error codes: check_violation (23514) for a bad kind or filter payload,
-- insufficient_privilege (42501) for a non-finance actor on the ledger or an
-- inactive actor, P0001 for a non-admin actor (all from _assert_admin_actor).

set local lock_timeout = '5s';

-- Index first, so a failure here leaves admin_audit_log untouched.
create index if not exists ledger_entries_created_at_id_idx on ledger_entries (created_at, id);

alter table admin_audit_log drop constraint admin_audit_log_target_type_check;
alter table admin_audit_log add constraint admin_audit_log_target_type_check
  check (target_type in ('user', 'vendor', 'rider', 'rider_document', 'order', 'service_area', 'export')) not valid;
alter table admin_audit_log validate constraint admin_audit_log_target_type_check;

-- ---------------------------------------------------------------------------
-- admin_log_export
-- ---------------------------------------------------------------------------

create function admin_log_export(
  p_actor_id  uuid,
  p_kind      text,
  p_filters   jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export_id  uuid := uuid_generate_v7();
  v_from       date;
  v_to         date;
  v_details    jsonb;
begin
  if p_kind is null or p_kind not in ('orders', 'ledger') then
    raise exception 'admin_log_export: unknown export kind %', p_kind
      using errcode = 'check_violation';
  end if;

  perform _assert_admin_actor(
    'admin_log_export', p_actor_id,
    case p_kind when 'ledger' then 'finance' else 'admin' end
  );

  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then
    raise exception 'admin_log_export: filters must be a JSON object'
      using errcode = 'check_violation';
  end if;

  begin
    v_from := (p_filters ->> 'from')::date;
    v_to   := (p_filters ->> 'to')::date;
  exception when others then
    raise exception 'admin_log_export: from and to must be valid dates'
      using errcode = 'check_violation';
  end;

  if v_from is null or v_to is null or v_to < v_from or (v_to - v_from) + 1 > 92 then
    raise exception 'admin_log_export: the date range must be 1 to 92 days'
      using errcode = 'check_violation';
  end if;

  -- Only the keys the export understands are kept, so the audit row can never
  -- carry arbitrary caller-supplied JSON. status/vendor_id are orders-only.
  v_details := jsonb_build_object('kind', p_kind, 'from', v_from, 'to', v_to);

  if p_kind = 'orders' then
    begin
      v_details := v_details || jsonb_strip_nulls(jsonb_build_object(
        -- The enum cast rejects anything that is not a real order status, so a
        -- bad value raises instead of being audited as free text (null-safe).
        'status',    nullif(p_filters ->> 'status', '')::order_status,
        'vendor_id', (p_filters ->> 'vendor_id')::uuid
      ));
    exception when others then
      raise exception 'admin_log_export: status must be an order status and vendor_id a uuid'
        using errcode = 'check_violation';
    end;
  end if;

  perform _write_admin_audit(p_actor_id, 'export.' || p_kind, 'export', v_export_id, null, v_details);

  return v_export_id;
end;
$$;

comment on function admin_log_export(uuid, text, jsonb) is
  'Audits the start of a CSV export (action export.orders / export.ledger, target_type export, target_id a fresh uuid that is returned). The actor must be an admin for orders and finance for the ledger. service_role only, actor verified by _assert_admin_actor(). Call BEFORE streaming. Never grant to authenticated.';

revoke execute on function admin_log_export(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function admin_log_export(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- admin_export_orders_page
-- ---------------------------------------------------------------------------

create function admin_export_orders_page(
  p_actor_id         uuid,
  p_from             timestamptz,
  p_to               timestamptz,
  p_status           order_status default null,
  p_vendor_id        uuid default null,
  p_after_created_at timestamptz default null,
  p_after_id         uuid default null,
  p_limit            int default 1000
)
returns table (
  id                uuid,
  code              text,
  created_at        timestamptz,
  status            order_status,
  payment_status    text,
  vendor_id         uuid,
  vendor_name       text,
  customer_id       uuid,
  rider_id          uuid,
  subtotal_kobo     bigint,
  delivery_fee_kobo bigint,
  service_fee_kobo  bigint,
  discount_kobo     bigint,
  total_kobo        bigint,
  placed_at         timestamptz,
  delivered_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
-- The nullable status/vendor/cursor filters must be planned per call so the
-- created_at / (status, created_at) indexes are used, not a generic plan.
set plan_cache_mode = force_custom_plan
as $$
begin
  perform _assert_admin_actor('admin_export_orders_page', p_actor_id, 'admin');

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'admin_export_orders_page: an ascending time range is required'
      using errcode = 'check_violation';
  end if;

  -- The app sends at most 92 days as [from, to + 1 day); 93 leaves slack for that.
  if p_to - p_from > interval '93 days' then
    raise exception 'admin_export_orders_page: the time range is limited to 93 days'
      using errcode = 'check_violation';
  end if;

  -- A keyset cursor is the pair (created_at, id); half of it would silently
  -- fall back to "from the start" or compare against null.
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'admin_export_orders_page: the cursor needs both p_after_created_at and p_after_id'
      using errcode = 'check_violation';
  end if;

  return query
  select o.id, o.code, o.created_at, o.status, o.payment_status, o.vendor_id, v.name,
         o.customer_id, o.rider_id, o.subtotal_kobo, o.delivery_fee_kobo, o.service_fee_kobo,
         o.discount_kobo, o.total_kobo, o.placed_at, o.delivered_at
  from orders o
  join vendors v on v.id = o.vendor_id
  where o.created_at >= p_from
    and o.created_at <  p_to
    and (p_status is null or o.status = p_status)
    and (p_vendor_id is null or o.vendor_id = p_vendor_id)
    and (p_after_created_at is null or (o.created_at, o.id) > (p_after_created_at, p_after_id))
  order by o.created_at, o.id
  limit greatest(1, least(coalesce(p_limit, 1000), 2000));
end;
$$;

comment on function admin_export_orders_page(uuid, timestamptz, timestamptz, order_status, uuid, timestamptz, uuid, int) is
  'One keyset page (created_at, id) of orders in [p_from, p_to) with the vendor name and optional status/vendor filters, for the admin CSV export. No phone, address, email or delivery code. service_role only, admin actor verified on every call. Never grant to authenticated.';

revoke execute on function admin_export_orders_page(uuid, timestamptz, timestamptz, order_status, uuid, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function admin_export_orders_page(uuid, timestamptz, timestamptz, order_status, uuid, timestamptz, uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- admin_export_ledger_page
-- ---------------------------------------------------------------------------

create function admin_export_ledger_page(
  p_actor_id         uuid,
  p_from             timestamptz,
  p_to               timestamptz,
  p_after_created_at timestamptz default null,
  p_after_id         uuid default null,
  p_limit            int default 1000
)
returns table (
  id                    uuid,
  created_at            timestamptz,
  transaction_id        uuid,
  transaction_reference text,
  transaction_kind      text,
  entry_type            text,
  account_owner_type    text,
  account_kind          text,
  account_owner_id      uuid,
  direction             text,
  amount_kobo           bigint,
  order_code            text
)
language plpgsql
stable
security definer
set search_path = public
-- The nullable cursor ("p is null or (created_at, id) > (p, p)") must be planned
-- per call so the (created_at, id) index serves the keyset, not a generic plan.
set plan_cache_mode = force_custom_plan
as $$
begin
  perform _assert_admin_actor('admin_export_ledger_page', p_actor_id, 'finance');

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'admin_export_ledger_page: an ascending time range is required'
      using errcode = 'check_violation';
  end if;

  -- The app sends at most 92 days as [from, to + 1 day); 93 leaves slack for that.
  if p_to - p_from > interval '93 days' then
    raise exception 'admin_export_ledger_page: the time range is limited to 93 days'
      using errcode = 'check_violation';
  end if;

  -- A keyset cursor is the pair (created_at, id); half of it would silently
  -- fall back to "from the start" or compare against null.
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'admin_export_ledger_page: the cursor needs both p_after_created_at and p_after_id'
      using errcode = 'check_violation';
  end if;

  return query
  select le.id, le.created_at, le.transaction_id, t.reference, t.kind, le.entry_type,
         a.owner_type, a.kind, a.owner_id, le.direction, le.amount_kobo, o.code
  from ledger_entries le
  join transactions t on t.id = le.transaction_id
  join accounts a on a.id = le.account_id
  left join orders o on o.id = le.order_id
  where le.created_at >= p_from
    and le.created_at <  p_to
    and (p_after_created_at is null or (le.created_at, le.id) > (p_after_created_at, p_after_id))
  order by le.created_at, le.id
  limit greatest(1, least(coalesce(p_limit, 1000), 2000));
end;
$$;

comment on function admin_export_ledger_page(uuid, timestamptz, timestamptz, timestamptz, uuid, int) is
  'One keyset page (created_at, id) of ledger entries in [p_from, p_to) with transaction and account context, for the finance CSV export. No bank details. service_role only, finance actor verified on every call. Never grant to authenticated.';

revoke execute on function admin_export_ledger_page(uuid, timestamptz, timestamptz, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function admin_export_ledger_page(uuid, timestamptz, timestamptz, timestamptz, uuid, int) to service_role;
