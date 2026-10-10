-- KiaKia - paginated, ledger-derived rider earnings history.
--
-- get_rider_earnings() (0032_vendor_location_and_rider_reads.sql) returns
-- only the rider's current aggregate `available` balance - useful for "how
-- much do I have", useless for "what did I actually get paid for and when".
-- The rider app needs a per-delivery breakdown, and per this repo's own
-- money discipline (README's "RLS as defense-in-depth... never the
-- business-logic engine" and the ledger invariant, 0005_ledger.sql), that
-- breakdown must be derived from ledger_entries directly - never summed or
-- assembled client-side from orders.rider_fee_kobo, which is only ever the
-- AMOUNT ONCE OFFERED/ACCEPTED, not proof that a payout actually happened.
-- A cancelled-after-assignment order still has rider_fee_kobo set; it never
-- produces an escrow_release ledger entry, and correctly must not appear in
-- an "earnings" list.

-- ---------------------------------------------------------------------------
-- Index - ledger_entries (0005_ledger.sql) only has indexes on
-- transaction_id and account_id individually. This query scopes to one
-- account (via accounts.owner_type/owner_id/kind, resolved to a single
-- account_id first) and then orders by created_at desc - the existing
-- account_id index alone still leaves Postgres sorting every one of that
-- rider's ledger rows after the index scan. A composite (account_id,
-- created_at desc) index lets both the filter and the ORDER BY / LIMIT be
-- satisfied directly off the index, with no separate sort step, which is
-- what actually matters once a long-tenured rider has hundreds of entries.
-- ---------------------------------------------------------------------------

create index ledger_entries_account_id_created_at_idx on ledger_entries (account_id, created_at desc);

comment on index ledger_entries_account_id_created_at_idx is
  'Supports get_rider_earnings_history() (0054) and any future per-account paginated ledger read: filter by account_id, sort by created_at desc, with no separate sort step.';

-- ---------------------------------------------------------------------------
-- get_rider_earnings_history()
-- ---------------------------------------------------------------------------

create or replace function get_rider_earnings_history(
  p_limit  int default 20,
  p_offset int default 0
)
returns table (
  order_id      uuid,
  order_code    text,
  vendor_name   text,
  amount_kobo   bigint,
  delivered_at  timestamptz,
  created_at    timestamptz
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
    raise exception 'get_rider_earnings_history: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- Reject a negative offset outright rather than silently treating it as
  -- 0 - a caller passing a negative offset almost certainly has a paging
  -- bug worth surfacing, not a value worth papering over.
  if p_offset < 0 then
    raise exception 'get_rider_earnings_history: p_offset must not be negative'
      using errcode = 'check_violation';
  end if;

  -- One row per escrow-release CREDIT to the caller's own rider `available`
  -- account - never a caller-supplied amount, never orders.rider_fee_kobo.
  -- Scoped by owner_type = 'rider' and owner_id = auth.uid() in the query
  -- itself, exactly the way get_rider_earnings() (0032) does it - this can
  -- never return another rider's, a vendor's, or the platform's ledger
  -- entries regardless of how the function is called.
  return query
  select
    o.id,
    o.code,
    v.name,
    le.amount_kobo,
    o.delivered_at,
    le.created_at
  from ledger_entries le
  join accounts a on a.id = le.account_id
  join orders o on o.id = le.order_id
  join vendors v on v.id = o.vendor_id
  where a.owner_type = 'rider'
    and a.owner_id = v_caller
    and a.kind = 'available'
    and le.direction = 'credit'
    and le.entry_type = 'escrow_release'
  order by le.created_at desc
  -- Clamped server-side, same idiom get_wallet_transactions() (0045) uses
  -- for its own p_limit - a caller cannot ask for an unbounded scan by
  -- passing a huge or null p_limit.
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset p_offset;
end;
$$;

comment on function get_rider_earnings_history(int, int) is
  'The calling rider''s own per-delivery earnings history, newest first: one row per escrow-release credit to their `available` account (ledger_entries.entry_type = ''escrow_release'', direction = ''credit''), joined to the order for context. Never derived from orders.rider_fee_kobo (set at accept time, before any payout is guaranteed - a cancelled-after-assignment order has this set but never produces a ledger credit and correctly never appears here) and never trusts a caller-supplied amount. p_limit is clamped to [1, 100] server-side; p_offset must be >= 0. Scoped by owner_type = ''rider'' and owner_id = auth.uid() in the query itself, same posture as get_rider_earnings() (0032_vendor_location_and_rider_reads.sql).';

revoke execute on function get_rider_earnings_history(int, int) from public;
grant execute on function get_rider_earnings_history(int, int) to authenticated;
