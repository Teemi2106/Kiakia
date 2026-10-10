-- Expose actual rider payouts alongside current account balances.
--
-- `get_rider_earnings()` previously returned only live account balances. That
-- can answer "what is still owed" but not "what has already been paid out".
-- Payouts are ledger facts, so derive the total exclusively from debit entries
-- belonging to payout transactions; never infer it from orders or balances.

create or replace function get_rider_earnings()
returns table (
  account_kind  text,
  balance_kobo  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'get_rider_earnings: no authenticated caller';
  end if;

  return query
  with rider_accounts as (
    select a.id, a.kind
    from accounts a
    where a.owner_type = 'rider'
      and a.owner_id = auth.uid()
  )
  select ra.kind, coalesce(ab.balance_kobo, 0)::bigint
  from rider_accounts ra
  left join account_balances ab on ab.account_id = ra.id

  union all

  select 'disbursed'::text, sum(le.amount_kobo)::bigint
  from rider_accounts ra
  join ledger_entries le on le.account_id = ra.id
  join transactions t on t.id = le.transaction_id
  where le.direction = 'debit'
    and t.kind = 'payout'
  having count(*) > 0;
end;
$$;

comment on function get_rider_earnings() is
  'Returns the calling rider''s current account balances plus a synthetic disbursed row equal to actual debit entries on payout transactions. Every query is scoped to owner_type rider and owner_id auth.uid(); no order totals or client-supplied amounts are used.';

revoke execute on function get_rider_earnings() from public;
grant execute on function get_rider_earnings() to authenticated;
