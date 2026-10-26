-- KiaKia - dispatch worker, push through the transactional outbox, cron (design D4, D9, D11).
--
-- 1. WORKER. dispatch_tick() is a PROCEDURE that commits after every order, so a
--    slow or failing order never holds another order's row lock and one order's
--    failure cannot undo another's progress. It is SECURITY INVOKER on purpose:
--    PostgreSQL refuses COMMIT inside a SECURITY DEFINER procedure (and inside one
--    with a SET clause), verified on the local pg_cron ("invalid transaction
--    termination"). Everything privileged happens in SECURITY DEFINER functions it
--    calls (_dispatch_tick_claim, _dispatch_tick_order), which re-check the caller.
--    pg_cron can CALL it only as a SINGLE statement (a multi-statement command runs
--    in one implicit transaction block where COMMIT is illegal), so the job runs as
--    the job owner (postgres) with `call dispatch_tick();`, no `set role`.
--    Callers inside an ordinary transaction (PostgREST, pgTAP) cannot use the
--    procedure; they use _dispatch_tick_run(), the same loop in per-order
--    subtransactions without COMMIT. sweep_dispatch_offers() and
--    dispatch_orders_nearing_prep_completion() keep names, signatures and result
--    shapes and are now thin wrappers over _dispatch_tick_order().
-- 2. OUTBOX. Offer pushes go through message_outbox (channel 'push'), written in the
--    same transaction as the offer, instead of pg_net -> dispatch-push. The closed
--    offer trigger suppresses still-queued push/SMS and queues a "no longer
--    available" push when a told rider loses a live offer. Tokens are resolved by
--    message-worker at send time. dispatch-push and notify_rider_of_new_offer() stay
--    deployed (rollback path) but nothing triggers them.
-- 3. CRON. dispatch-tick every 5 s replaces the two old dispatch jobs; dispatch event
--    and rider_offer_responses retention are scheduled.

-- ---------------------------------------------------------------------------
-- 1. message_outbox: channel 'push', a data payload, suppress reason no_push_token
-- ---------------------------------------------------------------------------

alter table message_outbox add column data jsonb;

comment on column message_outbox.data is
  'Structured payload for push rows (ids only, e.g. {type, orderId, offerId}); null for email and SMS. Cleared by scrub_message_outbox() with the body.';

alter table message_outbox drop constraint message_outbox_channel_check;
alter table message_outbox add constraint message_outbox_channel_check
  check (channel in ('email', 'sms', 'push'));

alter table message_outbox drop constraint message_outbox_suppress_reason_check;
alter table message_outbox add constraint message_outbox_suppress_reason_check
  check (suppress_reason in ('no_address', 'no_consent', 'suspended', 'expired', 'rate_limited', 'opted_out', 'no_push_token'));

-- A push is a service notification: never marketing, so no consent row is involved
-- and message_claim_batch's promotional branch (which switches email/sms) can
-- never see one.
alter table message_outbox add constraint message_outbox_push_transactional
  check (channel <> 'push' or category = 'transactional');

create or replace function message_mark_suppressed(p_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform _message_assert_service('message_mark_suppressed');
  if p_reason not in ('no_address', 'no_consent', 'suspended', 'expired', 'opted_out', 'no_push_token') then
    raise exception 'message_mark_suppressed: unknown reason %', p_reason using errcode = 'check_violation';
  end if;
  update message_outbox set status = 'suppressed', suppress_reason = p_reason
  where id = p_id and status = 'sending';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

create or replace function scrub_message_outbox()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform _message_assert_service('scrub_message_outbox');
  update message_outbox
  set to_address = null, subject = null, body = '[removed]', data = null
  where status in ('sent', 'delivered', 'failed', 'suppressed')
    and created_at < now() - interval '90 days'
    and body <> '[removed]';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- enqueue_rider_offer_sms(): 0096's body, with ONE change. The hourly cap counted
-- every 'rider_offer' row of the rider; push rows are 'rider_offer' too now, so the
-- count is restricted to SMS rows and the SMS behaviour (cap of 6 texts per hour)
-- is exactly what it was.
create or replace function enqueue_rider_offer_sms()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_delay     integer := _message_setting('rider_offer_sms_delay_seconds');
  v_cap       integer := _message_setting('rider_offer_sms_hourly_cap');
  v_rec       record;
  v_fee       bigint;
  v_fee_part  text;
  v_body      text;
  v_sent_hour integer;
  v_status    text;
  v_queued    integer := 0;
  v_n         integer;
begin
  perform _message_assert_service('enqueue_rider_offer_sms');
  if _message_setting('rider_offer_sms_enabled') <> 1 then
    return 0;
  end if;

  for v_rec in
    select d.id as offer_id, d.rider_id, d.expires_at,
           v.name as vendor_name, v.location as vendor_location,
           pr.phone, o.rider_fee_kobo, o.distance_m,
           r.current_location,
           sa.rider_base_fee_kobo, sa.rider_per_km_fee_kobo
    from dispatch_offers d
    join orders o on o.id = d.order_id and o.rider_id is null
    join vendors v on v.id = o.vendor_id
    join riders r on r.user_id = d.rider_id and r.is_online and r.kyc_status = 'approved'
    join profiles pr on pr.id = d.rider_id and pr.status = 'active' and pr.phone is not null
    left join service_areas sa on sa.id = o.service_area_id
    where d.status = 'offered'
      and d.offered_at <= now() - make_interval(secs => v_delay)
      and d.expires_at > now() + interval '10 seconds'
      and not exists (select 1 from message_outbox m where m.dedupe_key = 'offer:' || d.id::text || ':sms')
    order by d.offered_at, d.id
  loop
    v_fee := null;
    if v_rec.current_location is not null and v_rec.vendor_location is not null
       and v_rec.rider_base_fee_kobo is not null then
      v_fee := v_rec.rider_base_fee_kobo
        + v_rec.rider_per_km_fee_kobo
          * ceil((st_distance(v_rec.current_location, v_rec.vendor_location) + coalesce(v_rec.distance_m, 0)) / 1000.0)::bigint;
    elsif v_rec.rider_fee_kobo > 0 then
      v_fee := v_rec.rider_fee_kobo;
    end if;
    v_fee_part := case when v_fee is not null and v_fee > 0
                       then ' worth about N' || to_char(round(v_fee / 100.0), 'FM999,999,999')
                       else '' end;

    v_body := 'KiaKia: new delivery from ' || coalesce(nullif(_message_clean_value(v_rec.vendor_name, 30), ''), 'a nearby vendor')
              || v_fee_part || '. Open the rider app to accept. Expires in ~'
              || greatest(1, floor(extract(epoch from (v_rec.expires_at - now()))))::integer::text || 's';

    select count(*) into v_sent_hour from message_outbox
    where kind = 'rider_offer' and channel = 'sms' and recipient_user_id = v_rec.rider_id
      and created_at > now() - interval '1 hour' and status <> 'suppressed';

    v_status := case when v_sent_hour >= v_cap then 'suppressed' else 'queued' end;

    insert into message_outbox (kind, channel, category, recipient_user_id, to_address, body, status,
                                suppress_reason, expires_at, dedupe_key)
    values ('rider_offer', 'sms', 'transactional', v_rec.rider_id, v_rec.phone, v_body, v_status,
            case when v_status = 'suppressed' then 'rate_limited' end,
            v_rec.expires_at, 'offer:' || v_rec.offer_id::text || ':sms')
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 and v_status = 'queued' then
      v_queued := v_queued + 1;
    end if;
  end loop;

  if v_queued > 0 then
    perform invoke_message_worker();
  end if;
  return v_queued;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Offer push through the outbox
-- ---------------------------------------------------------------------------
-- Privacy (as the 0096 SMS): vendor name only. No customer name, phone, address,
-- order code or delivery code, in the body or in data. data carries ids only.
-- to_address stays null: the Expo tokens are resolved from rider_push_tokens by
-- message-worker at send time, so a token registered after the offer was made
-- (or pruned meanwhile) is honoured, and nothing to scrub is stored.

create or replace function _dispatch_offer_queue_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor text;
begin
  begin
    select v.name into v_vendor
    from orders o join vendors v on v.id = o.vendor_id
    where o.id = new.order_id;

    insert into message_outbox (kind, channel, category, recipient_user_id, subject, body, data, expires_at, dedupe_key)
    values ('rider_offer', 'push', 'transactional', new.rider_id, 'New delivery',
            'Pickup from ' || coalesce(nullif(_message_clean_value(v_vendor, 40), ''), 'a nearby restaurant') || '. Tap to see it.',
            jsonb_build_object('type', 'dispatch_offer', 'orderId', new.order_id, 'offerId', new.id),
            new.expires_at, 'offer:' || new.id::text || ':push')
    on conflict (dedupe_key) do nothing;
    -- pg_net queues the request in this transaction: it is only sent if the offer commits.
    perform invoke_message_worker();
  exception when others then
    -- Never roll back the offer: the row (realtime/polling) is the authoritative channel.
    raise warning 'dispatch_offer_queue_push: offer % - %', new.id, sqlerrm;
    begin
      perform _dispatch_log(new.order_id, 'push_failed', jsonb_build_object('stage', 'enqueue', 'sqlstate', sqlstate), new.id, new.rider_id);
    exception when others then null;
    end;
  end;
  return new;
end;
$$;

comment on function _dispatch_offer_queue_push() is
  'AFTER INSERT on dispatch_offers (0103, D9): queues the rider push in message_outbox (dedupe offer:<id>:push, expires with the offer) and nudges message-worker. Replaces notify_rider_of_new_offer() as the trigger function; that function and the dispatch-push Edge Function remain deployed for rollback only.';
revoke all on function _dispatch_offer_queue_push() from public, anon, authenticated, service_role;

drop trigger dispatch_offers_notify_rider on dispatch_offers;
create trigger dispatch_offers_queue_push
  after insert on dispatch_offers
  for each row when (new.status = 'offered')
  execute function _dispatch_offer_queue_push();

comment on function notify_rider_of_new_offer() is
  'LEGACY (0065, superseded by 0103): the pg_net -> dispatch-push trigger function. No trigger calls it any more; offer pushes go through message_outbox. Kept, with the dispatch-push Edge Function, as the rollback path (recreate trigger dispatch_offers_notify_rider ... execute function notify_rider_of_new_offer()).';

-- One AFTER UPDATE OF status trigger owns every consequence of a live offer closing.
create or replace function _dispatch_offer_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_told boolean;
begin
  -- Anything about this offer that has not gone out yet must not go out now.
  update message_outbox
  set status = 'suppressed', suppress_reason = 'expired'
  where dedupe_key in ('offer:' || new.id::text || ':push', 'offer:' || new.id::text || ':sms')
    and status = 'queued';

  -- A rider who may already have been told (push claimed or sent) learns the offer is gone.
  if new.status in ('superseded', 'cancelled') then
    select exists (
      select 1 from message_outbox
      where dedupe_key = 'offer:' || new.id::text || ':push' and status in ('sending', 'sent', 'delivered')
    ) into v_told;
    if v_told then
      insert into message_outbox (kind, channel, category, recipient_user_id, subject, body, data, expires_at, dedupe_key)
      values ('rider_offer', 'push', 'transactional', new.rider_id, 'Offer withdrawn',
              'A delivery offer is no longer available.',
              jsonb_build_object('type', 'dispatch_offer_withdrawn', 'orderId', new.order_id, 'offerId', new.id),
              now() + interval '2 minutes', 'offer:' || new.id::text || ':withdrawn')
      on conflict (dedupe_key) do nothing;
      perform invoke_message_worker();
    end if;
  end if;
  return new;
exception when others then
  raise warning 'dispatch_offer_closed: offer % - %', new.id, sqlerrm;
  return new;
end;
$$;

comment on function _dispatch_offer_closed() is
  'AFTER UPDATE OF status on dispatch_offers when a live offer closes (0103, D9): suppresses the still-queued push/SMS for the offer (reason expired) and, when it was superseded/cancelled after the rider was pushed, queues the "no longer available" push (dedupe offer:<id>:withdrawn).';
revoke all on function _dispatch_offer_closed() from public, anon, authenticated, service_role;

create trigger dispatch_offers_closed
  after update of status on dispatch_offers
  for each row when (old.status = 'offered' and new.status is distinct from 'offered')
  execute function _dispatch_offer_closed();

-- ---------------------------------------------------------------------------
-- 3. The worker
-- ---------------------------------------------------------------------------

alter table dispatch_events drop constraint dispatch_events_event_check;
alter table dispatch_events add constraint dispatch_events_event_check
  check (event in ('scheduled', 'start_recomputed', 'cycle_started', 'ring_expanded', 'offer_created', 'offer_accepted',
                   'offer_declined', 'offer_expired', 'offer_cancelled', 'offer_superseded', 'accept_conflict',
                   'stale_accept_rejected', 'no_candidates', 'needs_attention', 'tick_error', 'prep_estimate_changed',
                   'ready_early', 'prep_overrun', 'eta_increased', 'rider_at_vendor', 'push_failed', 'tick_lag'));

-- Who may run the worker: the service role, or the database owner's own session
-- (pg_cron runs the job as its owner, postgres, with no role set). session_user is
-- the login, which a SECURITY DEFINER body does not change.
create function _dispatch_worker_caller_ok()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role(), current_setting('role', true)) = 'service_role' or session_user = 'postgres'
$$;
revoke all on function _dispatch_worker_caller_ok() from public, anon, authenticated;
grant execute on function _dispatch_worker_caller_ok() to service_role;

-- Due work: next_check_at due, plus the recovery predicates. A live offer past its
-- expiry, or a dispatchable rider-delivery order with no order_dispatch row, is
-- found even if its state row is missing or its next_check_at was lost. due = the
-- moment the work became due (null when unknown), used for the lag metric; the
-- order of work is by due time, falling back to the order's/state row's creation.
create function _dispatch_tick_claim(p_limit integer default 200)
returns table (order_id uuid, due timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not _dispatch_worker_caller_ok() then
    raise exception '_dispatch_tick_claim: requires the service-role key' using errcode = 'insufficient_privilege';
  end if;
  return query
    select x.oid, min(x.due)
    from (
      select od.order_id as oid, od.next_check_at as due, coalesce(od.next_check_at, od.created_at) as ord_at
      from order_dispatch od
      where od.state not in ('assigned', 'stopped') and (od.next_check_at is null or od.next_check_at <= now())
      union all
      select d.order_id, d.expires_at, d.expires_at from dispatch_offers d where d.status = 'offered' and d.expires_at <= now()
      union all
      select o.id, null::timestamptz, o.created_at from orders o
      where o.status in ('accepted', 'preparing', 'ready_for_pickup') and o.rider_id is null and o.delivery_by = 'rider'
        and o.payment_status = 'paid' and not exists (select 1 from order_dispatch od where od.order_id = o.id)
    ) x
    group by x.oid
    order by min(x.ord_at), x.oid
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

-- One order, one tick. The order row is taken FOR UPDATE SKIP LOCKED: a second
-- worker (or a rider accepting right now) holding it means this order is simply
-- skipped, never waited for and never advanced twice. Failures are recorded on
-- order_dispatch (backoff, then needs_attention) and never escape.
create function _dispatch_tick_order(p_order_id uuid, p_trigger text default 'tick', p_due timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     orders;
  v_res       jsonb;
  v_errors    integer;
  v_cancelled boolean := false;
  v_lag       numeric;
  v_state     text;
  v_msg       text;
  v_sqlstate  text;
begin
  if not _dispatch_worker_caller_ok() then
    raise exception '_dispatch_tick_order: requires the service-role key' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from orders where id = p_order_id for update skip locked;
  if not found then
    return jsonb_build_object('outcome', 'skipped');
  end if;

  -- Lag: how long past its due time the work was picked up. Only worth a row when it hurts.
  if p_due is not null then
    v_lag := extract(epoch from (clock_timestamp() - p_due));
    if v_lag > 10 then
      perform _dispatch_log(p_order_id, 'tick_lag', jsonb_build_object('lag_ms', round(v_lag * 1000), 'trigger', p_trigger));
    end if;
  end if;

  -- An order that reached ready_for_pickup before 0067 was never stamped; the give-up needs an anchor.
  if v_order.status = 'ready_for_pickup' and v_order.first_dispatched_at is null then
    update orders set first_dispatched_at = now() where id = v_order.id;
    v_order.first_dispatched_at := now();
  end if;

  begin
    v_res := _dispatch_advance(p_order_id, p_trigger);
    -- Success: consecutive-error bookkeeping starts over, a worker_errors alert clears itself.
    update order_dispatch
    set error_count = 0, last_error = null,
        needs_attention_since = case when attention_reason = 'worker_errors' then null else needs_attention_since end,
        attention_reason = case when attention_reason = 'worker_errors' then null else attention_reason end
    where order_id = p_order_id
      and (error_count > 0 or last_error is not null or attention_reason = 'worker_errors');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_sqlstate := sqlstate;
    raise warning '_dispatch_tick_order: order % failed - % (%)', p_order_id, v_msg, v_sqlstate;
    v_res := jsonb_build_object('outcome', 'error');

    -- The advance rolled back, including a state row it may have created: upsert one so
    -- the failure is recorded and the retry is backed off instead of hot-looping.
    insert into order_dispatch (order_id, state, error_count, last_error, next_check_at)
    values (p_order_id, case when v_order.status = 'ready_for_pickup' then 'searching' else 'scheduled' end,
            1, left(v_sqlstate || ': ' || v_msg, 500), now() + interval '5 seconds')
    on conflict (order_id) do update
    set error_count = order_dispatch.error_count + 1,
        last_error = left(v_sqlstate || ': ' || v_msg, 500),
        next_check_at = now() + make_interval(secs => least(5 * power(2, least(order_dispatch.error_count, 6)), 300))
    returning error_count into v_errors;

    perform _dispatch_log(p_order_id, 'tick_error', jsonb_build_object('error_count', v_errors, 'sqlstate', v_sqlstate, 'trigger', p_trigger));

    if v_errors >= 5 then
      update order_dispatch
      set state = 'needs_attention', needs_attention_since = coalesce(needs_attention_since, now()),
          attention_reason = 'worker_errors'
      where order_id = p_order_id and attention_reason is distinct from 'worker_errors';
      if found then
        perform _dispatch_log(p_order_id, 'needs_attention', jsonb_build_object('reason', 'worker_errors', 'error_count', v_errors));
      end if;
    end if;
  end;

  -- Nobody to ask: give up once a ready order has waited 30 minutes (0067/0076,
  -- unchanged; a failing order is not exempt either).
  if v_order.status = 'ready_for_pickup'
     and v_res ->> 'outcome' in ('no_candidates', 'error')
     and now() >= v_order.first_dispatched_at + interval '30 minutes' then
    begin
      perform transition_order(
        v_order.id, 'cancelled_by_platform', 'system', null,
        jsonb_build_object('reason', 'dispatch_exhausted_after_30_minutes')
      );
      v_cancelled := true;
    exception when others then
      raise warning '_dispatch_tick_order: failed to auto-cancel order % after 30 minutes with no rider - %', v_order.id, sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'outcome', v_res ->> 'outcome',
    'offers_expired', coalesce((v_res ->> 'offers_expired')::integer, 0),
    'cancelled', v_cancelled
  );
end;
$$;

comment on function _dispatch_tick_order(uuid, text, timestamptz) is
  'One dispatch tick for one order (0103, D4): order row FOR UPDATE SKIP LOCKED, _dispatch_advance, error_count/backoff/needs_attention(worker_errors) bookkeeping, tick_lag event past 10 s, and the 30-minute give-up for ready orders. Never raises for an order failure. service role or the owner session only.';

-- The same loop for callers that are inside a transaction (cannot COMMIT per order):
-- each order runs in its own subtransaction via the exception block of the function above.
create function _dispatch_tick_run(p_limit integer default 200, p_trigger text default 'tick')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       record;
  v_res       jsonb;
  v_processed integer := 0;
  v_expired   integer := 0;
  v_created   integer := 0;
  v_cancelled integer := 0;
  v_errors    integer := 0;
begin
  if not _dispatch_worker_caller_ok() then
    raise exception '_dispatch_tick_run: requires the service-role key' using errcode = 'insufficient_privilege';
  end if;
  for v_row in select * from _dispatch_tick_claim(p_limit) loop
    v_res := _dispatch_tick_order(v_row.order_id, p_trigger, v_row.due);
    if v_res ->> 'outcome' = 'skipped' then
      continue;
    end if;
    v_processed := v_processed + 1;
    v_expired := v_expired + (v_res ->> 'offers_expired')::integer;
    if v_res ->> 'outcome' = 'offered' then v_created := v_created + 1; end if;
    if v_res ->> 'outcome' = 'error' then v_errors := v_errors + 1; end if;
    if (v_res ->> 'cancelled')::boolean then v_cancelled := v_cancelled + 1; end if;
  end loop;
  return jsonb_build_object('processed', v_processed, 'offers_expired', v_expired, 'offers_created', v_created,
                            'orders_cancelled', v_cancelled, 'errors', v_errors);
end;
$$;

comment on function _dispatch_tick_run(integer, text) is
  'Transaction-safe batch of dispatch ticks (no COMMIT): used by the legacy wrappers and tests. The scheduled worker is the procedure dispatch_tick(), which commits per order.';

-- The scheduled worker. SECURITY INVOKER (see header): it holds no privileges of its
-- own and only calls the checked functions above. No SET clause either (COMMIT forbids it).
create procedure dispatch_tick(p_batch integer default 200)
language plpgsql
as $$
declare
  v_row record;
begin
  if not public._dispatch_worker_caller_ok() then
    raise exception 'dispatch_tick: requires the service-role key' using errcode = 'insufficient_privilege';
  end if;
  for v_row in select * from public._dispatch_tick_claim(p_batch) loop
    perform public._dispatch_tick_order(v_row.order_id, 'tick', v_row.due);
    commit;
  end loop;
end;
$$;

comment on procedure dispatch_tick(integer) is
  'The dispatch worker (0103, D4): claims due work (next_check_at due, expired live offers, dispatchable orders without a state row; at most p_batch, oldest first) and advances each order in its own transaction (COMMIT per order, row lock FOR UPDATE SKIP LOCKED). Run by pg_cron every 5 s as a single `call dispatch_tick();`. Cannot run inside an enclosing transaction block.';
revoke all on procedure dispatch_tick(integer) from public, anon, authenticated;
grant execute on procedure dispatch_tick(integer) to service_role;

revoke all on function _dispatch_tick_claim(integer) from public, anon, authenticated;
revoke all on function _dispatch_tick_order(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function _dispatch_tick_run(integer, text) from public, anon, authenticated;
grant execute on function _dispatch_tick_claim(integer) to service_role;
grant execute on function _dispatch_tick_order(uuid, text, timestamptz) to service_role;
grant execute on function _dispatch_tick_run(integer, text) to service_role;

-- Legacy entry points: same names, signatures, result shapes, service role only.
create or replace function sweep_dispatch_offers()
returns table(offers_expired integer, offers_created integer, orders_cancelled integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  if coalesce(auth.role(), current_setting('role', true)) is distinct from 'service_role' then
    raise exception 'sweep_dispatch_offers: requires the service-role key';
  end if;
  v_res := _dispatch_tick_run(100, 'sweep');
  return query select (v_res ->> 'offers_expired')::integer, (v_res ->> 'offers_created')::integer,
                      (v_res ->> 'orders_cancelled')::integer;
end;
$$;

create or replace function dispatch_orders_nearing_prep_completion()
returns table(offers_created integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
  v_id      uuid;
begin
  if coalesce(auth.role(), current_setting('role', true)) is distinct from 'service_role' then
    raise exception 'dispatch_orders_nearing_prep_completion: requires the service-role key';
  end if;

  for v_id in
    select o.id
    from orders o join order_dispatch od on od.order_id = o.id
    where o.status in ('accepted', 'preparing') and o.rider_id is null and o.delivery_by = 'rider'
      and od.state = 'scheduled' and od.start_at <= now()
    order by od.start_at
    limit 100
  loop
    if _dispatch_tick_order(v_id, 'early_dispatch') ->> 'outcome' = 'offered' then
      v_created := v_created + 1;
    end if;
  end loop;

  return query select v_created;
end;
$$;

comment on function sweep_dispatch_offers() is
  'Legacy wrapper (0103): one bounded batch of dispatch ticks (_dispatch_tick_run). Scheduling moved to the dispatch-tick procedure; kept for service-role callers and tests.';
comment on function dispatch_orders_nearing_prep_completion() is
  'Legacy wrapper (0103): ticks scheduled orders whose start_at has passed through _dispatch_tick_order. Scheduling moved to the dispatch-tick procedure; kept for service-role callers and tests.';

revoke execute on function sweep_dispatch_offers() from public, anon, authenticated;
revoke execute on function dispatch_orders_nearing_prep_completion() from public, anon, authenticated;
grant execute on function sweep_dispatch_offers() to service_role;
grant execute on function dispatch_orders_nearing_prep_completion() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Cron
-- ---------------------------------------------------------------------------
-- 0096's job list, with:
--   dispatch-tick               5 seconds   call dispatch_tick();  (single statement, owner session)
--   purge-dispatch-events       37 3 * * *  90-day dispatch_events retention
--   purge-rider-offer-responses 11 * * * *  rate-limit rows older than an hour
-- and the two old dispatch jobs unscheduled (guarded, idempotent).
-- ROLLBACK of the schedule: re-run 0096's cron.schedule calls for the two old jobs
-- and cron.unschedule('dispatch-tick'); the wrappers above still work.
-- OWNER on hosted: select _ensure_scheduled_jobs();   -- as postgres

create or replace function _ensure_scheduled_jobs()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_job     record;
  v_existing record;
  v_old     text;
  v_ok      boolean := true;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
      raise notice '_ensure_scheduled_jobs: pg_cron is not available on this server; nothing scheduled. Enable it (Dashboard -> Database -> Extensions) and run: select _ensure_scheduled_jobs();';
      return false;
    end if;
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice '_ensure_scheduled_jobs: could not enable pg_cron (%); nothing scheduled. Enable it in the dashboard and run: select _ensure_scheduled_jobs();', sqlerrm;
      return false;
    end;
  end if;

  for v_job in
    select * from (values
      ('dispatch-tick', '5 seconds',
       'call dispatch_tick();'),
      ('purge-dispatch-events', '37 3 * * *',
       'set local role service_role; select purge_dispatch_events();'),
      ('purge-rider-offer-responses', '11 * * * *',
       $purge$delete from rider_offer_responses where at < now() - interval '1 hour';$purge$),
      ('purge-customer-events', '17 3 * * *',
       'set local role service_role; select purge_customer_events();'),
      ('prune-cron-run-details', '43 3 * * *',
       $prune$delete from cron.job_run_details where end_time < now() - interval '7 days';$prune$),
      ('enqueue-rider-offer-sms', '15 seconds',
       'set local role service_role; select enqueue_rider_offer_sms();'),
      ('message-worker-tick', '10 seconds',
       'select invoke_message_worker();'),
      ('scrub-message-outbox', '29 3 * * *',
       'set local role service_role; select scrub_message_outbox();')
    ) as t(jobname, schedule, command)
  loop
    begin
      select schedule, command into v_existing from cron.job where jobname = v_job.jobname;
      if found
         and v_existing.schedule = v_job.schedule
         and regexp_replace(btrim(v_existing.command), '\s+', ' ', 'g') = v_job.command then
        continue; -- already correct; leave active flag alone
      end if;
      perform cron.schedule(v_job.jobname, v_job.schedule, v_job.command);
    exception when others then
      v_ok := false;
      raise notice '_ensure_scheduled_jobs: could not schedule % (%)', v_job.jobname, sqlerrm;
    end;
  end loop;

  -- Superseded by dispatch-tick (0103).
  foreach v_old in array array['sweep-dispatch-offers', 'dispatch-orders-nearing-prep-completion'] loop
    begin
      if exists (select 1 from cron.job where jobname = v_old) then
        perform cron.unschedule(v_old);
      end if;
    exception when others then
      v_ok := false;
      raise notice '_ensure_scheduled_jobs: could not unschedule % (%)', v_old, sqlerrm;
    end;
  end loop;

  return v_ok;
end;
$function$;

comment on function _ensure_scheduled_jobs() is
  'Idempotently (re)asserts the pg_cron jobs (dispatch-tick worker, dispatch_events and rider_offer_responses retention, customer_events retention, cron history prune, rider-offer SMS, message worker tick, message outbox scrub) and unschedules the superseded sweep-dispatch-offers / dispatch-orders-nearing-prep-completion jobs. Never raises when pg_cron is missing: NOTICE + false. Postgres/owner only.';

select _ensure_scheduled_jobs();
