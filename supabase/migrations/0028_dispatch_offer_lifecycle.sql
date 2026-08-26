-- KiaKia — dispatch offer lifecycle: expiry + decline.
--
-- Two gaps independently verified before this migration: (1)
-- dispatch_offers had no `expires_at` and no TTL at all — an hour-old
-- 'offered' row was just as acceptable to accept_dispatch_offer() (0019/
-- 0023) as a fresh one; (2) `dispatch_offers.status` allows 'declined'
-- (its own check constraint, 0019_rider_dispatch.sql) but nothing ever set
-- it — the rider app has no way to say "not taking this one" and free
-- itself up for the next offer.
--
-- SCOPE NOTE — deliberately NOT built here: a re-dispatch sweep (offering
-- the order to the next-nearest riders once every existing offer on it has
-- expired or been declined). That needs either a pg_cron job or an
-- application-level poller calling back into Postgres on a schedule, and
-- doing it correctly (not re-offering to a rider who already declined,
-- respecting the same KYC/online/radius filters
-- dispatch_order_to_nearby_riders() already applies, handling the case
-- where literally every eligible rider has been exhausted) is a real,
-- separate design problem, not a one-line addition to this migration. An
-- order whose only offers have all expired/declined simply sits at
-- 'ready_for_pickup' with no rider assigned until either a future
-- migration adds the sweep or an operator intervenes — this is an honest
-- gap, not a silently half-built feature.
--
-- Recreating accept_dispatch_offer() here rather than editing 0023 per
-- this round's "don't touch already-reviewed migrations" rule — same
-- convention 0023 itself followed relative to 0019.

-- ---------------------------------------------------------------------------
-- dispatch_offers.expires_at
-- ---------------------------------------------------------------------------

-- Added nullable first, then backfilled, then constrained — a column
-- DEFAULT expression that calls now() is volatile and is evaluated once per
-- ALTER TABLE statement (not per existing row), so backfilling explicitly
-- from each row's own offered_at is the only way to give existing rows a
-- sane, individually-computed expiry rather than one shared timestamp.
alter table dispatch_offers add column expires_at timestamptz;

-- 60 seconds: long enough for a rider to glance at their phone and tap
-- accept, short enough that a customer isn't stuck waiting on a rider who
-- has gone quiet. No product data exists yet to tune this against — picked
-- as a sane default, not derived from any measurement.
update dispatch_offers set expires_at = offered_at + interval '60 seconds';

alter table dispatch_offers alter column expires_at set not null;
alter table dispatch_offers alter column expires_at set default (now() + interval '60 seconds');

comment on column dispatch_offers.expires_at is
  'Offer TTL, default 60 seconds from offered_at. accept_dispatch_offer() (redefined in 0028_dispatch_offer_lifecycle.sql) refuses to honor an offer once this has passed. No re-dispatch sweep exists yet when all offers on an order expire/decline — see this migration''s file header.';

-- ---------------------------------------------------------------------------
-- decline_dispatch_offer() — the only writer of dispatch_offers.status
-- 'declined'. Mirrors accept_dispatch_offer()'s own authorization shape:
-- any authenticated rider may call it, but only their own 'offered' row
-- for the given order actually transitions.
-- ---------------------------------------------------------------------------

create or replace function decline_dispatch_offer(p_order_id uuid)
returns dispatch_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer dispatch_offers;
begin
  update dispatch_offers
  set status = 'declined', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid() and status = 'offered'
  returning * into v_offer;

  if not found then
    raise exception 'decline_dispatch_offer: no active offer for this rider on this order';
  end if;

  return v_offer;
end;
$$;

comment on function decline_dispatch_offer(uuid) is
  'The only writer of dispatch_offers.status = ''declined''. Only the offered rider''s own row transitions, and only from ''offered'' — a rider with no active offer (already accepted/expired/declined, or never offered) gets a clean error rather than silently no-opping. Deliberately allowed even on an already-expired-by-clock ''offered'' row (unlike accept_dispatch_offer()''s expiry check below) — a rider explicitly declining is never harmful, it only frees them up sooner.';

revoke execute on function decline_dispatch_offer(uuid) from public;
grant execute on function decline_dispatch_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_dispatch_offer() — redefined to also reject an expired offer.
-- Everything else (row lock, ready_for_pickup/rider_id-null check,
-- kyc_status re-check, transition-table check, the order_events insert,
-- and the "expire every other rider's offer on the same order" step) is
-- byte-for-byte unchanged from 0023_rider_dispatch_kyc_hardening.sql — see
-- that migration and 0019_rider_dispatch.sql's own header for the full
-- reasoning behind each of those.
-- ---------------------------------------------------------------------------

