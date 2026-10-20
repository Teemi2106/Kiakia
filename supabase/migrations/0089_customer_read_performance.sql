-- KiaKia - customer read-path performance.
--
-- Three things, all read-side, none of which changes what any caller may see:
--
--   1. RLS initplan rewrite. Every customer-facing policy compared a column to
--      a bare `auth.uid()`. auth.uid() is STABLE, not constant, so the planner
--      cannot hoist it: it is re-evaluated for every candidate row (and, in the
--      menu / order policies, for every row of the nested vendor_staff
--      sub-select too). Written as `(select auth.uid())` it becomes an
--      InitPlan evaluated once per statement. Supabase's own RLS performance
--      guidance is this exact rewrite.
--
--      The rewrite is done with ALTER POLICY, which swaps the USING / WITH
--      CHECK expressions of a policy in place and atomically: there is no
--      instant at which a policy is missing (a DROP + CREATE pair would be
--      safe too inside this transaction, but ALTER is strictly tighter). The
--      command (FOR ...), the role list (PUBLIC, as in 0007) and the
--      permissive/restrictive flavour are untouched. Each expression below is
--      the original one with only `auth.uid()` -> `(select auth.uid())`; the
--      accompanying pgTAP file (supabase/tests/customer_bootstrap.sql) keeps
--      the cross-user deny assertions as a guard.
--
--      No policy here calls a helper function (is_vendor_staff / has_role do
--      not exist; membership is an inline EXISTS on vendor_staff), so there is
--      no function volatility to fix. Rider-only tables (riders,
--      dispatch_offers, rider_*) have the same bare pattern but are off the
--      customer hot path and are left for a rider-side pass.
--
--   2. Indexes for the real customer query shapes (derived from the
--      .from(...) calls in apps/web/src). Already covered, so NOT re-added:
--      carts (customer_id) where status='open' is already a partial UNIQUE
--      index (0004 carts_one_open_per_customer: one open cart per customer is
--      an invariant); cart_items(cart_id); addresses(customer_id) plus the
--      partial unique on is_default; order_items(order_id);
--      order_events(order_id, at); menu_items/menu_categories (vendor_id);
--      vendors (slug unique, status filter is on a tiny table).
--      Added:
--        - notifications unread, customer and vendor: the bell badge runs
--          `count(*) where customer_id|vendor_id = $1 and is_read = false` on
--          every page. The existing (id, created_at desc) indexes cannot
--          filter is_read, so the count walks every notification the user has
--          ever received. A partial index holds only unread rows (small and
--          self-pruning as they are read).
--      Considered and NOT added: orders (customer_id, created_at desc). With
--      ~20 orders per customer on 60k seeded orders the planner kept using
--      orders_customer_id_idx plus a tiny sort (0.25 ms), so the composite
--      bought nothing measurable; revisit when a customer has thousands of
--      orders.
--
--      Deploy: lock_timeout makes a blocked CREATE INDEX fail fast. On a
--      populated production DB, pre-build outside a transaction so CONCURRENTLY
--      works; the statements below are then no-ops:
--        create index concurrently if not exists notifications_customer_unread_idx on notifications (customer_id) where is_read = false;
--        create index concurrently if not exists notifications_vendor_unread_idx on notifications (vendor_id) where is_read = false;
--
--   3. customer_bootstrap() - the one read every customer page needs (open
--      cart with items, unread notification count, default address) in a
--      single round trip instead of three-plus. SECURITY INVOKER, so every
--      table it touches is still filtered by the caller's own RLS; it also
--      scopes to (select auth.uid()) explicitly.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. RLS rewrite (semantics identical; only auth.uid() -> (select auth.uid())).
-- ---------------------------------------------------------------------------

-- profiles
alter policy "read own profile" on profiles
  using (id = (select auth.uid()));
alter policy "update own profile" on profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- user_roles
alter policy "read own roles" on user_roles
  using (user_id = (select auth.uid()));

-- addresses
alter policy "manage own addresses" on addresses
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

-- carts / cart_items
alter policy "manage own cart" on carts
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

