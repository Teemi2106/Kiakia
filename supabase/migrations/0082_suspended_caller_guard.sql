-- KiaKia - a suspended account can no longer drive rider/customer/vendor RPCs
-- with a token that is still valid.
--
-- admin_set_user_status() (0081) flips profiles.status, bans the user in Auth
-- and deletes their sessions, but an access token already issued stays valid
-- for up to an hour and every SECURITY DEFINER RPC below authorised on
-- auth.uid() alone. So a suspended rider could keep going online, accepting
-- offers and releasing escrow, a suspended customer could keep paying from
-- the wallet or cancelling, and suspended vendor staff could keep driving
-- orders, until the token expired.
--
-- _assert_active_caller() closes that. It is fail-closed: no session, no
-- profile row, or a profile whose status is not 'active' (suspended or
-- deleted) raises insufficient_privilege. It is granted to nobody - only the
-- SECURITY DEFINER functions below (same owner) can reach it. It is called
-- ONLY on end-user paths where auth.uid() is already required, so
-- service_role / system paths (the webhook, capture_payment, the dispatch
-- orchestrator, pg_cron, admin RPCs) are untouched.
--
-- Applied to: set_rider_online, accept_dispatch_offer, decline_dispatch_offer,
-- update_rider_location, submit_rider_document, verify_delivery_and_release_
-- escrow, pay_order_from_wallet, register_vendor, set_vendor_location,
-- get_vendor_order_customers and the customer, vendor and rider branches of
-- transition_order(). _transition_order_core() is untouched: the
-- payment-driven callers that use it have authorised themselves.
--
-- A SUSPENDED RIDER FINISHES A DELIVERY ALREADY PICKED UP. An order is "in
-- progress" for its rider when orders.rider_id is that rider and its status is
-- picked_up, in_transit or arrived (_order_in_progress); rider_assigned and an
-- early accept (accepted/preparing with rider_id set) are NOT picked up. A
-- suspended rider is let through, and only through:
--   * transition_order() while the order's CURRENT status is in progress
--     (picked_up -> in_transit -> arrived -> delivered / failed_delivery;
--     rider_assigned -> picked_up is refused),
--   * verify_delivery_and_release_escrow() on such an order (it needs
--     'arrived' anyway), and
--   * update_rider_location() while they hold any in-progress order.
-- set_rider_online, accept/decline_dispatch_offer and submit_rider_document are
-- always refused. This is what keeps the escrow and the rider's pay from being
-- stranded by a suspension (rider PRD section 5.8).
--
-- SESSIONS. Deleting the rider's auth.sessions would stop that delivery, so
-- admin_set_user_status() (redefined below) leaves the sessions of a rider
-- with an in-progress order alone and returns "sign_in_ban_deferred": true,
-- which tells the Server Action not to apply the Auth ban yet. The orders
-- trigger release_suspended_rider_sessions() deletes the sessions once the
-- rider's last in-progress order leaves that set. The suspension is then
-- re-submitted to apply the ban (it is idempotent).
--
-- transition_order() also moves its admin branch onto _assert_admin_actor()
-- (0080) instead of an inline copy of the check: same service-role and
-- admin-role requirements, plus platform scope and an ACTIVE actor profile.
--
-- Every function below is reproduced from the LIVE definition
-- (pg_get_functiondef) with only the guard lines added - see 0075's header for
-- why copying an older migration's body is how regressions happen. Existing
-- grants are preserved by CREATE OR REPLACE.

create function _order_in_progress(p_status order_status)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status in ('picked_up', 'in_transit', 'arrived');
$$;

comment on function _order_in_progress(order_status) is
  'Internal: the statuses at which a rider has the goods in hand (picked_up, in_transit, arrived) - the one definition of "delivery in progress" for suspension handling. Never grant to any role.';

create function _rider_in_progress(p_rider_id uuid, p_order_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from orders o
    where o.rider_id = p_rider_id
      and _order_in_progress(o.status)
      and (p_order_id is null or o.id = p_order_id)
  );
$$;

comment on function _rider_in_progress(uuid, uuid) is
  'Internal: whether the rider is the rider on a delivery in progress (_order_in_progress), optionally on that one order. Never grant to any role.';