create or replace function accept_dispatch_offer(p_order_id uuid)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_offer dispatch_offers;
begin
  -- Lock the row first — same reasoning as transition_order()'s own first
  -- step: this is also what makes two riders racing to accept the same
  -- offer serialize instead of racing. Unchanged from 0019/0023.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'accept_dispatch_offer: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.status <> 'ready_for_pickup' or v_order.rider_id is not null then
    raise exception 'accept_dispatch_offer: order already assigned or not ready for pickup';
  end if;

  -- Unchanged from 0023 (BLOCKING 4): check the CALLER's own current
  -- kyc_status, not just trust that only kyc-approved riders were ever
  -- offered.
  if not exists (
    select 1 from riders where user_id = auth.uid() and kyc_status = 'approved'
  ) then
    raise exception 'accept_dispatch_offer: rider is not kyc-approved';
  end if;

  select * into v_offer
  from dispatch_offers
  where order_id = p_order_id and rider_id = auth.uid() and status = 'offered';

  if not found then
    raise exception 'accept_dispatch_offer: no active offer for this rider on this order';
  end if;

  -- NEW in this migration: an offer past its TTL is no longer acceptable.
  -- The row is flipped to 'expired' here (lazily, on the first accept
  -- attempt against it) rather than left 'offered' forever, since no
  -- scheduled sweep exists yet (see file header) to do it proactively —
  -- this keeps the rider app's own view of "is this still live" accurate
  -- the moment anyone tries to act on a stale offer, without needing a
  -- cron job for the common case of the SAME rider retrying a tap that
  -- landed just after expiry.
  if v_offer.expires_at <= now() then
    update dispatch_offers
    set status = 'expired', responded_at = now()
    where order_id = p_order_id and rider_id = auth.uid() and status = 'offered';

    raise exception 'accept_dispatch_offer: offer has expired';
  end if;

  -- Defensive, mirrors transition_order()'s own style: don't skip the
  -- explicit allowed-transitions check even though this specific edge is
  -- known to exist in order_status_transitions (0006_transition_order.sql).
  -- Unchanged from 0019/0023.
  if not exists (
    select 1 from order_status_transitions
    where from_status = 'ready_for_pickup' and to_status = 'rider_assigned'
  ) then
    raise exception 'accept_dispatch_offer: ready_for_pickup -> rider_assigned is not a legal transition';
  end if;

  update orders
  set rider_id = auth.uid(), status = 'rider_assigned', assigned_at = now()
  where id = p_order_id
  returning * into v_order;

  -- Mirrors transition_order()'s own order_events insert shape exactly.
  -- Unchanged from 0019/0023.
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, 'ready_for_pickup', 'rider_assigned', 'rider', auth.uid(), '{}'::jsonb);

  update dispatch_offers
  set status = 'accepted', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid();

  -- Same race-safety guarantee as 0019/0023: once the row lock above is
  -- released by this transaction's commit, orders.rider_id is no longer
  -- null, so any concurrent/later accept attempt by a different rider fails
  -- the ready_for_pickup/rider_id-null check at the top, regardless of
  -- whether that rider's own offer row is still 'offered' or has expired.
  update dispatch_offers
  set status = 'expired', responded_at = now()
  where order_id = p_order_id and rider_id <> auth.uid() and status = 'offered';

  return v_order;
end;
$$;

comment on function accept_dispatch_offer(uuid) is
  'The only way a dispatch offer becomes an assignment. Deliberately not routed through transition_order() — see 0019_rider_dispatch.sql''s file header. Gated by: an ''offered'' row for the caller that has not yet passed expires_at, ready_for_pickup/rider_id-null on the order, and kyc_status = ''approved'' on the caller''s own live riders row (0023). Expiry check added in 0028_dispatch_offer_lifecycle.sql; an offer found past expires_at is flipped to ''expired'' and the call is rejected rather than silently honored. No re-dispatch sweep exists yet for orders whose only offers all expire/decline — see 0028''s file header for that scope note.';

revoke execute on function accept_dispatch_offer(uuid) from public;
grant execute on function accept_dispatch_offer(uuid) to authenticated;
