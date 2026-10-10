-- KiaKia - data-loss recovery, not a schema or logic change.
--
-- order_status_transitions (0006_transition_order.sql) is the state
-- machine's explicit allowed-edges table - the SQL twin of
-- packages/domain/src/order-state-machine.ts's ALLOWED_TRANSITIONS,
-- consulted by transition_order() on every single status change. It was
-- found completely empty on the live project this session, while
-- discovering why a real customer's payment capture failed with "illegal
-- transition draft -> placed" - capture_payment() calls transition_order()
-- internally, so with this table empty, EVERY order transition for EVERY
-- actor type was failing, not just this one payment. Not something any
-- migration in this repo did (0006 is the only migration that has ever
-- written to this table, and nothing since has touched it) - it was wiped
-- by whatever cleared orders/dispatch_offers/order_events/carts/cart_items/
-- ledger_entries/transactions on the live project between sessions. This
-- table's name starting with "order_" makes it an easy table to have
-- accidentally swept up in a "clear all the order test data" cleanup,
-- even though it holds reference data, not a transactional record.
--
-- Reproduces 0006's own insert byte-for-byte, with `on conflict do nothing`
-- so this is safe to run against ANY environment regardless of whether
-- these rows are already present (a fresh `supabase db reset` replaying
-- every migration from 0001 already has them from 0006 itself - this
-- migration is a no-op there. It only does real work on an environment,
-- like this one, where they went missing after the fact).

insert into order_status_transitions (from_status, to_status) values
  ('draft',             'placed'),
  ('placed',            'accepted'),
  ('placed',            'rejected_by_vendor'),
  ('placed',            'cancelled_by_customer'),
  ('placed',            'cancelled_by_platform'),
  ('accepted',          'preparing'),
  ('accepted',          'cancelled_by_platform'),
  ('preparing',         'ready_for_pickup'),
  ('preparing',         'cancelled_by_platform'),
  ('ready_for_pickup',  'rider_assigned'),
  ('ready_for_pickup',  'cancelled_by_platform'),
  ('rider_assigned',    'picked_up'),
  ('rider_assigned',    'cancelled_by_platform'),
  ('picked_up',         'in_transit'),
  ('picked_up',         'cancelled_by_platform'),
  ('in_transit',        'arrived'),
  ('in_transit',        'cancelled_by_platform'),
  ('arrived',           'delivered'),
  ('arrived',           'failed_delivery'),
  ('arrived',           'cancelled_by_platform')
on conflict (from_status, to_status) do nothing;
