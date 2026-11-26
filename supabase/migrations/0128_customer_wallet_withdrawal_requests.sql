-- Customer wallet withdrawals start as requests, not provider transfers.
-- A finance admin reviews each request and records the bank reference only
-- after the manual transfer has actually been made. Pending and approved
-- requests reserve wallet value until they are cancelled, rejected, or paid.

create table customer_wallet_withdrawal_requests (
  id                    uuid primary key default uuid_generate_v7(),
  customer_id           uuid not null references profiles (id),
  wallet_account_id     uuid not null references accounts (id),
  amount_kobo           bigint not null check (amount_kobo > 0),
  bank_name             text not null check (char_length(bank_name) between 2 and 80),
  account_name          text not null check (char_length(account_name) between 2 and 100),
  account_number        text not null check (account_number ~ '^\d{10}$'),
  status                text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected', 'cancelled', 'paid')),
  idempotency_key       uuid not null,
  external_reference    text,
  review_reason         text,
  reviewed_by           uuid references profiles (id),
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (customer_id, idempotency_key)
);

comment on table customer_wallet_withdrawal_requests is
  'Customer-initiated wallet cash-out requests. The bank destination is available only through service-role finance RPCs; authenticated customers can read their own masked request history. Pending and approved amounts are reservations, not completed payouts.';

create index customer_wallet_withdrawals_customer_created_idx
  on customer_wallet_withdrawal_requests (customer_id, created_at desc);
create index customer_wallet_withdrawals_open_idx
  on customer_wallet_withdrawal_requests (created_at asc)
  where status in ('pending', 'approved');
create unique index customer_wallet_withdrawals_external_reference_idx
  on customer_wallet_withdrawal_requests (external_reference)
  where external_reference is not null;

alter table customer_wallet_withdrawal_requests enable row level security;
revoke all on customer_wallet_withdrawal_requests from public, anon, authenticated;
grant select, insert, update on customer_wallet_withdrawal_requests to service_role;