create function _assert_active_caller(p_finishing boolean default false, p_order_id uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from profiles where id = auth.uid();

  if v_status = 'active'
     or (v_status = 'suspended' and p_finishing and _rider_in_progress(auth.uid(), p_order_id)) then
    return;
  end if;

  raise exception '_assert_active_caller: the calling account is not active'
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function _assert_active_caller(boolean, uuid) is
  'Internal: raises insufficient_privilege unless auth.uid() has a profiles row with status = ''active'' (fail-closed: no session or no profile also raises). With p_finishing, a SUSPENDED rider is also let through while they are the rider on a delivery in progress (on p_order_id if given, else any). Called at the top of end-user RPCs so a suspended user''s still-valid access token cannot drive them. Never grant to any role.';

revoke all on function _order_in_progress(order_status) from public, anon, authenticated, service_role;
revoke all on function _rider_in_progress(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function _assert_active_caller(boolean, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_rider_online()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_rider_online(p_is_online boolean)
 RETURNS riders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rider riders;
begin
  perform _assert_active_caller();

  select * into v_rider from riders where user_id = auth.uid() for update;
  if not found then
    raise exception 'set_rider_online: no rider row for the caller — call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  if p_is_online and v_rider.kyc_status <> 'approved' then
    raise exception 'set_rider_online: rider % is not kyc-approved (status=%) — cannot go online', auth.uid(), v_rider.kyc_status;
  end if;

  update riders set is_online = p_is_online where user_id = auth.uid()
  returning * into v_rider;

  return v_rider;
end;
$function$;

-- ---------------------------------------------------------------------------
-- accept_dispatch_offer()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_dispatch_offer(p_order_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order                   orders;
  v_offer                   dispatch_offers;
  v_vendor_location         geography(point, 4326);
  v_rider_location          geography(point, 4326);
  v_area                    service_areas;
  v_pickup_distance_m       double precision;
  v_rider_fee_kobo          bigint;
begin
  perform _assert_active_caller();

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'accept_dispatch_offer: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Relaxed from "= 'ready_for_pickup'" (0044) to also allow an early
  -- accept while the vendor is still preparing - see this migration's own
  -- header for the full reasoning. rider_id-null is still required either
  -- way: exactly one rider may ever claim an order.
  if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup') or v_order.rider_id is not null then
    raise exception 'accept_dispatch_offer: order already assigned or not ready for pickup';
  end if;

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

  if v_offer.expires_at <= now() then
    update dispatch_offers
    set status = 'expired', responded_at = now()
    where order_id = p_order_id and rider_id = auth.uid() and status = 'offered';

    raise exception 'accept_dispatch_offer: offer has expired';
  end if;

  -- rider_fee_kobo is computed identically on both paths - the rider's own
  -- distance to the vendor right now, plus the order's existing
  -- vendor->customer distance_m. Unchanged formula from 0044.
  -- The fee is frozen from this position, so it has to be a live one: a
  -- rider who is offline, or whose last ping is minutes old, is not where the
  -- stored coordinates say.
  select current_location into v_rider_location
  from riders
  where user_id = auth.uid()
    and is_online
    and last_ping_at >= now() - interval '5 minutes';
  if v_rider_location is null then
    raise exception 'accept_dispatch_offer: rider must be online with a location update from the last 5 minutes to accept';
  end if;

  select location into v_vendor_location from vendors where id = v_order.vendor_id;
  if v_vendor_location is null then
    raise exception 'accept_dispatch_offer: vendor has no location set, cannot compute rider fee';
  end if;

  if v_order.service_area_id is null then
    raise exception 'accept_dispatch_offer: order % has no service_area_id, cannot compute rider fee', p_order_id;
  end if;

  select * into v_area from service_areas where id = v_order.service_area_id;
  if not found then
    raise exception 'accept_dispatch_offer: service area % does not exist', v_order.service_area_id;
  end if;

  v_pickup_distance_m := st_distance(v_rider_location, v_vendor_location);

  v_rider_fee_kobo := v_area.rider_base_fee_kobo
    + v_area.rider_per_km_fee_kobo * ceil((v_pickup_distance_m + coalesce(v_order.distance_m, 0)) / 1000.0)::bigint;

  -- 0076: the payout has to be fundable. release refuses a negative platform
  -- share, so a rider far from the vendor could accept, complete the whole
  -- delivery, and only then find the order could not pay anyone out. Refuse
  -- here instead, before anything is promised.
  if v_rider_fee_kobo > _max_rider_fee_kobo(p_order_id) then
    raise exception 'accept_dispatch_offer: order % is too far from this rider - the payout would exceed what the order can fund', p_order_id
      using errcode = 'check_violation';
  end if;

  if v_order.status = 'ready_for_pickup' then
    -- Unchanged from 0044: the normal, today's-behavior path. status moves
    -- straight to rider_assigned here because the order is already ready -
    -- there is no later ready_for_pickup transition left to cascade from.
    if not exists (
      select 1 from order_status_transitions
      where from_status = 'ready_for_pickup' and to_status = 'rider_assigned'
    ) then
      raise exception 'accept_dispatch_offer: ready_for_pickup -> rider_assigned is not a legal transition';
    end if;

    update orders
    set rider_id = auth.uid(),
        status = 'rider_assigned',
        assigned_at = now(),
        rider_fee_kobo = v_rider_fee_kobo,
        rider_pickup_distance_m = round(v_pickup_distance_m)
    where id = p_order_id
    returning * into v_order;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, 'ready_for_pickup', 'rider_assigned', 'rider', auth.uid(), '{}'::jsonb);
  else
    -- NEW: an early accept, while the order is still 'accepted' or
    -- 'preparing'. Claims rider_id and freezes rider_fee_kobo right now
    -- (the rider's trip starts now, so their pay is set from where they
    -- actually are now) but deliberately leaves orders.status and
    -- assigned_at untouched - the vendor's own transition_order() calls are
    -- still the only thing that advances status through accepted ->
    -- preparing -> ready_for_pickup. dispatch_order_to_nearby_riders()
    -- (0023, this migration) detects rider_id already being set the moment
    -- ready_for_pickup is reached and cascades to rider_assigned itself -
    -- see that function's own comment. Until then, this rider shows up on
    -- their own active-order screen (useActiveOrder, kiakia-rider) exactly
    -- as any assigned rider would, since that query is keyed on
    -- orders.rider_id, not status.
    update orders
    set rider_id = auth.uid(),
        rider_fee_kobo = v_rider_fee_kobo,
        rider_pickup_distance_m = round(v_pickup_distance_m)
    where id = p_order_id
    returning * into v_order;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (
      p_order_id, v_order.status, v_order.status, 'rider', auth.uid(),
      jsonb_build_object('early_accept', true, 'order_status_at_accept', v_order.status)
    );
  end if;

  update dispatch_offers
  set status = 'accepted', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid();

  -- Unchanged from 0044: once this transaction commits, orders.rider_id is
  -- no longer null, so any concurrent/later accept attempt - on either path
  -- - fails the rider_id-null check at the top regardless of that rider's
  -- own offer status.
  update dispatch_offers
  set status = 'expired', responded_at = now()
  where order_id = p_order_id and rider_id <> auth.uid() and status = 'offered';

  return v_order;
end;
$function$;

-- ---------------------------------------------------------------------------
-- decline_dispatch_offer()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.decline_dispatch_offer(p_order_id uuid)
 RETURNS dispatch_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer dispatch_offers;
begin
  perform _assert_active_caller();

  update dispatch_offers
  set status = 'declined', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid() and status = 'offered'
  returning * into v_offer;

  if not found then
    raise exception 'decline_dispatch_offer: no active offer for this rider on this order';
  end if;

  return v_offer;
end;
$function$;

-- ---------------------------------------------------------------------------
-- update_rider_location()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_rider_location(p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _assert_active_caller(true);

  if p_lat < -90 or p_lat > 90 then
    raise exception 'update_rider_location: lat % is out of range [-90, 90]', p_lat
      using errcode = 'check_violation';
  end if;
  if p_lng < -180 or p_lng > 180 then
    raise exception 'update_rider_location: lng % is out of range [-180, 180]', p_lng
      using errcode = 'check_violation';
  end if;

  -- NOTE the argument order: st_point(x, y) = st_point(lng, lat). Passing
  -- (lat, lng) here would be the classic PostGIS longitude/latitude swap
  -- bug — silently placing every rider at the antipode-ish wrong spot for
  -- most of the globe rather than erroring, so it's called out explicitly.
  -- st_setsrid(..., 4326) is explicit rather than relying on st_point's
  -- default SRID-0-is-treated-as-4326 behavior on cast to geography — same
  -- WGS84 SRID every other geography column in this schema uses
  -- (geography(point, 4326), see 0002/0003/0004_*.sql).
  update riders
  set current_location = st_setsrid(st_point(p_lng, p_lat), 4326)::geography,
      last_ping_at = now()
  where user_id = auth.uid();

  if not found then
    raise exception 'update_rider_location: no rider row for the caller — call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  -- Fan the same ping out to every order this rider currently has in
  -- flight — this is what makes the customer's live map work (see this
  -- migration's order_rider_locations header comment). A rider is not
  -- expected to have more than one such order in the normal flow, but this
  -- is written to not assume that: it upserts one row per matching order,
  -- not just the most recent one.
  insert into order_rider_locations (order_id, rider_id, lat, lng, updated_at)
  select o.id, auth.uid(), p_lat, p_lng, now()
  from orders o
  where o.rider_id = auth.uid()
    and o.status in ('rider_assigned', 'picked_up', 'in_transit', 'arrived')
  on conflict (order_id) do update set
    rider_id   = excluded.rider_id,
    lat        = excluded.lat,
    lng        = excluded.lng,
    updated_at = excluded.updated_at;
end;
$function$;

-- ---------------------------------------------------------------------------
-- submit_rider_document()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_rider_document(p_doc_type text, p_storage_path text)
 RETURNS rider_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_document rider_documents;
begin
  if auth.uid() is null then
    raise exception 'submit_rider_document: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  perform _assert_active_caller();

  if not exists (select 1 from riders where user_id = auth.uid()) then
    raise exception 'submit_rider_document: no rider row for the caller - call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  if p_doc_type not in ('government_id', 'drivers_license', 'vehicle_photo') then
    raise exception 'submit_rider_document: unknown doc_type %', p_doc_type
      using errcode = 'check_violation';
  end if;

  -- The one check that makes storage.objects RLS (above) and this table's
  -- metadata agree with each other: a rider can upload only into their own
  -- folder, but nothing before this check stopped them from then pointing a
  -- rider_documents row's storage_path at some OTHER rider's object path
  -- (which they could not read via the storage RLS above, but a reviewing
  -- admin using the service-role key bypasses that RLS entirely and would
  -- unknowingly review the wrong rider's file). Comparing the literal
  -- prefix, not just extracting the folder segment, so a path with no '/'
  -- at all is also rejected rather than passing some looser check.
  if p_storage_path is null or left(p_storage_path, length(auth.uid()::text) + 1) <> auth.uid()::text || '/' then
    raise exception 'submit_rider_document: storage_path % does not belong to the caller', p_storage_path
      using errcode = 'insufficient_privilege';
  end if;

  -- Upsert on (rider_id, doc_type): a resubmission (e.g. after rejection, a
  -- rider uploads a clearer photo) replaces storage_path and forces status
  -- back to 'pending' - review_note from a prior rejection is cleared too,
  -- since it refers to the document being replaced.
  insert into rider_documents (rider_id, doc_type, storage_path, status, review_note)
  values (auth.uid(), p_doc_type, p_storage_path, 'pending', null)
  on conflict (rider_id, doc_type) do update set
    storage_path = excluded.storage_path,
    status       = 'pending',
    review_note  = null
  returning * into v_document;

  return v_document;
end;
$function$;

-- ---------------------------------------------------------------------------
-- verify_delivery_and_release_escrow()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_delivery_and_release_escrow(p_order_id uuid, p_delivery_code text)
 RETURNS delivery_verification_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order               orders;
  v_vendor              vendors;
  v_commission_kobo     bigint;
  v_vendor_kobo         bigint;
  v_rider_kobo          bigint;
  v_platform_kobo       bigint;
  v_vendor_account_id   uuid;
  v_rider_account_id    uuid;
  v_escrow_account_id   uuid;
  v_revenue_account_id  uuid;
  v_transaction_id      uuid;
  v_reference           text;
  v_stored_code         text;
  v_failed_attempts     integer;
  v_escrow_held_kobo    bigint;
  v_reset_marker_at     timestamptz;
  v_result              delivery_verification_result;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is null or v_order.rider_id is null or auth.uid() is distinct from v_order.rider_id then
    raise exception 'verify_delivery_and_release_escrow: actor is not the assigned rider on order %', p_order_id;
  end if;

  perform _assert_active_caller(true, p_order_id);

  v_reference := v_order.code || '-escrow';

  if exists (select 1 from transactions where reference = v_reference) then
    select * into v_order from orders where id = p_order_id;
    v_result.code_matched := true;
    v_result.order_row := v_order;
    return v_result;
  end if;

  if v_order.status <> 'arrived' then
    raise exception 'verify_delivery_and_release_escrow: order is not yet marked arrived (status=%)', v_order.status;
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'verify_delivery_and_release_escrow: order % payment_status is not paid (status=%)',
      p_order_id, v_order.payment_status;
  end if;

  -- 0057 TASK 1 fix: require actor_type = 'admin' on the reset-marker row,
  -- matching what admin_reset_delivery_code_attempts() (0031) has always
  -- actually written, instead of trusting any order_events row carrying
  -- this meta key regardless of who wrote it. See this migration's header
  -- for the full reasoning and the current non-exploitability analysis.
  select max(at) into v_reset_marker_at
  from order_events
  where order_id = p_order_id
    and actor_type = 'admin'
    and (meta ->> 'delivery_code_attempts_reset')::boolean is true;

  select count(*) into v_failed_attempts
  from order_events
  where order_id = p_order_id
    and (meta ->> 'delivery_code_failed')::boolean is true
    and at >= v_order.arrived_at
    and at > coalesce(v_reset_marker_at, '-infinity'::timestamptz);

  if v_failed_attempts >= 5 then
    raise exception 'verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order %', p_order_id;
  end if;

  select code into v_stored_code from order_delivery_codes where order_id = p_order_id;
  if v_stored_code is null then
    raise exception 'verify_delivery_and_release_escrow: no delivery code exists for order %', p_order_id;
  end if;

  if p_delivery_code is distinct from v_stored_code then
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, v_order.status, v_order.status, 'rider', auth.uid(), jsonb_build_object('delivery_code_failed', true));

    v_result.code_matched := false;
    v_result.order_row := v_order;
    return v_result;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: vendor % does not exist', v_order.vendor_id;
  end if;

  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform escrow account is not seeded';
  end if;

  select coalesce(sum(amount_kobo), 0) into v_escrow_held_kobo
  from ledger_entries
  where order_id = p_order_id
    and account_id = v_escrow_account_id
    and direction = 'credit'
    and entry_type = 'payment_capture';

  if v_escrow_held_kobo <> v_order.total_kobo then
    raise exception 'verify_delivery_and_release_escrow: escrow for order % holds % kobo but total_kobo is % - refusing to release',
      p_order_id, v_escrow_held_kobo, v_order.total_kobo;
  end if;

  -- v_rider_kobo comes from rider_fee_kobo (set by accept_dispatch_offer(),
  -- 0044) instead of delivery_fee_kobo - see 0044's own file header for
  -- why the two were conflated before. v_platform_kobo remains the
  -- RESIDUAL (total_kobo - vendor - rider), unchanged from 0020: this is
  -- what makes a free-delivery order (delivery_fee_kobo = 0, but
  -- rider_fee_kobo > 0) still balance - the platform's share simply
  -- absorbs the difference, exactly as it already absorbs discount_kobo.
  v_commission_kobo := round(v_order.subtotal_kobo * v_vendor.commission_bps / 10000.0)::bigint;
  v_vendor_kobo := v_order.subtotal_kobo - v_commission_kobo;
  v_rider_kobo := v_order.rider_fee_kobo;
  v_platform_kobo := v_order.total_kobo - v_vendor_kobo - v_rider_kobo;

  if v_vendor_kobo < 0 or v_rider_kobo < 0 or v_platform_kobo < 0 then
    raise exception 'verify_delivery_and_release_escrow: computed a negative payout share for order % (vendor=%, rider=%, platform=%) - refusing to release',
      p_order_id, v_vendor_kobo, v_rider_kobo, v_platform_kobo;
  end if;

  select id into v_vendor_account_id from accounts where owner_type = 'vendor' and owner_id = v_order.vendor_id and kind = 'available';
  if v_vendor_account_id is null then
    insert into accounts (owner_type, owner_id, kind) values ('vendor', v_order.vendor_id, 'available')
    on conflict (owner_type, owner_id, kind) do nothing;
    select id into v_vendor_account_id from accounts where owner_type = 'vendor' and owner_id = v_order.vendor_id and kind = 'available';
  end if;

  select id into v_rider_account_id from accounts where owner_type = 'rider' and owner_id = v_order.rider_id and kind = 'available';
  if v_rider_account_id is null then
    insert into accounts (owner_type, owner_id, kind) values ('rider', v_order.rider_id, 'available')
    on conflict (owner_type, owner_id, kind) do nothing;
    select id into v_rider_account_id from accounts where owner_type = 'rider' and owner_id = v_order.rider_id and kind = 'available';
  end if;

  select id into v_revenue_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'revenue';
  if v_revenue_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform revenue account is not seeded';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('escrow_release', v_reference, p_order_id, 'Escrow released on delivery-code verification')
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values (v_transaction_id, v_escrow_account_id, 'debit', v_order.total_kobo, 'escrow_release', p_order_id);

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_vendor_account_id, 'credit', v_vendor_kobo, 'escrow_release', p_order_id
  where v_vendor_kobo > 0;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_rider_account_id, 'credit', v_rider_kobo, 'escrow_release', p_order_id
  where v_rider_kobo > 0;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_revenue_account_id, 'credit', v_platform_kobo, 'escrow_release', p_order_id
  where v_platform_kobo > 0;

  v_order := transition_order(p_order_id, 'delivered', 'rider', auth.uid(), jsonb_build_object('delivery_code_verified', true));
  v_result.code_matched := true;
  v_result.order_row := v_order;
  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- pay_order_from_wallet()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pay_order_from_wallet(p_order_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order              orders;
  v_caller             uuid := auth.uid();
  v_wallet_account_id  uuid;
  v_escrow_account_id  uuid;
  v_balance_kobo       bigint;
  v_transaction_id     uuid;
  v_reference          text;
begin
  if v_caller is null then
    raise exception 'pay_order_from_wallet: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  perform _assert_active_caller();

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'pay_order_from_wallet: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Not merely "is this person a customer" - is this THEIR order. RLS would
  -- also stop them reading it, but this function is SECURITY DEFINER and so
  -- runs with RLS bypassed; the check has to be explicit here.
  if v_order.customer_id is distinct from v_caller then
    raise exception 'pay_order_from_wallet: order % does not belong to the calling user', p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Same gate the card path enforces implicitly by only ever capturing
  -- against a draft/pending order. Paying twice, or paying an order that is
  -- already live, must be impossible rather than merely unlikely.
  if v_order.status <> 'draft' or v_order.payment_status <> 'pending' then
    raise exception 'pay_order_from_wallet: order % is not awaiting payment (status=%, payment_status=%)',
      p_order_id, v_order.status, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if v_order.total_kobo <= 0 then
    raise exception 'pay_order_from_wallet: order % has a non-positive total', p_order_id
      using errcode = 'check_violation';
  end if;

  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception 'pay_order_from_wallet: platform escrow account is not seeded';
  end if;

  v_wallet_account_id := _customer_wallet_account_id(v_caller);

  -- THE serialisation point. Balances are derived (0005), so nothing else
  -- stops two concurrent checkouts from both reading the same balance and
  -- both spending it. Every wallet debit takes this same row lock first, so
  -- they queue instead of racing. The constraint trigger in section 2 above
  -- is the backstop if this is ever bypassed.
  perform 1 from accounts where id = v_wallet_account_id for update;

  select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
  into v_balance_kobo
  from ledger_entries
  where account_id = v_wallet_account_id;

  if v_balance_kobo < v_order.total_kobo then
    raise exception 'pay_order_from_wallet: wallet balance % kobo does not cover order total % kobo',
      v_balance_kobo, v_order.total_kobo
      using errcode = 'check_violation';
  end if;

  -- A distinct suffix from capture_payment()'s anchor (which is the bare
  -- order code, via its idempotency_key) so "was this paid from the wallet"
  -- and "was this captured through Monnify" stay independently checkable -
  -- the same reasoning 0031 gives for '-escrow' vs '-refund'. The unique
  -- constraint on transactions.reference is what makes a double-submit a
  -- hard failure rather than a second debit.
  v_reference := v_order.code || '-wallet';

  insert into transactions (kind, reference, order_id, description)
  values ('payment_capture', v_reference, p_order_id, 'Paid from customer wallet')
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_wallet_account_id, 'debit', v_order.total_kobo, 'payment_capture', p_order_id),
    (v_transaction_id, v_escrow_account_id, 'credit', v_order.total_kobo, 'payment_capture', p_order_id);

  update orders set payment_status = 'paid', payment_method = 'wallet' where id = p_order_id;

  -- 'system', not 'customer', and through the internal core rather than the
  -- public transition_order(): that one gates 'system' on the CALLER holding
  -- the service-role key, which this function's caller (the customer's own
  -- session) never does - it failed every wallet payment with 'actor_type=
  -- system requires the service-role key'. This function has already proven
  -- the caller owns the order and that the payment is booked, so it is the
  -- authorization boundary here, exactly as capture_payment() is for card.
  return _transition_order_core(p_order_id, 'placed', 'system', null, jsonb_build_object(
    'payment_method', 'wallet',
    'wallet_transaction', v_reference,
    'paid_amount_kobo', v_order.total_kobo
  ));
end;
$function$;

-- ---------------------------------------------------------------------------
-- transition_order() - public gate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transition_order(p_order_id uuid, p_to_status order_status, p_actor_type text, p_actor_id uuid, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order       orders;
  v_caller_uid  uuid := auth.uid();
  -- auth.role() is NULL for a direct pg_cron/psql connection with no JWT
  -- claims; comparing NULL <> 'service_role' is NULL, which `if` treats as
  -- false, so a plain `<>` would fail OPEN for exactly the callers that most
  -- need the service-role branches below. coalesce + `is distinct from`
  -- closes that (S1, 0018/0030/0050).
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Authorization, part 1: the actor must have a real relationship to the
  -- order, proven by the SESSION making the call (auth.uid()/auth.role()),
  -- never by the p_actor_id/p_actor_type arguments alone. Restored from
  -- 0015/0018/0030 - this is the actor-forgery fix that 0041/0042 dropped,
  -- and 0050 restored.
  if p_actor_type = 'customer' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.customer_id then
      raise exception 'transition_order: actor is not the customer on order %', p_order_id;
    end if;
    perform _assert_active_caller();
    -- Authorization, part 2: which edges this actor TYPE may drive,
    -- independent of whether the edge is legal for the order's current
    -- status. Restored from 0018/0030 - the per-actor-type allow-lists
    -- that 0041/0042 dropped, and 0050 restored.
    if p_to_status <> 'cancelled_by_customer' then
      raise exception 'transition_order: actor_type=customer may not drive an order to %- only cancelled_by_customer', p_to_status;
    end if;
  elsif p_actor_type = 'vendor' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or not exists (
      select 1 from vendor_staff where vendor_id = v_order.vendor_id and user_id = v_caller_uid
    ) then
      raise exception 'transition_order: actor is not staff on vendor %', v_order.vendor_id;
    end if;
    perform _assert_active_caller();
    if p_to_status not in ('accepted', 'rejected_by_vendor', 'preparing', 'ready_for_pickup') then
      raise exception 'transition_order: actor_type=vendor may not drive an order to %', p_to_status;
    end if;
  elsif p_actor_type = 'rider' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.rider_id then
      raise exception 'transition_order: actor is not the assigned rider on order %', p_order_id;
    end if;
    perform _assert_active_caller(true, p_order_id);
    if p_to_status not in ('picked_up', 'in_transit', 'arrived', 'delivered', 'failed_delivery') then
      raise exception 'transition_order: actor_type=rider may not drive an order to %', p_to_status;
    end if;
  elsif p_actor_type = 'admin' then
    -- No `authenticated`-reachable admin surface: service role plus a real,
    -- active, platform-scoped admin row, checked by the same helper every
    -- admin RPC uses (0080).
    perform _assert_admin_actor('transition_order', p_actor_id);
    if p_to_status <> 'cancelled_by_platform' then
      raise exception 'transition_order: actor_type=admin may not drive an order to %- only cancelled_by_platform', p_to_status;
    end if;
  elsif p_actor_type = 'system' then
    -- Reserved for pg_cron / the dispatch orchestrator / capture_payment's
    -- internal call, all of which run with the service-role key. THIS
    -- BRANCH IS THE SHARPEST PART OF THE FIX: 0041/0042's if/elsif chain
    -- had no branch at all for 'system', which in PL/pgSQL means it fell
    -- through with ZERO checks performed for any p_actor_type value this
    -- chain does not explicitly name - restored here, plus the trailing
    -- `else raise` below so any FUTURE unhandled actor_type also fails
    -- closed instead of silently passing.
    if v_caller_role is distinct from 'service_role' then
      raise exception 'transition_order: actor_type=system requires the service-role key';
    end if;
    if p_to_status not in ('placed', 'cancelled_by_platform', 'rider_assigned') then
      raise exception 'transition_order: actor_type=system may not drive an order to %', p_to_status;
    end if;
  else
    raise exception 'transition_order: unknown actor_type %', p_actor_type;
  end if;

  return _transition_order_core(p_order_id, p_to_status, p_actor_type, p_actor_id, p_meta);
end;
$function$;

-- ---------------------------------------------------------------------------
-- register_vendor()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_vendor(p_name text, p_slug text, p_category text, p_description text DEFAULT NULL::text, p_address_line text DEFAULT NULL::text, p_landmark text DEFAULT NULL::text, p_location geography DEFAULT NULL::geography, p_service_area_id uuid DEFAULT NULL::uuid, p_state text DEFAULT NULL::text)
 RETURNS vendors
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vendor vendors;
begin
  perform _assert_active_caller();

  if exists (select 1 from vendor_staff where user_id = auth.uid()) then
    raise exception 'register_vendor: this account already has a vendor — one vendor per account in this release'
      using errcode = 'unique_violation';
  end if;

  insert into vendors (owner_user_id, name, slug, category, description, address_line, landmark, location, service_area_id, state)
  values (auth.uid(), p_name, p_slug, p_category, p_description, p_address_line, p_landmark, p_location, p_service_area_id, p_state)
  returning * into v_vendor;
  -- A duplicate p_slug surfaces as a unique_violation on vendors.slug
  -- (0003_catalog.sql) — the caller maps that to "this store name is taken".

  insert into vendor_staff (vendor_id, user_id, role)
  values (v_vendor.id, auth.uid(), 'vendor_owner');

  insert into user_roles (user_id, role)
  values (auth.uid(), 'vendor_owner')
  on conflict do nothing;

  return v_vendor;
end;
$function$;

-- ---------------------------------------------------------------------------
-- set_vendor_location()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_vendor_location(p_vendor_id uuid, p_lat double precision, p_lng double precision)
 RETURNS vendors
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vendor vendors;
begin
  -- Authorization: caller must be vendor_staff on this vendor. Same
  -- membership-existence check transition_order()'s vendor branch
  -- (0006/0018/0030) and updateVendorSettingsAction (app/actions/vendor.ts)
  -- already use — not re-deriving a new predicate for this write.
  if not exists (
    select 1 from vendor_staff where vendor_id = p_vendor_id and user_id = auth.uid()
  ) then
    raise exception 'set_vendor_location: actor % is not staff on vendor %', auth.uid(), p_vendor_id;
  end if;

  perform _assert_active_caller();

  -- Validate, never clamp — same posture update_rider_location() takes on
  -- the exact same lat/lng domain.
  if p_lat < -90 or p_lat > 90 then
    raise exception 'set_vendor_location: lat % is out of range [-90, 90]', p_lat
      using errcode = 'check_violation';
  end if;
  if p_lng < -180 or p_lng > 180 then
    raise exception 'set_vendor_location: lng % is out of range [-180, 180]', p_lng
      using errcode = 'check_violation';
  end if;

  -- NOTE the argument order: st_point(x, y) = st_point(lng, lat). Passing
  -- (lat, lng) here would be the classic PostGIS longitude/latitude swap
  -- bug — silently placing the vendor at the wrong spot for most of the
  -- globe rather than erroring. st_setsrid(..., 4326) explicit, same
  -- reasoning update_rider_location() (0026) already documents: every other
  -- geography column in this schema is WGS84 (geography(point, 4326)) and
  -- this must match it exactly, not rely on an implicit-SRID cast.
  update vendors
  set location = st_setsrid(st_point(p_lng, p_lat), 4326)::geography
  where id = p_vendor_id
  returning * into v_vendor;

  if not found then
    -- Can only happen if p_vendor_id was deleted between the vendor_staff
    -- check above and this update, inside the same statement's snapshot —
    -- included for the same defensive reasons other functions in this set
    -- check `not found` after their own UPDATE ... RETURNING.
    raise exception 'set_vendor_location: vendor % does not exist', p_vendor_id
      using errcode = 'no_data_found';
  end if;

  return v_vendor;
end;
$function$;

-- ---------------------------------------------------------------------------
-- get_vendor_order_customers()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_vendor_order_customers(p_order_ids uuid[])
 RETURNS TABLE(order_id uuid, customer_name text, customer_phone text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'get_vendor_order_customers: no authenticated caller';
  end if;

  perform _assert_active_caller();

  if cardinality(p_order_ids) > 200 then
    raise exception 'get_vendor_order_customers: at most 200 orders per call'
      using errcode = 'check_violation';
  end if;

  -- Staff of the order's own vendor only, and only while the order is still
  -- in flight: a customer's number is for fulfilling this order, not a
  -- permanent record vendor staff keep access to.
  return query
  select o.id, p.full_name, p.phone
  from orders o
  join profiles p on p.id = o.customer_id
  where o.id = any (p_order_ids)
    and o.status in ('placed', 'accepted', 'preparing', 'ready_for_pickup', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
    and exists (
      select 1 from vendor_staff vs
      where vs.vendor_id = o.vendor_id and vs.user_id = auth.uid()
    );
end;
$function$;

-- ---------------------------------------------------------------------------
-- admin_set_user_status() - defer session revocation for a rider mid-delivery
-- ---------------------------------------------------------------------------
--
-- Reproduced from 0081 with one change: suspending a rider who is on a
-- delivery in progress still sets the status and takes them offline, but keeps
-- their auth.sessions and adds "sign_in_ban_deferred": true to the result (the
-- key is absent otherwise, so the usual result shape is unchanged). The
-- trigger below revokes the sessions when that delivery ends.

CREATE OR REPLACE FUNCTION public.admin_set_user_status(p_user_id uuid, p_status text, p_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile      profiles;
  v_previous     text;
  v_reason       text;
  v_was_online   boolean := false;
  v_target_super boolean;
  v_deferred     boolean := false;
begin
  perform _assert_admin_actor('admin_set_user_status', p_actor_id);

  if p_status not in ('active', 'suspended') then
    raise exception 'admin_set_user_status: status must be active or suspended, got %', p_status
      using errcode = 'check_violation';
  end if;
  v_reason := _admin_reason('admin_set_user_status', p_reason, p_status = 'suspended');

  if p_user_id is not distinct from p_actor_id then
    raise exception 'admin_set_user_status: you cannot change your own account status'
      using errcode = 'check_violation';
  end if;

  v_target_super := exists (
    select 1 from user_roles where user_id = p_user_id and scope_type = 'platform' and role = 'superadmin'
  );
  if p_status = 'suspended' and v_target_super then
    perform 1 from user_roles where role = 'superadmin' and scope_type = 'platform' order by id for update;
  end if;

  select * into v_profile from profiles where id = p_user_id for update;
  if not found then
    raise exception 'admin_set_user_status: user % does not exist', p_user_id
      using errcode = 'no_data_found';
  end if;

  if v_profile.status = 'deleted' then
    raise exception 'admin_set_user_status: user % is deleted and cannot be reinstated', p_user_id
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from user_roles
    where user_id = p_user_id and scope_type = 'platform' and role in ('admin', 'superadmin')
  ) then
    perform _assert_admin_actor('admin_set_user_status', p_actor_id, 'superadmin');
  end if;

  v_previous := v_profile.status;

  if p_status = 'suspended' and v_target_super and v_previous = 'active' and not exists (
    select 1
    from user_roles ur
    join profiles pr on pr.id = ur.user_id and pr.status = 'active'
    where ur.role = 'superadmin' and ur.scope_type = 'platform' and ur.user_id <> p_user_id
  ) then
    raise exception 'admin_set_user_status: refusing to suspend the last active superadmin'
      using errcode = 'check_violation';
  end if;

  if p_status = 'suspended' then
    v_deferred := _rider_in_progress(p_user_id);
    if not v_deferred then
      delete from auth.sessions where user_id = p_user_id;
    end if;
  end if;

  if v_previous = p_status then
    return jsonb_build_object('status', p_status, 'previous_status', v_previous, 'changed', false)
      || case when v_deferred then jsonb_build_object('sign_in_ban_deferred', true) else '{}'::jsonb end;
  end if;

  update profiles set status = p_status where id = p_user_id;

  if p_status = 'suspended' then
    update riders set is_online = false where user_id = p_user_id and is_online
    returning true into v_was_online;
  end if;

  perform _write_admin_audit(
    p_actor_id,
    case when p_status = 'suspended' then 'user.suspend' else 'user.reinstate' end,
    'user', p_user_id, v_reason,
    jsonb_build_object('to_status', p_status, 'rider_taken_offline', coalesce(v_was_online, false))
  );

  return jsonb_build_object('status', p_status, 'previous_status', v_previous, 'changed', true)
    || case when v_deferred then jsonb_build_object('sign_in_ban_deferred', true) else '{}'::jsonb end;
end;
$function$;

comment on function admin_set_user_status(uuid, text, text, uuid) is
  'Suspends or reinstates a user (profiles.status), audited, and returns {status, previous_status, changed}. Refuses self-targeting; changing an admin/superadmin requires a superadmin actor and cannot suspend the last active superadmin; suspending takes a rider offline and revokes the user''s auth sessions - except a rider on a delivery in progress, whose sessions are kept until it ends and for whom the result also carries sign_in_ban_deferred: true (the caller must then not apply the Auth ban yet, and re-submits the suspension afterwards). Idempotent: an unchanged status is a no-op with no audit row. The caller must otherwise apply the Supabase Auth ban (and lift it only when changed and previous_status was suspended) - this records the account state. service_role only.';

-- ---------------------------------------------------------------------------
-- Revoke a deferred suspension's sessions once the delivery ends
-- ---------------------------------------------------------------------------

create function release_suspended_rider_sessions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.rider_id is not null
     and _order_in_progress(old.status)
     and (not _order_in_progress(new.status) or new.rider_id is distinct from old.rider_id)
     and exists (select 1 from profiles where id = old.rider_id and status = 'suspended')
     and not _rider_in_progress(old.rider_id) then
    delete from auth.sessions where user_id = old.rider_id;
  end if;
  return null;
end;
$$;

comment on function release_suspended_rider_sessions() is
  'Trigger on orders: when a suspended rider''s last delivery in progress ends (delivered, failed, cancelled or reassigned), deletes their auth.sessions - the revocation admin_set_user_status() deferred. SECURITY DEFINER because it writes the auth schema.';

revoke all on function release_suspended_rider_sessions() from public, anon, authenticated, service_role;

create trigger orders_release_suspended_rider_sessions
  after update of status, rider_id on orders
  for each row
  when (old.status is distinct from new.status or old.rider_id is distinct from new.rider_id)
  execute function release_suspended_rider_sessions();