alter policy "manage own cart items" on cart_items
  using (exists (
    select 1 from carts where carts.id = cart_items.cart_id and carts.customer_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from carts where carts.id = cart_items.cart_id and carts.customer_id = (select auth.uid())
  ));

-- notifications (customer + vendor-staff scopes)
alter policy "read own notifications" on notifications
  using (customer_id = (select auth.uid()));
alter policy "update own notifications" on notifications
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));
alter policy "vendor staff read vendor notifications" on notifications
  using (exists (
    select 1 from vendor_staff
    where vendor_staff.vendor_id = notifications.vendor_id and vendor_staff.user_id = (select auth.uid())
  ));
alter policy "vendor staff update vendor notifications" on notifications
  using (exists (
    select 1 from vendor_staff
    where vendor_staff.vendor_id = notifications.vendor_id and vendor_staff.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from vendor_staff
    where vendor_staff.vendor_id = notifications.vendor_id and vendor_staff.user_id = (select auth.uid())
  ));

-- orders / order_items / order_events
alter policy "customer reads own orders" on orders
  using (customer_id = (select auth.uid()));
alter policy "vendor staff read their vendor orders" on orders
  using (exists (
    select 1 from vendor_staff
    where vendor_staff.vendor_id = orders.vendor_id and vendor_staff.user_id = (select auth.uid())
  ));
alter policy "assigned rider reads that order" on orders
  using (rider_id = (select auth.uid()));

alter policy "read items of visible orders" on order_items
  using (exists (
    select 1 from orders
    where orders.id = order_items.order_id
      and (
        orders.customer_id = (select auth.uid())
        or orders.rider_id = (select auth.uid())
        or exists (
          select 1 from vendor_staff
          where vendor_staff.vendor_id = orders.vendor_id and vendor_staff.user_id = (select auth.uid())
        )
      )
  ));

alter policy "read events of visible orders" on order_events
  using (exists (
    select 1 from orders
    where orders.id = order_events.order_id
      and (
        orders.customer_id = (select auth.uid())
        or orders.rider_id = (select auth.uid())
        or exists (
          select 1 from vendor_staff
          where vendor_staff.vendor_id = orders.vendor_id and vendor_staff.user_id = (select auth.uid())
        )
      )
  ));

-- vendors / vendor_staff ("public read active vendors" has no auth.uid())
alter policy "staff read own vendor" on vendors
  using (exists (
    select 1 from vendor_staff
    where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = (select auth.uid())
  ));
alter policy "staff read own membership" on vendor_staff
  using (user_id = (select auth.uid()));

-- menu catalogue
alter policy "read menu of visible vendors" on menu_categories
  using (exists (
    select 1 from vendors
    where vendors.id = menu_categories.vendor_id
      and (vendors.status = 'active' or exists (
        select 1 from vendor_staff
        where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = (select auth.uid())
      ))
  ));
alter policy "read items of visible vendors" on menu_items
  using (exists (
    select 1 from vendors
    where vendors.id = menu_items.vendor_id
      and (vendors.status = 'active' or exists (
        select 1 from vendor_staff
        where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = (select auth.uid())
      ))
  ));
alter policy "read option groups of visible items" on option_groups
  using (exists (
    select 1 from menu_items
    join vendors on vendors.id = menu_items.vendor_id
    where menu_items.id = option_groups.menu_item_id
      and (vendors.status = 'active' or exists (
        select 1 from vendor_staff
        where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = (select auth.uid())
      ))
  ));
alter policy "read options of visible groups" on options
  using (exists (
    select 1 from option_groups
    join menu_items on menu_items.id = option_groups.menu_item_id
    join vendors on vendors.id = menu_items.vendor_id
    where option_groups.id = options.group_id
      and (vendors.status = 'active' or exists (
        select 1 from vendor_staff
        where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = (select auth.uid())
      ))
  ));

-- other customer-owned reads
alter policy "customer reads own order ratings" on order_ratings
  using (customer_id = (select auth.uid()));
alter policy "customer reads own events" on customer_events
  using (customer_id = (select auth.uid()));
alter policy "customer reads own order's delivery code" on order_delivery_codes
  using (exists (
    select 1 from orders o
    where o.id = order_delivery_codes.order_id and o.customer_id = (select auth.uid())
  ));