-- Internal balance after pending/approved withdrawal reservations. Callers
-- that mutate money lock the wallet account row before consulting this value.
create function _customer_wallet_available_balance(p_wallet_account_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_reserved bigint;
begin
  if not exists (
    select 1 from accounts
    where id = p_wallet_account_id and owner_type = 'customer' and kind = 'wallet'
  ) then
    raise exception '_customer_wallet_available_balance: customer wallet account is required';
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
  into v_balance
  from ledger_entries
  where account_id = p_wallet_account_id;

  select coalesce(sum(amount_kobo), 0)
  into v_reserved
  from customer_wallet_withdrawal_requests
  where wallet_account_id = p_wallet_account_id and status in ('pending', 'approved');

  if v_balance < v_reserved then
    raise exception '_customer_wallet_available_balance: wallet reservations exceed the ledger balance'
      using errcode = 'check_violation';
  end if;

  return v_balance - v_reserved;
end;
$$;

comment on function _customer_wallet_available_balance(uuid) is
  'Internal. Returns the customer wallet ledger balance minus pending and approved withdrawal requests. The account id must be locked by every mutating caller first.';
revoke all on function _customer_wallet_available_balance(uuid) from public, anon, authenticated, service_role;

-- Extend the ledger backstop so all wallet debit paths, including older
-- checkout RPCs, are prevented from spending funds already reserved for cash-out.
create or replace function check_customer_wallet_not_negative()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_reserved bigint;
begin
  if not exists (
    select 1 from accounts
    where id = new.account_id and owner_type = 'customer' and kind = 'wallet'
  ) then
    return new;
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
  into v_balance
  from ledger_entries
  where account_id = new.account_id;

  select coalesce(sum(amount_kobo), 0)
  into v_reserved
  from customer_wallet_withdrawal_requests
  where wallet_account_id = new.account_id and status in ('pending', 'approved');

  if v_balance < v_reserved then
    raise exception
      'Customer wallet account % has % kobo available after % kobo of pending withdrawals; debit would overdraw reserved funds',
      new.account_id, v_balance - v_reserved, v_reserved
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function check_customer_wallet_not_negative() is
  'Deferred ledger invariant: a customer wallet must cover all pending and approved withdrawal reservations after any ledger write.';

-- Keep the existing customer-facing RPC, but return spendable balance. The
-- account balance remains ledger-derived; reservations are shown separately.
create or replace function get_wallet_balance()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_wallet_account_id uuid;
begin
  if v_caller is null then
    raise exception 'get_wallet_balance: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_wallet_account_id
  from accounts
  where owner_type = 'customer' and owner_id = v_caller and kind = 'wallet';

  if v_wallet_account_id is null then
    return 0;
  end if;

  return _customer_wallet_available_balance(v_wallet_account_id);
end;
$$;

comment on function get_wallet_balance() is
  'The calling customer''s spendable wallet balance in kobo, derived from the ledger less pending and approved cash-out reservations. Takes no arguments, so it cannot read another user''s wallet.';
revoke execute on function get_wallet_balance() from public, anon;
grant execute on function get_wallet_balance() to authenticated, service_role;

create function get_wallet_reserved_balance()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_reserved bigint;
begin
  if v_caller is null then
    raise exception 'get_wallet_reserved_balance: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(r.amount_kobo), 0)
  into v_reserved
  from customer_wallet_withdrawal_requests r
  where r.customer_id = v_caller and r.status in ('pending', 'approved');

  return v_reserved;
end;
$$;

comment on function get_wallet_reserved_balance() is
  'Returns only the calling customer''s wallet funds reserved by pending or approved withdrawal requests.';
revoke execute on function get_wallet_reserved_balance() from public, anon;
grant execute on function get_wallet_reserved_balance() to authenticated, service_role;

create function get_my_wallet_withdrawal_requests()
returns table (
  id uuid,
  amount_kobo bigint,
  bank_name text,
  account_name text,
  masked_account_number text,
  status text,
  review_reason text,
  created_at timestamptz,
  reviewed_at timestamptz,
  external_reference text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'get_my_wallet_withdrawal_requests: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select r.id, r.amount_kobo, r.bank_name, r.account_name,
         repeat('•', greatest(char_length(r.account_number) - 4, 0)) || right(r.account_number, 4),
         r.status, r.review_reason, r.created_at, r.reviewed_at, r.external_reference
  from customer_wallet_withdrawal_requests r
  where r.customer_id = v_caller
  order by r.created_at desc
  limit 30;
end;
$$;

comment on function get_my_wallet_withdrawal_requests() is
  'Masked status history for the calling customer. Full bank account numbers are never returned by customer-facing reads.';
revoke execute on function get_my_wallet_withdrawal_requests() from public, anon;
grant execute on function get_my_wallet_withdrawal_requests() to authenticated, service_role;

create function request_customer_wallet_withdrawal(
  p_amount_kobo bigint,
  p_bank_name text,
  p_account_name text,
  p_account_number text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_wallet_account_id uuid;
  v_available bigint;
  v_bank_name text := btrim(coalesce(p_bank_name, ''));
  v_account_name text := btrim(coalesce(p_account_name, ''));
  v_account_number text := btrim(coalesce(p_account_number, ''));
  v_existing customer_wallet_withdrawal_requests;
  v_request_id uuid;
begin
  if v_caller is null then
    raise exception 'request_customer_wallet_withdrawal: authentication required'
      using errcode = 'insufficient_privilege';
  end if;
  perform _assert_active_caller();

  if p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'Enter a withdrawal amount greater than zero.' using errcode = 'check_violation';
  end if;
  if p_idempotency_key is null then
    raise exception 'A request key is required.' using errcode = 'check_violation';
  end if;
  if char_length(v_bank_name) not between 2 and 80
    or v_bank_name !~ '^[[:alnum:] &.''()/-]+$' then
    raise exception 'Enter a valid bank name.' using errcode = 'check_violation';
  end if;
  if char_length(v_account_name) not between 2 and 100
    or v_account_name !~ '^[[:alpha:]][[:alpha:] .''-]*$' then
    raise exception 'Enter a valid account holder name.' using errcode = 'check_violation';
  end if;
  if v_account_number !~ '^\d{10}$' then
    raise exception 'Enter a 10-digit Nigerian bank account number.' using errcode = 'check_violation';
  end if;

  v_wallet_account_id := _customer_wallet_account_id(v_caller);
  perform 1 from accounts where id = v_wallet_account_id for update;

  select * into v_existing
  from customer_wallet_withdrawal_requests
  where customer_id = v_caller and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.amount_kobo = p_amount_kobo
      and v_existing.bank_name = v_bank_name
      and v_existing.account_name = v_account_name
      and v_existing.account_number = v_account_number then
      return v_existing.id;
    end if;
    raise exception 'This request key was already used. Refresh the wallet and submit again.'
      using errcode = 'unique_violation';
  end if;

  v_available := _customer_wallet_available_balance(v_wallet_account_id);
  if p_amount_kobo > v_available then
    raise exception 'The requested amount is higher than the available wallet balance.'
      using errcode = 'check_violation';
  end if;

  insert into customer_wallet_withdrawal_requests (
    customer_id, wallet_account_id, amount_kobo, bank_name, account_name,
    account_number, idempotency_key
  ) values (
    v_caller, v_wallet_account_id, p_amount_kobo, v_bank_name, v_account_name,
    v_account_number, p_idempotency_key
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

comment on function request_customer_wallet_withdrawal(bigint, text, text, text, uuid) is
  'Creates an idempotent, pending manual withdrawal request for auth.uid(). Locks the caller''s wallet account and reserves only the amount supported by the ledger-derived spendable balance. Full bank details are stored in a service-role-only table.';
revoke execute on function request_customer_wallet_withdrawal(bigint, text, text, text, uuid) from public, anon;
grant execute on function request_customer_wallet_withdrawal(bigint, text, text, text, uuid) to authenticated;

create function cancel_my_wallet_withdrawal(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_wallet_account_id uuid;
  v_status text;
begin
  if v_caller is null then
    raise exception 'cancel_my_wallet_withdrawal: authentication required'
      using errcode = 'insufficient_privilege';
  end if;
  perform _assert_active_caller();

  select wallet_account_id into v_wallet_account_id
  from customer_wallet_withdrawal_requests
  where id = p_request_id and customer_id = v_caller;
  if v_wallet_account_id is null then
    raise exception 'Withdrawal request not found.' using errcode = 'no_data_found';
  end if;

  perform 1 from accounts where id = v_wallet_account_id for update;

  select status into v_status
  from customer_wallet_withdrawal_requests
  where id = p_request_id and customer_id = v_caller
  for update;

  if v_status = 'cancelled' then
    return true;
  end if;
  if v_status <> 'pending' then
    raise exception 'Only pending requests can be cancelled.' using errcode = 'check_violation';
  end if;

  update customer_wallet_withdrawal_requests
  set status = 'cancelled', updated_at = now()
  where id = p_request_id;
  return true;
end;
$$;

comment on function cancel_my_wallet_withdrawal(uuid) is
  'Cancels only the calling customer''s pending request and releases its reservation. Approved, rejected, paid, or other customers'' requests cannot be changed by this RPC.';
revoke execute on function cancel_my_wallet_withdrawal(uuid) from public, anon;
grant execute on function cancel_my_wallet_withdrawal(uuid) to authenticated;

create function admin_list_customer_wallet_withdrawals(
  p_actor_id uuid,
  p_status text default 'open',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  customer_id uuid,
  customer_name text,
  amount_kobo bigint,
  bank_name text,
  account_name text,
  account_number text,
  masked_account_number text,
  status text,
  review_reason text,
  external_reference text,
  created_at timestamptz,
  reviewed_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform _assert_admin_actor('admin_list_customer_wallet_withdrawals', p_actor_id, 'finance');
  if p_status is null or p_status not in ('open', 'all') then
    raise exception 'Status must be open or all.' using errcode = 'check_violation';
  end if;
  if p_limit not between 1 and 100 or p_offset < 0 then
    raise exception 'Limit must be 1-100 and offset must be non-negative.' using errcode = 'check_violation';
  end if;

  return query
  with matching as (
    select r.id, r.customer_id, p.full_name, r.amount_kobo, r.bank_name,
           r.account_name, r.account_number,
           repeat('•', greatest(char_length(r.account_number) - 4, 0)) || right(r.account_number, 4) as masked_number,
           r.status, r.review_reason, r.external_reference, r.created_at, r.reviewed_at,
           count(*) over ()::bigint as total_count
    from customer_wallet_withdrawal_requests r
    join profiles p on p.id = r.customer_id
    where p_status = 'all' or r.status in ('pending', 'approved')
  )
  select m.id, m.customer_id, m.full_name, m.amount_kobo, m.bank_name,
         m.account_name, m.account_number, m.masked_number, m.status,
         m.review_reason, m.external_reference, m.created_at, m.reviewed_at, m.total_count
  from matching m
  order by m.created_at asc
  limit p_limit offset p_offset;
end;
$$;

comment on function admin_list_customer_wallet_withdrawals(uuid, text, integer, integer) is
  'Lists customer withdrawal requests for active superadmins and finance admins. The server-action caller must use the service-role client; this is the only RPC that returns full bank destination details.';
revoke execute on function admin_list_customer_wallet_withdrawals(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function admin_list_customer_wallet_withdrawals(uuid, text, integer, integer) to service_role;

create function admin_review_customer_wallet_withdrawal(
  p_request_id uuid,
  p_decision text,
  p_external_reference text,
  p_reason text,
  p_actor_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request customer_wallet_withdrawal_requests;
  v_wallet_account_id uuid;
  v_gateway_account_id uuid;
  v_transaction_id uuid;
  v_external_reference text := btrim(coalesce(p_external_reference, ''));
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
begin
  perform _assert_admin_actor('admin_review_customer_wallet_withdrawal', p_actor_id, 'finance');
  if p_request_id is null or p_decision is null or p_decision not in ('approve', 'reject', 'mark_paid') then
    raise exception 'Choose a valid withdrawal review action.' using errcode = 'check_violation';
  end if;

  select wallet_account_id into v_wallet_account_id
  from customer_wallet_withdrawal_requests
  where id = p_request_id;
  if v_wallet_account_id is null then
    raise exception 'Withdrawal request not found.' using errcode = 'no_data_found';
  end if;

  perform 1 from accounts where id = v_wallet_account_id for update;
  select * into v_request
  from customer_wallet_withdrawal_requests
  where id = p_request_id
  for update;

  if p_decision = 'approve' then
    if v_request.status = 'approved' then return 'approved'; end if;
    if v_request.status <> 'pending' then
      raise exception 'Only pending withdrawal requests can be approved.' using errcode = 'check_violation';
    end if;
    update customer_wallet_withdrawal_requests
    set status = 'approved', review_reason = nullif(v_reason, ''),
        reviewed_by = p_actor_id, reviewed_at = now(), updated_at = now()
    where id = p_request_id;
    perform _write_admin_audit(p_actor_id, 'wallet.withdrawal.approved', 'customer_wallet_withdrawal', p_request_id,
      nullif(v_reason, ''), jsonb_build_object('amount_kobo', v_request.amount_kobo, 'customer_id', v_request.customer_id));
    return 'approved';
  end if;

  if p_decision = 'reject' then
    if v_request.status = 'rejected' then return 'rejected'; end if;
    if v_request.status not in ('pending', 'approved') then
      raise exception 'Only open withdrawal requests can be rejected.' using errcode = 'check_violation';
    end if;
    if v_reason = '' then
      raise exception 'Add a short reason before rejecting this request.' using errcode = 'check_violation';
    end if;
    update customer_wallet_withdrawal_requests
    set status = 'rejected', review_reason = v_reason,
        reviewed_by = p_actor_id, reviewed_at = now(), updated_at = now()
    where id = p_request_id;
    perform _write_admin_audit(p_actor_id, 'wallet.withdrawal.rejected', 'customer_wallet_withdrawal', p_request_id,
      v_reason, jsonb_build_object('amount_kobo', v_request.amount_kobo, 'customer_id', v_request.customer_id));
    return 'rejected';
  end if;

  if v_request.status = 'paid' then
    if v_external_reference = v_request.external_reference then return 'paid'; end if;
    raise exception 'This request was already marked paid with a different bank reference.' using errcode = 'unique_violation';
  end if;
  if v_request.status <> 'approved' then
    raise exception 'Approve the request before marking it as paid.' using errcode = 'check_violation';
  end if;
  if v_external_reference !~ '^[[:alnum:]._-]{3,100}$' then
    raise exception 'Enter the bank transfer reference (3-100 letters, numbers, dots, dashes, or underscores).' using errcode = 'check_violation';
  end if;

  select id into v_gateway_account_id
  from accounts
  where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  if v_gateway_account_id is null then
    raise exception 'The platform gateway account is not seeded.';
  end if;

  insert into transactions (kind, reference, description)
  values ('payout', 'customer-withdrawal-' || p_request_id::text, 'Customer wallet withdrawal; bank reference ' || v_external_reference)
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
  values
    (v_transaction_id, v_wallet_account_id, 'debit', v_request.amount_kobo, 'payout'),
    (v_transaction_id, v_gateway_account_id, 'credit', v_request.amount_kobo, 'payout');

  update customer_wallet_withdrawal_requests
  set status = 'paid', external_reference = v_external_reference,
      review_reason = nullif(v_reason, ''), reviewed_by = p_actor_id,
      reviewed_at = now(), updated_at = now()
  where id = p_request_id;

  perform _write_admin_audit(p_actor_id, 'wallet.withdrawal.paid', 'customer_wallet_withdrawal', p_request_id,
    nullif(v_reason, ''), jsonb_build_object(
      'amount_kobo', v_request.amount_kobo,
      'customer_id', v_request.customer_id,
      'bank_reference', v_external_reference,
      'bank_account_last_four', right(v_request.account_number, 4)
    ));
  return 'paid';
end;
$$;

comment on function admin_review_customer_wallet_withdrawal(uuid, text, text, text, uuid) is
  'Finance-only audited review. Approval keeps funds reserved; rejection releases them. mark_paid is available only after approval, requires a bank reference, and atomically records the wallet debit and completed manual payout. Does not initiate a Monnify transfer.';
revoke execute on function admin_review_customer_wallet_withdrawal(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function admin_review_customer_wallet_withdrawal(uuid, text, text, text, uuid) to service_role;

-- The ledger trigger evaluates at commit, after status changes and ledger
-- entries in the same transaction, so marking a request paid replaces its
-- reservation with the matching wallet debit atomically.
