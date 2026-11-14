-- Queue account and order emails through the existing Resend-backed outbox.
-- These are transactional messages, so marketing opt-in is not required.

create or replace function _queue_transactional_email(
  p_user_id uuid,
  p_subject text,
  p_body text,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select lower(nullif(btrim(email), '')) into v_email
  from auth.users
  where id = p_user_id;

  if v_email is null then
    return;
  end if;

  insert into message_outbox (
    kind, channel, category, recipient_user_id, to_address, subject, body, dedupe_key
  ) values (
    'system', 'email', 'transactional', p_user_id, v_email,
    p_subject, p_body, p_dedupe_key
  ) on conflict (dedupe_key) do nothing;

  perform invoke_message_worker();
end;
$$;

revoke all on function _queue_transactional_email(uuid, text, text, text) from public, anon, authenticated, service_role;

create or replace function queue_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  perform _queue_transactional_email(
    new.id,
    'Welcome to KiaKia',
    format('Hi %s, welcome to KiaKia. Your account is ready. Sign in to browse local restaurants and place your first order.',
      coalesce(v_name, 'there')),
    'welcome:' || new.id::text
  );
  return new;
exception when others then
  -- Email is best-effort and must never prevent an account from being created.
  raise warning 'queue_welcome_email: user % - %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger auth_user_queue_welcome_email
  after insert on auth.users
  for each row execute function queue_welcome_email();

create or replace function queue_order_transactional_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_body text;
  v_kind text;
begin
  if new.status is distinct from old.status then
    v_kind := new.status::text;
    v_subject := case new.status
      when 'placed' then 'We received your order ' || new.code
      when 'accepted' then 'Your order is confirmed'
      when 'in_transit' then 'Your order is on the way'
      when 'delivered' then 'Your order has been delivered'
      when 'rejected_by_vendor' then 'Update about your order'
      when 'cancelled_by_customer' then 'Your order was cancelled'
      when 'cancelled_by_platform' then 'Update about your order'
      when 'failed_delivery' then 'Update about your delivery'
      else null
    end;
    v_body := case new.status
      when 'placed' then format('We received order %s. The restaurant will review it shortly.', new.code)
      when 'accepted' then format('The restaurant accepted order %s and will begin preparing it shortly.', new.code)
      when 'in_transit' then format('Order %s is on its way to you.', new.code)
      when 'delivered' then format('Order %s has been delivered. Enjoy your meal!', new.code)
      when 'rejected_by_vendor' then format('The restaurant could not accept order %s. Any payment will be handled according to the refund policy.', new.code)
      when 'cancelled_by_customer' then format('Order %s has been cancelled.', new.code)
      when 'cancelled_by_platform' then format('Order %s was cancelled. Any payment will be handled according to the refund policy.', new.code)
      when 'failed_delivery' then format('We could not complete delivery for order %s. Please contact KiaKia support for help.', new.code)
      else null
    end;

    if v_subject is not null then
      perform _queue_transactional_email(
        new.customer_id, v_subject, v_body,
        'order:' || new.id::text || ':status:' || v_kind
      );
    end if;
  end if;

  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    perform _queue_transactional_email(
      new.customer_id, 'Payment received for order ' || new.code,
      format('We received your payment for order %s. Total: NGN %s.', new.code,
        to_char(new.total_kobo / 100.0, 'FM999,999,990.00')),
      'order:' || new.id::text || ':payment:paid'
    );
  elsif new.payment_status in ('failed', 'refunded')
      and old.payment_status is distinct from new.payment_status then
    perform _queue_transactional_email(
      new.customer_id,
      case new.payment_status when 'failed' then 'Payment failed for order ' || new.code
        else 'Payment refunded for order ' || new.code end,
      case new.payment_status when 'failed'
        then format('We could not confirm payment for order %s. Please try again or contact KiaKia support if you were charged.', new.code)
        else format('A refund for order %s has been initiated. Your bank or payment provider may take a few business days to post it.', new.code) end,
      'order:' || new.id::text || ':payment:' || new.payment_status
    );
  end if;

  return new;
exception when others then
  -- The outbox is downstream of the order transaction; a queue issue must
  -- never block a payment or order status transition.
  raise warning 'queue_order_transactional_email: order % - %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger orders_queue_transactional_email
  after update of status, payment_status on orders
  for each row execute function queue_order_transactional_email();

comment on function queue_welcome_email() is
  'Queues one transactional welcome email after account creation. Resend delivery uses message_outbox and the message-worker.';
comment on function queue_order_transactional_email() is
  'Queues deduplicated transactional emails for key order and payment events through message_outbox.';
