-- KiaKia - scheduled jobs (re)assertion + DB write-path latency pass.
--
-- PART 1 - SCHEDULED BACKGROUND WORK
--
-- The full-cycle e2e reported that sweep_dispatch_offers() is "not scheduled
-- by any migration". It is: 0057 (TASK 3) schedules it with pg_cron every 15
-- seconds, and 0064 schedules dispatch_orders_nearing_prep_completion() every
-- minute. Both do it inside a DO block that only RAISES A NOTICE when pg_cron
-- cannot be enabled, so on a database where pg_cron was not available at
-- migration time the failure was silent and permanent: later migrations never
-- retried. On the local stack both jobs exist and have run ~5,500 times (see
-- cron.job_run_details); the e2e most likely ran against a database where
-- those NOTICEs fired. This migration therefore:
--
--   1. adds _ensure_scheduled_jobs(): a re-runnable, idempotent function that
--      (re)asserts every job below, job name = identity. A job that already
--      exists with the same schedule and command is left untouched (including
--      its active flag, so an operator who paused one keeps it paused). A job
--      that is missing, or whose schedule/command drifted, is (re)scheduled.
--      It never fails the migration: no pg_cron -> NOTICE and return false.
--   2. calls it once now.
--   3. adds cron_job_health() so an operator can prove the jobs run.
--
-- Jobs asserted:
--   sweep-dispatch-offers                    15 seconds  expire offers past TTL (60 s, 0078),
--                                                         re-dispatch, 30-minute give-up (0076)
--   dispatch-orders-nearing-prep-completion  * * * * *   early dispatch (0064)
--   purge-customer-events                    17 3 * * *  180-day retention (0084 wrote the
--                                                         function and deliberately did not
--                                                         schedule it). Not money: it deletes
--                                                         analytics rows only.
--   prune-cron-run-details                   43 3 * * *  cron.job_run_details grows without bound
--                                                         (15 s job = 5,760 rows/day); keep 7 days.
-- The sweep stays at 15 s rather than the 1 minute suggested: with a 60 s TTL
-- a 1-minute tick leaves an expired offer unattended for up to a minute (a
-- doubled rider wait), and the sweep is cheap (below). Every job that calls a
-- service_role-only function wraps it in `set [local] role service_role`
-- because pg_cron runs as the scheduling role (postgres), and those functions
-- check the caller's actual role (0055 header).
--
-- Concurrency / cost of sweep_dispatch_offers() (verified, not changed):
--   * pg_cron does not start a second run of a job while one is still running.
--   * Its expire step is a single UPDATE ... WHERE status = 'offered' AND
--     expires_at <= now(), served by the partial index
--     dispatch_offers_live_expiry_idx (0078); a concurrent run blocks on the
--     row locks and re-evaluates the predicate, so nothing is expired twice.
--   * Per-order work uses SELECT ... FOR UPDATE SKIP LOCKED, so it never queues
--     behind transition_order()/accept_dispatch_offer() on the same order.
--   * Candidates come from the partial index orders_awaiting_rider_idx.
--   * No authenticated caller needed: service_role via `set role`.
--
-- Still NOT scheduled, deliberately (reported, not built):
--   * admin_request_gateway_refund() moves money and is admin-initiated; there
--     is no retry sweeper to schedule.
--   * Nothing cancels abandoned 'pending_payment' orders (no function exists);
--     that is a product decision (a late webhook could still capture) - not
--     something to invent here.
--   * Delivery-code lockout has no time-based expiry to sweep (admin reset only).
--
-- OWNER ACTION on hosted Supabase if pg_cron is not enabled: Dashboard ->
-- Database -> Extensions -> enable "pg_cron", then run
--   select _ensure_scheduled_jobs();        -- as postgres (SQL editor)
-- Verify:
--   select * from cron_job_health();                            -- service role / postgres
--   select jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details
--     order by start_time desc limit 10;     -- expect 'succeeded' rows 15 s apart
-- Alternative if pg_cron is unavailable: an Edge Function / external scheduler
-- calling supabase.rpc('sweep_dispatch_offers') with the service-role key every
-- 15-30 s (0055 header). Not built: pg_cron is preloaded on Supabase and keeps
-- the work inside Postgres with no network hop or key to leak.
--
-- PART 2 - WRITE-PATH LATENCY (evidence: EXPLAIN ANALYZE / timed bulk loads on
-- seeded data inside rolled-back transactions, local stack, PG 17.6)
--
--   a. Redundant indexes dropped. ledger_entries carried THREE indexes led by
--      account_id: (account_id) from 0005, (account_id, created_at desc) from
--      0054 and an identical (account_id, created_at desc) from 0081. Any
--      query the single-column index can serve, the composite serves; the two
--      composites are byte-for-byte the same. Every ledger insert (payment
--      capture = 2+ rows, escrow release = 4 rows, refunds) maintained all of
--      them. Dropped: ledger_entries_account_id_idx and
--      ledger_entries_account_id_created_at_idx (kept 0081's
--      ledger_entries_account_created_idx). Measured on the local stack
--      (timed 2 x 100k-row inserts into ledger_entries, same session, rolled
--      back; the machine was noisy so ranges are quoted): 6 indexes 11.0-16.4 s,
--      4 indexes 5.3-9.2 s, i.e. roughly 35-65% less time per ledger row.
--   b. The three orders notify triggers now carry WHEN (old.status IS DISTINCT
--      FROM new.status). Each trigger function already begins with
--      `if new.status is not distinct from old.status then return new`, so
--      behaviour is identical; the WHEN clause just skips three SECURITY
--      DEFINER plpgsql calls on every non-status UPDATE of orders (the sweep's
--      dispatch_cycle_started_at stamps, rider_fee/updated_at touches). Trigger
--      names are unchanged, so AFTER-trigger firing order (alphabetical) is
--      unchanged.
--   c. RLS initplan rewrite for the rider-side policies 0089 deliberately left
--      for "a rider-side pass": riders, dispatch_offers, rider_documents,
--      rider_notifications, rider_push_tokens. `auth.uid()` -> `(select
--      auth.uid())`, nothing else. storage.objects policies are owned by
--      supabase_storage_admin and are left alone.
--      pg_policies BEFORE (qual / with_check, all roles {public}):
--        dispatch_offers     rider reads own offers           (rider_id = auth.uid())
--        rider_documents     rider reads own documents        (rider_id = auth.uid())
--        rider_notifications read own rider notifications     (rider_id = auth.uid())
--        rider_notifications update own rider notifications   (rider_id = auth.uid()) / (rider_id = auth.uid())
--        rider_push_tokens   rider reads own push tokens      (rider_id = auth.uid())
--        riders              read own rider row               (user_id = auth.uid())
--      AFTER: identical except `auth.uid()` appears as `( SELECT auth.uid() AS uid)`;
--      cmd and roles are unchanged (ALTER POLICY without TO keeps them).
--
-- CONSIDERED AND NOT CHANGED (no evidence of a problem, or a semantic change):
--   * Unindexed FKs: transactions.order_id, ledger_entries.order_id,
--     notifications.order_id, rider_notifications.order_id,
--     order_items.menu_item_id, carts.vendor_id, ... They only cost anything on
--     DELETE/key-UPDATE of the parent row (orders, menu_items, vendors are
--     never hard-deleted in app flows) while every added index taxes each
--     INSERT on a hot write table. Adding them would make writes slower.
--   * place_order / accept_dispatch_offer / transition_order locks: each locks
--     exactly one cart/order/rider row; no advisory locks anywhere.
--   * ledger balance triggers: deferred row triggers that SUM an account's
--     history. Only vendor/rider payout debits and customer-wallet rows do real
--     work (others exit on the accounts lookup). 2 ms at 2,000 rows per
--     account, linear. A covering (account_id) INCLUDE (direction, amount_kobo)
--     index would give index-only scans but needs a vacuumed table to evidence
--     and changes money-table storage; a materialised balance would be a
--     semantic change. Revisit when a vendor account passes ~50k entries.
--   * orders_status_idx (a strict prefix of orders_status_created_at_idx): a
--     100k-row status UPDATE timed 9.0-15.4 s with it and 11.4-37 s without in
--     repeated runs; that is noise, not evidence, so it is KEPT. Revisit with
--     a quieter benchmark host.
--
-- DEPLOY: DROP INDEX takes a brief ACCESS EXCLUSIVE lock on the table;
-- lock_timeout below makes it fail fast rather than queue behind traffic. On
-- a busy production database run these first, outside a transaction (no table
-- lock; the statements below then become no-ops):
--   drop index concurrently if exists ledger_entries_account_id_idx;
--   drop index concurrently if exists ledger_entries_account_id_created_at_idx;
-- DROP TRIGGER / CREATE TRIGGER on orders take SHARE ROW EXCLUSIVE for the
-- duration of the transaction only (metadata, no table rewrite).

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- PART 1
-- ---------------------------------------------------------------------------

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
       $prune$delete from cron.job_run_details where end_time < now() - interval '7 days';$prune$)
    ) as t(jobname, schedule, command)
  loop
    begin
      select schedule, command into v_existing from cron.job where jobname = v_job.jobname;
      if found
         and v_existing.schedule = v_job.schedule
         and regexp_replace(btrim(v_existing.command), '\s+', ' ', 'g') = v_job.command then
        continue; -- already correct; leave active flag alone
      end if;
      -- cron.schedule(name, ...) upserts by name (pg_cron >= 1.3).
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
  'Idempotently (re)asserts the pg_cron jobs (dispatch sweep, early dispatch, customer_events retention, cron history prune). Never raises when pg_cron is missing: NOTICE + false. Postgres/owner only.';

