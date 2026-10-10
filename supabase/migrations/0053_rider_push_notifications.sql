-- KiaKia - rider push-token registry and in-app notification feed.
--
-- `notifications` (0038_customer_notifications.sql) is customer-only: the
-- column is `customer_id`, the RLS policy is `customer_id = auth.uid()`,
-- and the trigger that populates it reads `new.customer_id` off `orders`.
-- Nothing exists for riders. This migration builds the rider-side
-- equivalent, in two parts: (1) a token registry so a future push-delivery
-- mechanism knows where to send a device notification, and (2) an in-app
-- feed of the same shape as `notifications` but keyed on `rider_id`.
--
-- SCOPE - explicitly NOT built here, and not pretended to be: actually
-- SENDING an Expo push notification requires an outbound HTTPS call from
-- Postgres (pg_net) or, more realistically, a Supabase Edge Function
-- triggered off rows in the tables this migration creates. Building that
-- delivery mechanism is a separate piece of work - this migration only
-- builds the token registry (rider_push_tokens) and the in-app notification
-- feed (rider_notifications) that such a function would read from and write
-- to, respectively. No `pg_net`/Edge Function/webhook exists anywhere in
-- this migration.

-- ---------------------------------------------------------------------------
-- rider_push_tokens
-- ---------------------------------------------------------------------------
--
-- PRIMARY KEY CHOICE - (rider_id, token), not a surrogate uuid id. A
-- surrogate id would only be useful if this table needed a stable
-- externally-referenced identity for each row (nothing ever references a
-- push-token row from elsewhere), or if (rider_id, token) could
-- legitimately repeat (it cannot - the same Expo push token registering
-- twice for the same rider is definitionally the same registration, not two
-- rows). Making the natural key the primary key also makes
-- register_rider_push_token()'s upsert a plain `on conflict (rider_id,
-- token) do update`, with no separate unique index needed alongside a
-- surrogate id the way, for instance, `accounts` needs one
-- (0005_ledger.sql: surrogate id + a separate `unique (owner_type,
-- owner_id, kind)`, because accounts.id is referenced by ledger_entries and
-- transactions elsewhere - a real cross-table reference that
-- rider_push_tokens has no equivalent of).
--
-- device_id is stored but deliberately NOT part of the key: a token can
-- legitimately change for the same physical device (app reinstall, OS-level
-- push-permission reset issuing a fresh Expo token), which would make
-- device_id alone too coarse a key, and device_id itself is optional
-- (Expo's own device-id APIs are not universally available on every
-- platform/permission state) so it cannot anchor identity by itself.
create table rider_push_tokens (
  rider_id    uuid not null references riders (user_id),
  token       text not null,
  platform    text not null check (platform in ('ios', 'android')),
  device_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (rider_id, token)
);

comment on table rider_push_tokens is
  'Expo push token registry - WHERE to send a rider a push notification, not the notification itself. Written only by register_rider_push_token()/unregister_rider_push_token() (below) - no authenticated-reachable write path exists, same posture as dispatch_offers/order_delivery_codes. Actual push delivery (reading this table and calling Expo''s push API) is NOT built by this migration - see this file''s header.';

create trigger rider_push_tokens_set_updated_at
  before update on rider_push_tokens
  for each row execute function set_updated_at();

create index rider_push_tokens_rider_id_idx on rider_push_tokens (rider_id);

alter table rider_push_tokens enable row level security;

create policy "rider reads own push tokens" on rider_push_tokens for select
  using (rider_id = auth.uid());

revoke insert, update, delete on rider_push_tokens from authenticated;

-- ---------------------------------------------------------------------------
-- register_rider_push_token() / unregister_rider_push_token() - the only
-- writers of rider_push_tokens. rider_id is derived from auth.uid() in
-- both, never accepted as a parameter, so neither can ever be used to
-- register or remove another rider's token.
-- ---------------------------------------------------------------------------

create or replace function register_rider_push_token(
  p_token     text,
  p_platform  text,
  p_device_id text default null
)
returns rider_push_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token rider_push_tokens;
begin
  if auth.uid() is null then
    raise exception 'register_rider_push_token: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from riders where user_id = auth.uid()) then
    raise exception 'register_rider_push_token: no rider row for the caller - call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  if p_platform not in ('ios', 'android') then
    raise exception 'register_rider_push_token: unknown platform %', p_platform
      using errcode = 'check_violation';
  end if;

  if p_token is null or length(p_token) = 0 then
    raise exception 'register_rider_push_token: p_token must not be empty'
      using errcode = 'check_violation';
  end if;

  insert into rider_push_tokens (rider_id, token, platform, device_id)
  values (auth.uid(), p_token, p_platform, p_device_id)
  on conflict (rider_id, token) do update set
    platform   = excluded.platform,
    device_id  = excluded.device_id
  returning * into v_token;

  return v_token;
end;
$$;

comment on function register_rider_push_token(text, text, text) is
  'Upserts the CALLER''S OWN rider_push_tokens row on (rider_id, token) - rider_id is always auth.uid(), never a parameter, so this can never register a token against another rider. Call again on every app foreground/token-refresh event; harmless to call repeatedly with the same token.';

revoke execute on function register_rider_push_token(text, text, text) from public;
grant execute on function register_rider_push_token(text, text, text) to authenticated;

create or replace function unregister_rider_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unregister_rider_push_token: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- Scoped by rider_id = auth.uid() in the DELETE's WHERE clause itself, not
  -- merely checked-then-deleted - this can never remove another rider's
  -- token regardless of how the caller misuses p_token. A no-op (not an
  -- error) if the token was never registered or already removed - the
  -- caller's desired end state (this token is not registered) is already
  -- true either way, same "absence is a normal outcome" posture
  -- decline_dispatch_offer()/get_rider_earnings() already use elsewhere in
  -- this schema.
  delete from rider_push_tokens where rider_id = auth.uid() and token = p_token;
end;
$$;

comment on function unregister_rider_push_token(text) is
  'Removes the CALLER''S OWN rider_push_tokens row for p_token (e.g. on logout, or when the OS reports the token invalid). Scoped by rider_id = auth.uid() in the DELETE itself. A no-op, not an error, if no matching row exists.';

revoke execute on function unregister_rider_push_token(text) from public;
grant execute on function unregister_rider_push_token(text) to authenticated;

-- ---------------------------------------------------------------------------
-- rider_notifications - mirrors `notifications` (0038) in shape, keyed on
-- rider_id instead of customer_id.
-- ---------------------------------------------------------------------------

create table rider_notifications (
  id          uuid primary key default uuid_generate_v7(),
  rider_id    uuid not null references riders (user_id) on delete cascade,
  order_id    uuid references orders (id) on delete set null,
  title       text not null,
  body        text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index rider_notifications_rider_id_created_at_idx on rider_notifications (rider_id, created_at desc);

comment on table rider_notifications is
  'Rider-facing notifications generated from order-status transitions that matter to an assigned rider (see the trigger below) - the rider-side counterpart of `notifications` (0038_customer_notifications.sql). Deliberately does NOT also receive one row per dispatch_offers insert (a new offer) - see this migration''s header for why.';

alter table rider_notifications enable row level security;

create policy "read own rider notifications" on rider_notifications for select
  using (rider_id = auth.uid());

-- Riders may mark their own notifications read, nothing else - writes
-- otherwise happen only via the trigger below (SECURITY DEFINER, bypasses
-- this), same posture as `notifications`' own "update own notifications"
-- policy (0038).
create policy "update own rider notifications" on rider_notifications for update
  using (rider_id = auth.uid())
  with check (rider_id = auth.uid());

revoke insert, delete on rider_notifications from authenticated, anon;

-- ---------------------------------------------------------------------------
-- notify_rider_of_order_status_change() - mirrors
-- notify_customer_of_order_status_change() (0038) in style: a SECURITY
-- DEFINER trigger so it fires regardless of which actor's call (vendor
-- accepting, an admin cancelling, the dispatch orchestrator assigning)
-- actually changed the row, and regardless of whether that change went
-- through transition_order() (most transitions) or a direct UPDATE
-- (accept_dispatch_offer()'s own assignment, which never calls
-- transition_order() - see 0019_rider_dispatch.sql's header for why). This
-- is `after update on orders`, not `after update of status`, for exactly
-- that reason - accept_dispatch_offer()'s UPDATE changes rider_id and
-- status together in one statement and must still fire this trigger.
--
-- Deliberately narrow: exactly four cases, chosen for what a rider cannot
-- otherwise learn about without actively polling, or is worth a permanent
-- feed entry rather than only the ephemeral realtime event: an order they
-- are (or were, at the moment of cancellation) assigned to being pulled out
-- from under them while they are carrying it (cancelled_by_platform,
-- cancelled_by_customer, rejected_by_vendor - the last two included as
-- defense in depth even though order_status_transitions (0006) presently
-- only allows either edge FROM 'placed', before any rider is ever assigned,
-- so new.rider_id is always null when they fire today; a future migration
-- widening either edge to fire later in the flow must not silently leave
-- the rider unnotified), and 'delivered' as a confirmation the delivery the
-- rider themselves just closed out was recorded. Every other status the
-- rider's own order naturally passes through (rider_assigned, picked_up,
-- in_transit, arrived) is driven BY the rider's own just-performed action
-- (accepting the offer, tapping each leg of the trip), so notifying them of
-- their own action would be noise, not information - rider_assigned in
-- particular is deliberately excluded even though it is the moment they
-- start caring about an order, because it is accept_dispatch_offer() itself
-- that puts them there; they do not need to be told about a thing they
-- just tapped.
create or replace function notify_rider_of_order_status_change()
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

  -- No rider assigned - nothing for this trigger to do. Covers the
  -- overwhelming majority of order-status changes (draft->placed->
  -- accepted->preparing->ready_for_pickup all happen before any rider
  -- exists).
  if new.rider_id is null then
    return new;
  end if;

  if new.status = 'cancelled_by_platform' then
    -- order_status_transitions (0006) only allows cancelled_by_platform
    -- FROM rider_assigned/picked_up/in_transit onward once a rider exists
    -- at all - so reaching this branch with new.rider_id not null always
    -- means a rider who was actively carrying this order just had it
    -- pulled out from under them.
    v_title := 'Order cancelled';
    v_body := format('Order %s was cancelled and no longer needs delivery.', new.code);
  elsif new.status = 'cancelled_by_customer' then
    -- Not reachable today with new.rider_id not null (cancelled_by_customer
    -- is only a legal edge FROM 'placed', before any rider is ever
    -- assigned) - handled anyway, see the file header, so this trigger does
    -- not have to be revisited the moment that edge is ever widened.
    v_title := 'Order cancelled';
    v_body := format('Order %s was cancelled by the customer and no longer needs delivery.', new.code);
  elsif new.status = 'rejected_by_vendor' then
    -- Same reasoning as cancelled_by_customer above - not reachable today
    -- with a rider assigned, handled anyway as defense in depth.
    v_title := 'Order cancelled';
    v_body := format('Order %s was declined by the vendor and no longer needs delivery.', new.code);
  elsif new.status = 'delivered' then
    v_title := 'Delivery confirmed';
    v_body := format('Order %s is marked delivered. Nice work!', new.code);
  else
    return new;
  end if;

  insert into rider_notifications (rider_id, order_id, title, body)
  values (new.rider_id, new.id, v_title, v_body);

  return new;
end;
$$;

create trigger orders_notify_rider_on_status_change
  after update on orders
  for each row execute function notify_rider_of_order_status_change();

comment on function notify_rider_of_order_status_change() is
  'Inserts a rider notification when the order they are (or were, at time of cancellation) assigned to reaches cancelled_by_platform, cancelled_by_customer, rejected_by_vendor, or delivered. Does NOT fire for rider_assigned/picked_up/in_transit/arrived - all four are driven by the rider''s own just-performed action, so notifying them would be noise. SECURITY DEFINER so it fires regardless of which actor performed the update, and regardless of whether it went through transition_order() or accept_dispatch_offer()''s own direct UPDATE. Silent no-op whenever new.rider_id is null or the status did not actually change.';

-- ---------------------------------------------------------------------------
-- WHY dispatch_offers inserts do NOT also produce a rider_notifications row
-- - a deliberate decision, not an oversight.
--
-- A new dispatch offer is time-critical and short-lived: 60 seconds by
-- default (dispatch_offers.expires_at, 0028_dispatch_offer_lifecycle.sql),
-- after which it is worthless. The realtime subscription on dispatch_offers
-- itself (0051_dispatch_offers_realtime.sql, this same round) already
-- delivers that event live, and the rider app already needs to call
-- get_rider_offer_details() (0032/0044) to render it, which means it is
-- already handling this as a live, ephemeral UI event, not a persistent
-- list item. Also writing a rider_notifications row for every offer would
-- turn a busy rider's notification feed into a scroll of dozens of expired/
-- declined offer entries per shift - most of which the rider took no action
-- on - polluting the one channel meant for things actually worth a rider's
-- attention later (a cancellation, a delivery confirmation). The customer-facing
-- `notifications` table (0038) does not have this problem because every
-- entry there represents a real, permanent state change on an order the
-- customer already committed to - there is no equivalent of "an ignorable,
-- self-expiring offer" on the customer side to accidentally mirror.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rider_notifications'
  ) then
    alter publication supabase_realtime add table rider_notifications;
  end if;
end $$;
