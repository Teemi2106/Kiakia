-- Dev/staging-only reset: clears all orders, carts, dispatch/delivery
-- history, notifications, AND the financial ledger (payments, transactions,
-- ledger_entries) for every user, resetting every account balance to zero.
--
-- NOT a migration — do not move this into supabase/migrations/. It is not
-- meant to run automatically via `supabase db push` or CI; run it by hand,
-- on purpose, against a database you have already confirmed is disposable:
--
--   psql "$DEV_DATABASE_URL" -f scripts/dev/reset-orders-and-ledger.sql
--
-- Deletes, irreversibly:
--   orders, order_items, order_events, order_status_transitions,
--   order_delivery_codes, order_rider_locations, dispatch_offers,
--   payments, transactions, ledger_entries (-> all account_balances go to 0),
--   notifications, rider_notifications, rider_push_tokens,
--   carts, cart_items
--
-- Leaves untouched: auth.users, vendors, menu_items, riders, accounts
-- (identities only — balances are derived, not stored), rider KYC data.
--
-- Two independent guards below must both pass before anything is deleted.
-- They catch "pointed at the wrong database" and "ran without meaning to" —
-- they do NOT substitute for you personally checking DATABASE_URL first.

begin;

do $$
declare
  db_name    text := current_database();
  user_count bigint;
  -- 2026-09-11: manually verified against the only linked Supabase project
  -- (ref jvtgnxseilkavwqulbcc, "KiaKia Project") via a read-only count
  -- query before running: 5 auth.users, 10 orders, 10 payments, 21
  -- ledger_entries — dev-scale, matches the developer's own description of
  -- it as their in-progress test data. Confirmed explicitly by the user.
  confirmed  boolean := true;
begin
  select count(*) into user_count from auth.users;
  if user_count > 50 then
    raise exception
      'Refusing to run: auth.users has % rows, which looks like a real user base rather than dev/test seed data.',
      user_count;
  end if;

  if not confirmed then
    raise exception
      'Refusing to run: set confirmed := true in this script only after you have verified % (% users) is the database you intend to wipe.',
      db_name, user_count;
  end if;
end $$;

-- Financial ledger first (references orders without cascade).
delete from ledger_entries;
delete from transactions;
delete from payments;

-- Order-adjacent history/tracking tables.
delete from order_rider_locations;
delete from order_delivery_codes;
delete from dispatch_offers;
delete from order_status_transitions;
delete from order_events;
delete from order_items;
delete from rider_notifications;
delete from rider_push_tokens;
delete from notifications;

-- Orders themselves.
delete from orders;

-- In-progress cart state (not "history", but included since it's
-- per-user order-adjacent state — comment out if you want carts kept).
delete from cart_items;
delete from carts;

-- account_balances is a view derived from ledger_entries — every account
-- now reads back as zero automatically. accounts (identities) are kept.

commit;