revoke all on function _ensure_scheduled_jobs() from public, anon, authenticated, service_role;

create or replace function cron_job_health()
returns table (
  jobname        text,
  schedule       text,
  active         boolean,
  last_status    text,
  last_start     timestamptz,
  last_message   text,
  runs_last_hour bigint,
  failed_last_hour bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  return query
    select j.jobname::text, j.schedule::text, j.active,
           l.status::text, l.start_time, l.return_message::text,
           coalesce(h.runs, 0), coalesce(h.failed, 0)
    from cron.job j
    left join lateral (
      select d.status, d.start_time, d.return_message
      from cron.job_run_details d where d.jobid = j.jobid
      order by d.start_time desc limit 1
    ) l on true
    left join lateral (
      select count(*) as runs, count(*) filter (where d.status = 'failed') as failed
      from cron.job_run_details d
      where d.jobid = j.jobid and d.start_time >= now() - interval '1 hour'
    ) h on true
    order by j.jobname;
end;
$function$;

comment on function cron_job_health() is
  'Operator check: every pg_cron job with its schedule, active flag, last run outcome and the last hour''s run/failure counts. service_role only. Empty when pg_cron is absent.';

revoke all on function cron_job_health() from public, anon, authenticated;
grant execute on function cron_job_health() to service_role;

select _ensure_scheduled_jobs();

-- ---------------------------------------------------------------------------
-- PART 2a - redundant ledger indexes
-- ---------------------------------------------------------------------------

drop index if exists ledger_entries_account_id_idx;
drop index if exists ledger_entries_account_id_created_at_idx;

-- ---------------------------------------------------------------------------
-- PART 2b - orders notify triggers: skip non-status updates
-- ---------------------------------------------------------------------------

drop trigger orders_notify_customer_on_status_change on orders;
create trigger orders_notify_customer_on_status_change
  after update on orders
  for each row
  when (old.status is distinct from new.status)
  execute function notify_customer_of_order_status_change();

drop trigger orders_notify_rider_on_status_change on orders;
create trigger orders_notify_rider_on_status_change
  after update on orders
  for each row
  when (old.status is distinct from new.status)
  execute function notify_rider_of_order_status_change();

drop trigger orders_notify_vendor_on_status_change on orders;
create trigger orders_notify_vendor_on_status_change
  after update on orders
  for each row
  when (old.status is distinct from new.status)
  execute function notify_vendor_of_order_status_change();

-- ---------------------------------------------------------------------------
-- PART 2c - rider-side RLS initplan rewrite
-- ---------------------------------------------------------------------------

alter policy "rider reads own offers" on dispatch_offers
  using (rider_id = (select auth.uid()));
alter policy "rider reads own documents" on rider_documents
  using (rider_id = (select auth.uid()));
alter policy "read own rider notifications" on rider_notifications
  using (rider_id = (select auth.uid()));
alter policy "update own rider notifications" on rider_notifications
  using (rider_id = (select auth.uid()))
  with check (rider_id = (select auth.uid()));
alter policy "rider reads own push tokens" on rider_push_tokens
  using (rider_id = (select auth.uid()));
alter policy "read own rider row" on riders
  using (user_id = (select auth.uid()));