alter policy "customer reads own order's rider location" on order_rider_locations
  using (exists (
    select 1 from orders
    where orders.id = order_rider_locations.order_id and orders.customer_id = (select auth.uid())
  ));
alter policy "vendor staff read their order's rider location" on order_rider_locations
  using (exists (
    select 1 from orders
    join vendor_staff on vendor_staff.vendor_id = orders.vendor_id
    where orders.id = order_rider_locations.order_id and vendor_staff.user_id = (select auth.uid())
  ));
alter policy "admin reads any order's rider location" on order_rider_locations
  using (exists (
    select 1 from user_roles
    where user_roles.user_id = (select auth.uid()) and user_roles.role = any (array['admin', 'superadmin'])
  ));
alter policy "user reads own web push subscriptions" on web_push_subscriptions
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Indexes.
-- ---------------------------------------------------------------------------

create index if not exists notifications_customer_unread_idx on notifications (customer_id) where is_read = false;
create index if not exists notifications_vendor_unread_idx on notifications (vendor_id) where is_read = false;

-- ---------------------------------------------------------------------------
-- 3. customer_bootstrap().
--
-- Shape (jsonb):
--   { cart: null | { id, vendor_id, vendor_name,
--                    items: [ { id, menu_item_id, menu_item_image_url,
--                               name_snapshot, unit_price_kobo, qty,
--                               options_snapshot, line_total_kobo } ] },
--     unread_notifications: int,
--     default_address: null | { label, line1 } }
--
-- * SECURITY INVOKER + STABLE: RLS applies to carts, cart_items, menu_items,
--   vendors, notifications and addresses exactly as for direct queries. Each
--   is additionally scoped to (select auth.uid()) so an owner-role caller (who
--   bypasses RLS) still only gets their own rows. A caller with no uid (anon,
--   or no JWT) matches nothing; execute is also revoked from anon/public, so
--   anon gets a permission error rather than a quiet empty result.
-- * The open cart is status = 'open' (at most one per customer, 0004). Items
--   are ordered by id: cart_items has no created_at column, and ids are UUIDv7
--   (uuid_generate_v7, time-ordered) so id order is insertion order.
-- * Image and vendor name are LEFT JOINs: a menu item or vendor the caller can
--   no longer see through RLS (e.g. vendor deactivated) yields null, it does
--   not drop the cart line.
-- * The default address is the row the top nav picks today: is_default first.
--   created_at desc, id are only a deterministic tiebreak for a customer with
--   no default address (the old query left that arbitrary).
-- ---------------------------------------------------------------------------

create or replace function customer_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'cart', (
      select jsonb_build_object(
        'id', c.id,
        'vendor_id', c.vendor_id,
        'vendor_name', v.name,
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', ci.id,
              'menu_item_id', ci.menu_item_id,
              'menu_item_image_url', mi.image_url,
              'name_snapshot', ci.name_snapshot,
              'unit_price_kobo', ci.unit_price_kobo,
              'qty', ci.qty,
              'options_snapshot', ci.options_snapshot,
              'line_total_kobo', ci.line_total_kobo
            )
            order by ci.id
          )
          from cart_items ci
          left join menu_items mi on mi.id = ci.menu_item_id
          where ci.cart_id = c.id
        ), '[]'::jsonb)
      )
      from carts c
      left join vendors v on v.id = c.vendor_id
      where c.customer_id = (select auth.uid())
        and c.status = 'open'
      limit 1
    ),
    'unread_notifications', (
      select count(*)::int
      from notifications n
      where n.customer_id = (select auth.uid())
        and n.is_read = false
    ),
    'default_address', (
      select jsonb_build_object('label', a.label, 'line1', a.line1)
      from addresses a
      where a.customer_id = (select auth.uid())
      order by a.is_default desc, a.created_at desc, a.id
      limit 1
    )
  );
$$;

comment on function customer_bootstrap() is
  'One-round-trip customer shell read: open cart with items, unread notification count, default address. SECURITY INVOKER (RLS applies), scoped to auth.uid(). authenticated only.';

revoke execute on function customer_bootstrap() from public, anon;
grant execute on function customer_bootstrap() to authenticated;
