-- KiaKia — Phase 0 foundation migration 7/7.
-- RLS as defense-in-depth for reads (§5's "RLS strategy"), never as the
-- business-logic engine. The rule applied uniformly below: every table
-- gets RLS enabled; write grants are revoked from `authenticated` on every
-- table that touches money, order state, rider assignment, or another
-- party's operational data — those reach the table only through
-- transition_order() or a future SECURITY DEFINER RPC / service-role
-- Server Action. The exception is genuinely client-owned scratch state
-- with no cross-party or financial implication: a customer's own cart,
-- addresses, and profile display fields.
--
-- pgTAP tests in supabase/tests assert the cross-tenant-read-fails shape
-- of this file per §5 ("Test your policies... A wrong policy is a data
-- breach, and it fails silently").

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere.
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table addresses enable row level security;
alter table riders enable row level security;
alter table service_areas enable row level security;
alter table vendors enable row level security;
alter table vendor_staff enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table option_groups enable row level security;
alter table options enable row level security;
alter table carts enable row level security;
alter table cart_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_events enable row level security;
alter table accounts enable row level security;
alter table transactions enable row level security;
alter table ledger_entries enable row level security;
alter table payments enable row level security;

-- ---------------------------------------------------------------------------
-- profiles — self read; self update, except `status` (suspension/deletion
-- must not be self-service).
-- ---------------------------------------------------------------------------

create policy "read own profile" on profiles for select
  using (id = auth.uid());

create policy "update own profile" on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function protect_profile_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and auth.role() <> 'service_role' then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_status
  before update on profiles
  for each row execute function protect_profile_status();

revoke insert, delete on profiles from authenticated;

-- ---------------------------------------------------------------------------
-- user_roles — self read only. Written exclusively by admin tooling /
-- service-role (role grants are a privileged operation).
-- ---------------------------------------------------------------------------

create policy "read own roles" on user_roles for select
  using (user_id = auth.uid());

revoke insert, update, delete on user_roles from authenticated;

-- ---------------------------------------------------------------------------
-- addresses — fully owned by the customer.
-- ---------------------------------------------------------------------------

create policy "manage own addresses" on addresses for all
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- riders — self read only. Onboarding/status/location writes are Phase 3.
-- ---------------------------------------------------------------------------

create policy "read own rider row" on riders for select
  using (user_id = auth.uid());

revoke insert, update, delete on riders from authenticated;

-- ---------------------------------------------------------------------------
-- service_areas — public read of active areas; nothing else.
-- ---------------------------------------------------------------------------

create policy "read active service areas" on service_areas for select
  using (is_active);

revoke insert, update, delete on service_areas from authenticated;

-- ---------------------------------------------------------------------------
-- vendors / vendor_staff — public read of active vendors (§3: vendor pages
-- are public, SEO-indexed); staff can additionally see their own vendor
-- while pending/inactive so the dashboard has something to show.
-- ---------------------------------------------------------------------------

create policy "public read active vendors" on vendors for select
  using (status = 'active');

create policy "staff read own vendor" on vendors for select
  using (exists (
    select 1 from vendor_staff
    where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = auth.uid()
  ));

revoke insert, update, delete on vendors from authenticated;

create policy "staff read own membership" on vendor_staff for select
  using (user_id = auth.uid());

revoke insert, update, delete on vendor_staff from authenticated;

-- ---------------------------------------------------------------------------
-- menu_categories / menu_items / option_groups / options — public read
-- scoped to active vendors, plus staff read of their own (possibly
-- inactive) vendor's menu.
-- ---------------------------------------------------------------------------

create policy "read menu of visible vendors" on menu_categories for select
  using (exists (
    select 1 from vendors
    where vendors.id = menu_categories.vendor_id
      and (vendors.status = 'active' or exists (
        select 1 from vendor_staff
        where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = auth.uid()
      ))
  ));

create policy "read items of visible vendors" on menu_items for select
  using (exists (
    select 1 from vendors
    where vendors.id = menu_items.vendor_id
      and (vendors.status = 'active' or exists (
        select 1 from vendor_staff
        where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = auth.uid()
      ))
  ));

create policy "read option groups of visible items" on option_groups for select
  using (exists (
    select 1 from menu_items
    join vendors on vendors.id = menu_items.vendor_id
    where menu_items.id = option_groups.menu_item_id
      and (vendors.status = 'active' or exists (
        select 1 from vendor_staff
        where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = auth.uid()
      ))
  ));

create policy "read options of visible groups" on options for select
  using (exists (
    select 1 from option_groups
    join menu_items on menu_items.id = option_groups.menu_item_id
    join vendors on vendors.id = menu_items.vendor_id
    where option_groups.id = options.group_id
      and (vendors.status = 'active' or exists (
        select 1 from vendor_staff
        where vendor_staff.vendor_id = vendors.id and vendor_staff.user_id = auth.uid()
      ))
  ));

revoke insert, update, delete on menu_categories from authenticated;
revoke insert, update, delete on menu_items from authenticated;
revoke insert, update, delete on option_groups from authenticated;
revoke insert, update, delete on options from authenticated;

-- ---------------------------------------------------------------------------
-- carts / cart_items — fully owned by the customer. This is client-owned
-- scratch state, not a financial record: the price/total the client sees
-- here is never trusted at checkout (§12 point 1 re-derives it server-side).
-- ---------------------------------------------------------------------------

create policy "manage own cart" on carts for all
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

create policy "manage own cart items" on cart_items for all
  using (exists (
    select 1 from carts where carts.id = cart_items.cart_id and carts.customer_id = auth.uid()
  ))
  with check (exists (
    select 1 from carts where carts.id = cart_items.cart_id and carts.customer_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- orders / order_items / order_events — the §5 example, transcribed
-- directly. No writes from `authenticated` under any circumstance; every
-- write goes through transition_order() or a future order-placement RPC.
-- ---------------------------------------------------------------------------

create policy "customer reads own orders" on orders for select
  using (customer_id = auth.uid());

create policy "vendor staff read their vendor orders" on orders for select
  using (exists (
    select 1 from vendor_staff
    where vendor_staff.vendor_id = orders.vendor_id and vendor_staff.user_id = auth.uid()
  ));

create policy "assigned rider reads that order" on orders for select
  using (rider_id = auth.uid());

revoke insert, update, delete on orders from authenticated;

create policy "read items of visible orders" on order_items for select
  using (exists (
    select 1 from orders
    where orders.id = order_items.order_id
      and (
        orders.customer_id = auth.uid()
        or orders.rider_id = auth.uid()
        or exists (
          select 1 from vendor_staff
          where vendor_staff.vendor_id = orders.vendor_id and vendor_staff.user_id = auth.uid()
        )
      )
  ));

revoke insert, update, delete on order_items from authenticated;

create policy "read events of visible orders" on order_events for select
  using (exists (
    select 1 from orders
    where orders.id = order_events.order_id
      and (
        orders.customer_id = auth.uid()
        or orders.rider_id = auth.uid()
        or exists (
          select 1 from vendor_staff
          where vendor_staff.vendor_id = orders.vendor_id and vendor_staff.user_id = auth.uid()
        )
      )
  ));

-- order_events is append-only and written exclusively by transition_order();
-- no insert/update/delete grant exists for authenticated at all.
revoke insert, update, delete on order_events from authenticated;

-- ---------------------------------------------------------------------------
-- Ledger tables — no policies for `authenticated`. RLS is enabled with zero
-- matching policies, which means zero rows are visible to that role; only
-- service_role (which bypasses RLS) can touch these. Vendor/rider-facing
-- earnings views are Phase 4 (§21) and will be scoped read policies added
-- then, not a wildcard opened now.
-- ---------------------------------------------------------------------------

revoke all on accounts, transactions, ledger_entries, payments from authenticated;
