-- Vendor-facing notifications.
--
-- 0038 built `notifications` for customers only and said so in its own
-- table comment ("not a general-purpose notification system for other
-- actors yet"). Meanwhile the vendor header rendered a Bell with a
-- hard-coded red dot and no click handler at all — it claimed unread
-- activity that did not exist and did nothing when pressed.
--
-- This generalises the existing table to a second audience rather than
-- standing up a parallel `vendor_notifications`: one shape, one realtime
-- publication, one client component reading it from both route groups.
-- A row now belongs to exactly one audience — a customer or a vendor.

alter table notifications
  alter column customer_id drop not null,
  add column vendor_id uuid references vendors (id) on delete cascade;

-- Exactly one audience per row. Without this, a NULL/NULL row would be
-- readable by nobody and a customer+vendor row would be readable by both.
alter table notifications
  add constraint notifications_one_audience
  check (num_nonnulls(customer_id, vendor_id) = 1);

create index notifications_vendor_id_created_at_idx on notifications (vendor_id, created_at desc);

comment on table notifications is
  'Notifications generated from order-status transitions, for exactly one audience per row: a customer (customer_id) or a vendor (vendor_id). See the two trigger functions below.';

-- ---------------------------------------------------------------- RLS
-- 0038''s existing customer policies stay exactly as they are: with
-- customer_id now nullable, `customer_id = auth.uid()` evaluates to NULL
-- on a vendor row, which is not TRUE, so those policies keep vendor rows
-- away from customers without needing a rewrite.

create policy "vendor staff read vendor notifications" on notifications for select
  using (
    exists (
      select 1 from vendor_staff
      where vendor_staff.vendor_id = notifications.vendor_id
        and vendor_staff.user_id = auth.uid()
    )
  );

create policy "vendor staff update vendor notifications" on notifications for update
  using (
    exists (
      select 1 from vendor_staff
      where vendor_staff.vendor_id = notifications.vendor_id
        and vendor_staff.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from vendor_staff
      where vendor_staff.vendor_id = notifications.vendor_id
        and vendor_staff.user_id = auth.uid()
    )
  );

-- RLS cannot restrict *which columns* an allowed UPDATE touches, so until
-- now a recipient could rewrite the title and body of their own
-- notifications. Only `is_read` is ever meant to be user-writable (both
-- clients only ever send that), so say it with a column grant. Applies to
-- customers and vendor staff alike.
revoke update on notifications from authenticated;
grant update (is_read) on notifications to authenticated;

-- ------------------------------------------------------------ trigger
-- Deliberately a second function beside 0038''s rather than an edit to it:
-- the two audiences care about disjoint sets of statuses, and keeping the
-- customer path untouched means this migration cannot regress it.
--
-- Vendors are told about the things they did NOT do themselves. There is
-- no notification for accepted / preparing / ready_for_pickup /
-- rejected_by_vendor, because in every one of those cases the vendor is
-- the actor that caused the transition.
create or replace function notify_vendor_of_order_status_change()
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

  if new.vendor_id is null then
    return new;
  end if;

  v_title := case new.status
    when 'placed'                 then 'New order'
    when 'cancelled_by_customer'  then 'Order cancelled'
    when 'cancelled_by_platform'  then 'Order cancelled'
    when 'rider_assigned'         then 'Rider on the way'
    when 'picked_up'              then 'Order picked up'
    when 'delivered'              then 'Order delivered'
    when 'failed_delivery'        then 'Delivery failed'
    else null
  end;

  if v_title is null then
    return new;
  end if;

  v_body := case new.status
    when 'placed'                then format('Order %s just came in. Accept it to start preparing.', new.code)
    when 'cancelled_by_customer' then format('The customer cancelled order %s.', new.code)
    when 'cancelled_by_platform' then format('Order %s was cancelled.', new.code)
    when 'rider_assigned'        then format('A rider is heading over to collect order %s.', new.code)
    when 'picked_up'             then format('A rider has collected order %s.', new.code)
    when 'delivered'             then format('Order %s was delivered. Your payout has been released.', new.code)
    when 'failed_delivery'       then format('Delivery could not be completed for order %s.', new.code)
  end;

  insert into notifications (vendor_id, order_id, title, body)
  values (new.vendor_id, new.id, v_title, v_body);

  return new;
end;
$$;

create trigger orders_notify_vendor_on_status_change
  after update on orders
  for each row execute function notify_vendor_of_order_status_change();

comment on function notify_vendor_of_order_status_change() is
  'Inserts a vendor notification when orders.status changes to something the vendor did not cause itself (placed, cancellations, rider_assigned, picked_up, delivered, failed_delivery). SECURITY DEFINER for the same reason as the customer trigger: it must fire whichever actor called transition_order().';
