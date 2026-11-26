-- Send vendor staff transactional email for order events that need attention.
-- The existing notification triggers still write the in-app row; migration
-- 0069 fans that same row out to Web Push for subscribed devices.

create or replace function queue_vendor_order_transactional_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_body text;
  v_kind text;
  v_staff_user_id uuid;
begin
  if new.vendor_id is null or new.status is not distinct from old.status then
    return new;
  end if;

  v_kind := new.status::text;
  v_subject := case new.status
    when 'placed' then 'New order ' || new.code
    when 'cancelled_by_customer' then 'Order cancelled ' || new.code
    when 'cancelled_by_platform' then 'Order update for ' || new.code
    when 'delivered' then 'Order delivered ' || new.code
    when 'failed_delivery' then 'Delivery issue for ' || new.code
    else null
  end;
  v_body := case new.status
    when 'placed' then format('A new order %s has arrived. Open your KiaKia dashboard to review it.', new.code)
    when 'cancelled_by_customer' then format('The customer cancelled order %s.', new.code)
    when 'cancelled_by_platform' then format('Order %s was cancelled by KiaKia. Open your dashboard for the latest details.', new.code)
    when 'delivered' then format('Order %s was delivered. Your payout is ready in your vendor dashboard.', new.code)
    when 'failed_delivery' then format('Delivery for order %s could not be completed. Open your dashboard for the latest details.', new.code)
    else null
  end;

  if v_subject is null then
    return new;
  end if;

  for v_staff_user_id in
    select user_id
    from vendor_staff
    where vendor_id = new.vendor_id
  loop
    begin
      perform _queue_transactional_email(
        v_staff_user_id,
        v_subject,
        v_body,
        'vendor-order:' || new.id::text || ':status:' || v_kind || ':recipient:' || v_staff_user_id::text
      );
    exception when others then
      -- A delivery problem for one staff member must not prevent the other
      -- vendor staff from receiving their copy or block the order update.
      raise warning 'queue_vendor_order_transactional_email: order % recipient % - %',
        new.id, v_staff_user_id, sqlerrm;
    end;
  end loop;

  return new;
exception when others then
  -- Messaging stays downstream of the order transaction.
  raise warning 'queue_vendor_order_transactional_email: order % - %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger orders_queue_vendor_transactional_email
  after update of status on orders
  for each row execute function queue_vendor_order_transactional_email();

comment on function queue_vendor_order_transactional_email() is
  'Queues deduplicated transactional emails to vendor staff for new orders, cancellations, delivery failures and completed deliveries. Uses the existing Resend-backed message outbox and never blocks an order status update.';
