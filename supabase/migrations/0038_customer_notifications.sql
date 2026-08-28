-- Customer-facing notifications, generated from real order-status
-- transitions — replaces the header's always-on notification dot (which
-- had no backing data at all, "unread" was never a real concept) with a
-- genuine unread count.
--
-- Populated by a trigger on `orders`, not by any application code, so it
-- fires no matter which actor (vendor, rider, admin) called
-- transition_order() and caused the status change — the trigger function
-- is SECURITY DEFINER precisely so it can insert regardless of the
-- caller's own grants, the same reasoning every other SECURITY DEFINER
-- function in this schema already uses.

create table notifications (
  id          uuid primary key default uuid_generate_v7(),
  customer_id uuid not null references auth.users (id) on delete cascade,
  order_id    uuid references orders (id) on delete set null,
  title       text not null,
  body        text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index notifications_customer_id_created_at_idx on notifications (customer_id, created_at desc);

comment on table notifications is
  'Customer-facing notifications generated from order-status transitions (see the trigger below) — not a general-purpose notification system for other actors yet.';

alter table notifications enable row level security;

create policy "read own notifications" on notifications for select
  using (customer_id = auth.uid());

-- Customers may mark their own notifications read, nothing else — writes
-- happen only via the trigger below (SECURITY DEFINER, bypasses this).
create policy "update own notifications" on notifications for update
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

revoke insert, delete on notifications from authenticated, anon;

create or replace function notify_customer_of_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body  text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_title := case new.status
    when 'placed'                then 'Order placed!'
    when 'accepted'               then 'Order accepted'
    when 'rejected_by_vendor'     then 'Order declined'
    when 'preparing'              then 'Order in the kitchen'
    when 'ready_for_pickup'       then 'Order ready'
    when 'rider_assigned'         then 'Rider assigned'
    when 'picked_up'              then 'Order picked up'
    when 'in_transit'             then 'On the way'
    when 'arrived'                then 'Rider has arrived'
    when 'delivered'              then 'Order delivered'
    when 'failed_delivery'        then 'Delivery failed'
    when 'cancelled_by_platform'  then 'Order cancelled'
    else null -- draft, cancelled_by_customer: nothing worth notifying about
  end;

  if v_title is null then
    return new;
  end if;

  v_body := case new.status
    when 'placed'               then format('Your order %s has been placed and sent to the vendor.', new.code)
    when 'accepted'              then format('Your order %s has been accepted and will be prepared shortly.', new.code)
    when 'rejected_by_vendor'    then format('Your order %s was declined by the vendor.', new.code)
    when 'preparing'             then format('Your order %s is being prepared.', new.code)
    when 'ready_for_pickup'      then format('Your order %s is ready and waiting for a rider.', new.code)
    when 'rider_assigned'        then format('A rider has been assigned to your order %s.', new.code)
    when 'picked_up'             then format('Your rider has picked up order %s.', new.code)
    when 'in_transit'            then format('Your order %s is on the way!', new.code)
    when 'arrived'               then format('Your rider has arrived with order %s.', new.code)
    when 'delivered'             then format('Your order %s has been delivered. Enjoy!', new.code)
    when 'failed_delivery'       then format('We could not complete delivery for order %s.', new.code)
    when 'cancelled_by_platform' then format('Your order %s was cancelled.', new.code)
  end;

  insert into notifications (customer_id, order_id, title, body)
  values (new.customer_id, new.id, v_title, v_body);

  return new;
end;
$$;

create trigger orders_notify_customer_on_status_change
  after update on orders
  for each row execute function notify_customer_of_order_status_change();

comment on function notify_customer_of_order_status_change() is
  'Inserts a customer notification whenever orders.status actually changes. SECURITY DEFINER so it fires regardless of which actor (vendor/rider/admin) performed the update via transition_order(). Silent no-op for draft and cancelled_by_customer.';

alter publication supabase_realtime add table notifications;
