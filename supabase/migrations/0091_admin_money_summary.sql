-- KiaKia - admin money summary (Overview "Money" section).
--
-- One read-only, service_role-only RPC, admin_money_summary(p_from, p_to), that
-- answers the owner's money questions from the LEDGER ONLY (never from order
-- columns), so every figure reconciles with Finance and Payouts.
--
-- How the ledger encodes money (0010/0017/0045/0075/0020/0044/0057/0031/0081):
--   card / transfer paid   DR platform:gateway   CR platform:escrow          payment_capture
--   wallet spent           DR customer:wallet    CR platform:escrow          payment_capture
--   delivered (release)    DR platform:escrow    CR vendor / rider / platform:revenue   escrow_release
--   refund to wallet       DR platform:escrow    CR customer:wallet          refund
--   refund to card         DR platform:escrow    CR platform:gateway         refund
--   payout (bank transfer) DR vendor|rider:available  CR platform:gateway    payout
--   short card payment     DR platform:gateway   CR customer:wallet          refund (never touches escrow)
--   card overpayment       the excess is a CR customer:wallet 'refund' row beside the capture
-- The gateway account runs negative by design: it is "money in the bank".
--
-- Windowed figures (p_from <= created_at < p_to; either end may be null = open)
-- are flows summed by ledger entry time:
--   gross_processed_kobo   credits into escrow (payment_capture): the order value
--                          customers paid, whether the order is delivered, still
--                          in progress, or later refunded. Split card_kobo /
--                          wallet_kobo (wallet = customer:wallet debits on capture).
--   delivered_gmv_kobo     escrow debits entry_type escrow_release (= order totals
--                          released on delivery); delivered_orders counts them
--                          (one release per order, reference <code>-escrow).
--   platform_earnings_kobo net credits to platform:revenue (commission + the
--                          residual of service fee / delivery margin)
--   vendor_earned_kobo / rider_earned_kobo  escrow_release credits to the
--                          vendor / rider available accounts
--   refunded_*             escrow debits entry_type refund; gateway = the refund
--                          credited platform:gateway, wallet = the rest
--   paid_out_*_window_kobo payout debits on vendor / rider available accounts
-- Point-in-time figures ignore the window (right now, all history):
--   held_in_escrow_kobo       platform:escrow balance
--   owed_to_vendors/riders    sum of positive available balances (same basis as
--                             admin_list_payables, so Payouts agrees)
--   paid_out_to_*_kobo        all-time payout debits (as admin_list_balances'
--                             disbursed_kobo)
--   customer_wallet_float_kobo  sum of customer:wallet balances
-- Reconciliation (all time, not windowed):
--   captured = held + released shares + refunded, where released shares are the
--   escrow_release credits to vendors, riders and platform revenue. There are no
--   gateway fees in the ledger today, so no fee term. Also requires total debits
--   to equal total credits. difference_kobo is the left side minus the right.
--
-- Cost: one pass over ledger_entries grouped by account (the same scan class as
-- admin_list_balances / admin_list_payables / admin_ledger_health). No per-row
-- subqueries, no join to transactions (entry_type carries the meaning), no new
-- index: point-in-time balances need every entry, so an index would not avoid
-- the scan. At very large volume the fix is a materialised balance, not an index.

