-- KiaKia - rider-offer SMS fallback + scheduling of the messaging pipeline.
--
-- RIDER OFFER SMS. A dispatch offer already reaches a rider by realtime/polling
-- in the rider app and by an Expo push (0065, fire-and-forget through pg_net).
-- If the rider's phone is asleep or offline, neither is guaranteed, so a short
-- SMS is queued as a fallback.
--
-- "NOT ACKNOWLEDGED", defined honestly from data that exists: THERE IS NO
-- ACK SIGNAL FOR AN OFFER. Push delivery is not recorded (pg_net is
-- fire-and-forget and Expo receipts are not stored), the app does not
-- report "offer seen", and dispatch_offers inserts deliberately write no
-- rider_notifications row (0053 explains why), so there is no is_read flag to
-- consult either. The only observable fact is: the offer is still 'offered'
-- (the rider has neither accepted nor declined) and unexpired N seconds after it
-- was created. That is the trigger: offered_at <= now() - 12 s (setting
-- rider_offer_sms_delay_seconds) AND at least 10 s of life left (an SMS that
-- would arrive after expiry is useless). A rider who accepts/declines in the
-- first 12 s is never texted; one who is looking at the offer but slow to act may
-- still be texted. If an ack signal is added later (e.g. the app calls an
-- "offer seen" RPC), add it to the WHERE clause below.
--
-- Safeguards: one SMS per offer (dedupe_key 'offer:<offer_id>:sms'), rider must
-- be online + KYC approved + active profile + have a phone, at most 6 SMS per
-- rider per rolling hour (rider_offer_sms_hourly_cap; the excess is recorded as
-- suppressed 'rate_limited'), the queued row expires with the offer
-- (expires_at = offer expiry, so a late worker never texts about a gone offer),
-- and a kill switch (message_settings.rider_offer_sms_enabled = 0).
-- Dispatch already limits an order to the nearest riders, so the fan-out is
-- bounded by that.
--
-- PRIVACY: the text contains only what a rider with a live offer may already
-- see in get_rider_offer_details() (0072: customer name/phone are NULL until the
-- rider accepts): the vendor's name and an estimated rider fee. No customer
-- name, phone or address, no order code, no delivery code. Covered by tests.

-- ---------------------------------------------------------------------------
-- invoke_message_worker: nudges the Edge Function through pg_net
-- ---------------------------------------------------------------------------
--
-- OWNER SETUP (secrets never go in git). Run once against the live project:
--   select vault.create_secret('https://<project-ref>.functions.supabase.co/message-worker',
--                              'message_worker_function_url');
--   select vault.create_secret('<same value as the function secret MESSAGE_WORKER_SECRET>',
--                              'message_worker_secret');
-- Until both exist this is a no-op (NOTICE only) and messages simply stay queued.

create function invoke_message_worker()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  -- Only call out when there is work the worker could actually claim.
  if not exists (
    select 1 from message_outbox q
    where q.status in ('queued', 'sending') and q.next_attempt_at <= now()
      and not (q.category = 'promotional' and q.channel = 'sms'
               and extract(hour from now() at time zone 'Africa/Lagos') not between 8 and 19)
  ) then
    return false;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'message_worker_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'message_worker_secret';
  if v_url is null or v_secret is null then
    raise notice 'invoke_message_worker: Vault secrets message_worker_function_url / message_worker_secret are not set; messages stay queued. See 0096 header.';
    return false;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  return true;
exception when others then
  raise notice 'invoke_message_worker: failed (%)', sqlerrm;
  return false;
end;
$$;

comment on function invoke_message_worker() is
  'Calls the message-worker Edge Function (pg_net, secret header from Vault) when the outbox has due work. Postgres/owner only (pg_cron and enqueue_rider_offer_sms()); never raises.';

revoke all on function invoke_message_worker() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- enqueue_rider_offer_sms
-- ---------------------------------------------------------------------------

create function enqueue_rider_offer_sms()
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
    -- Same estimate get_rider_offer_details() shows the rider (0044/0072).
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
    where kind = 'rider_offer' and recipient_user_id = v_rec.rider_id
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

comment on function enqueue_rider_offer_sms() is
  'Queues ONE transactional SMS per dispatch offer that is still open (offered, unexpired) rider_offer_sms_delay_seconds after it was made, for online, approved, active riders with a phone; max rider_offer_sms_hourly_cap per rider per hour. Body contains only vendor name + estimated fee. Idempotent (dedupe_key offer:<id>:sms). Returns the number queued. service_role only; run by pg_cron every 15 s.';

revoke execute on function enqueue_rider_offer_sms() from public, anon, authenticated;
grant execute on function enqueue_rider_offer_sms() to service_role;

-- ---------------------------------------------------------------------------
-- _ensure_scheduled_jobs: 0093's definition plus three jobs
-- ---------------------------------------------------------------------------
--   enqueue-rider-offer-sms  15 seconds  fallback SMS for open dispatch offers
--   message-worker-tick      10 seconds  nudge the message-worker Edge Function
--                                        when due messages exist (no-op if none)
--   scrub-message-outbox     29 3 * * *  90-day retention of addresses/bodies
-- OWNER: on hosted, after setting the Vault secrets above, run
--   select _ensure_scheduled_jobs();   -- as postgres; idempotent

create or replace function _ensure_scheduled_jobs()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_job     record;
  v_existing record;
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
      ('sweep-dispatch-offers', '15 seconds',
       'set role service_role; select sweep_dispatch_offers(); reset role;'),
      ('dispatch-orders-nearing-prep-completion', '* * * * *',
       'set local role service_role; select dispatch_orders_nearing_prep_completion();'),
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

  return v_ok;
end;
$function$;

comment on function _ensure_scheduled_jobs() is
  'Idempotently (re)asserts the pg_cron jobs (dispatch sweep, early dispatch, customer_events retention, cron history prune, rider-offer SMS, message worker tick, message outbox scrub). Never raises when pg_cron is missing: NOTICE + false. Postgres/owner only.';

select _ensure_scheduled_jobs();