create function admin_money_summary(
  p_from  timestamptz default null,
  p_to    timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from  timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to    timestamptz := coalesce(p_to, 'infinity'::timestamptz);
  v_doc   jsonb;
begin
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'admin_money_summary: p_from must be before p_to'
      using errcode = 'check_violation';
  end if;

  with per_acct as (
    select le.account_id,
           sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end) as bal,
           sum(le.amount_kobo) filter (where le.direction = 'debit')  as debits_all,
           sum(le.amount_kobo) filter (where le.direction = 'credit') as credits_all,
           -- all time
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'payment_capture') as cr_capture_all,
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'escrow_release')  as cr_release_all,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'escrow_release')  as dr_release_all,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'refund')          as dr_refund_all,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'payout')          as dr_payout_all,
           -- in window
           sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end)
             filter (where le.created_at >= v_from and le.created_at < v_to)                                  as net_w,
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'payment_capture'
                                         and le.created_at >= v_from and le.created_at < v_to)               as cr_capture_w,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'payment_capture'
                                         and le.created_at >= v_from and le.created_at < v_to)               as dr_capture_w,
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'escrow_release'
                                         and le.created_at >= v_from and le.created_at < v_to)               as cr_release_w,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'escrow_release'
                                         and le.created_at >= v_from and le.created_at < v_to)               as dr_release_w,
           count(*)            filter (where le.direction = 'debit'  and le.entry_type = 'escrow_release'
                                         and le.created_at >= v_from and le.created_at < v_to)               as n_release_w,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'refund'
                                         and le.created_at >= v_from and le.created_at < v_to)               as dr_refund_w,
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'refund'
                                         and le.created_at >= v_from and le.created_at < v_to)               as cr_refund_w,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'payout'
                                         and le.created_at >= v_from and le.created_at < v_to)               as dr_payout_w
    from ledger_entries le
    group by le.account_id
  ),
  roll as (
    select a.owner_type, a.kind, pa.*
    from per_acct pa
    join accounts a on a.id = pa.account_id
  ),
  agg as (
    select
      coalesce(sum(cr_capture_w)  filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as processed_w,
      coalesce(sum(dr_capture_w)  filter (where owner_type = 'customer' and kind = 'wallet'), 0)  as wallet_paid_w,
      coalesce(sum(dr_release_w)  filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as gmv_w,
      coalesce(sum(n_release_w)   filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as orders_w,
      coalesce(sum(net_w)         filter (where owner_type = 'platform' and kind = 'revenue'), 0) as platform_w,
      coalesce(sum(cr_release_w)  filter (where owner_type = 'vendor' and kind = 'available'), 0) as vendor_w,
      coalesce(sum(cr_release_w)  filter (where owner_type = 'rider' and kind = 'available'), 0)  as rider_w,
      coalesce(sum(dr_refund_w)   filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as refunded_w,
      coalesce(sum(cr_refund_w)   filter (where owner_type = 'platform' and kind = 'gateway'), 0) as refunded_gateway_w,
      coalesce(sum(dr_payout_w)   filter (where owner_type = 'vendor' and kind = 'available'), 0) as payout_vendor_w,
      coalesce(sum(dr_payout_w)   filter (where owner_type = 'rider' and kind = 'available'), 0)  as payout_rider_w,

      coalesce(sum(bal)           filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as held,
      coalesce(sum(greatest(bal, 0)) filter (where owner_type = 'vendor' and kind = 'available'), 0) as owed_vendors,
      coalesce(sum(greatest(bal, 0)) filter (where owner_type = 'rider' and kind = 'available'), 0)  as owed_riders,
      coalesce(sum(dr_payout_all) filter (where owner_type = 'vendor' and kind = 'available'), 0) as paid_vendors,
      coalesce(sum(dr_payout_all) filter (where owner_type = 'rider' and kind = 'available'), 0)  as paid_riders,
      coalesce(sum(bal)           filter (where owner_type = 'customer' and kind = 'wallet'), 0)  as wallet_float,

      coalesce(sum(cr_capture_all) filter (where owner_type = 'platform' and kind = 'escrow'), 0) as captured_all,
      coalesce(sum(dr_refund_all)  filter (where owner_type = 'platform' and kind = 'escrow'), 0) as refunded_all,
      coalesce(sum(cr_release_all) filter (where (owner_type in ('vendor', 'rider') and kind = 'available')
                                              or (owner_type = 'platform' and kind = 'revenue')), 0) as shares_all,
      coalesce(sum(dr_release_all) filter (where owner_type = 'platform' and kind = 'escrow'), 0) as escrow_released_all,
      coalesce(sum(debits_all), 0)  as debits_all,
      coalesce(sum(credits_all), 0) as credits_all
    from roll
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'gross_processed_kobo', processed_w::bigint,
    'gross_processed_card_kobo', (processed_w - wallet_paid_w)::bigint,
    'gross_processed_wallet_kobo', wallet_paid_w::bigint,
    'delivered_gmv_kobo', gmv_w::bigint,
    'delivered_orders', orders_w::bigint,
    'platform_earnings_kobo', platform_w::bigint,
    'vendor_earned_kobo', vendor_w::bigint,
    'rider_earned_kobo', rider_w::bigint,
    'refunded_kobo', refunded_w::bigint,
    'refunded_gateway_kobo', refunded_gateway_w::bigint,
    'refunded_wallet_kobo', (refunded_w - refunded_gateway_w)::bigint,
    'paid_out_to_vendors_window_kobo', payout_vendor_w::bigint,
    'paid_out_to_riders_window_kobo', payout_rider_w::bigint,
    'held_in_escrow_kobo', held::bigint,
    'owed_to_vendors_kobo', owed_vendors::bigint,
    'owed_to_riders_kobo', owed_riders::bigint,
    'paid_out_to_vendors_kobo', paid_vendors::bigint,
    'paid_out_to_riders_kobo', paid_riders::bigint,
    'customer_wallet_float_kobo', wallet_float::bigint,
    'reconciliation', jsonb_build_object(
      'captured_kobo', captured_all::bigint,
      'held_kobo', held::bigint,
      'released_kobo', shares_all::bigint,
      'refunded_kobo', refunded_all::bigint,
      'difference_kobo', (captured_all - held - shares_all - refunded_all)::bigint,
      'ledger_debit_kobo', debits_all::bigint,
      'ledger_credit_kobo', credits_all::bigint,
      'reconciles', (captured_all - held - shares_all - refunded_all) = 0 and debits_all = credits_all
    )
  )
  into v_doc
  from agg;

  return v_doc;
end;
$$;

comment on function admin_money_summary(timestamptz, timestamptz) is
  'Owner-facing money summary derived only from the ledger, as one jsonb document: flows for the window [p_from, p_to) (null = open): gross processed (card + wallet), delivered GMV/orders, platform earnings, vendor/rider earned, refunds split gateway/wallet, payouts; and point-in-time figures: held in escrow, owed to vendors/riders, paid out, customer wallet float. Includes a reconciliation block: captured = held + released shares + refunded, and debits = credits. service_role only.';

revoke execute on function admin_money_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function admin_money_summary(timestamptz, timestamptz) to service_role;
