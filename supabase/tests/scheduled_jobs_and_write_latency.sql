-- pgTAP: 0093_scheduled_jobs_and_write_latency.sql.
--
-- (1) The pg_cron jobs exist with the intended schedule/command, and
--     _ensure_scheduled_jobs() is idempotent and heals drift.
--     Skipped (not failed) when pg_cron is absent, matching the migration.
-- (2) cron_job_health() is service_role only.
-- (3) The rewritten rider-side RLS policies keep exactly the same visibility.
-- (4) The orders notify triggers carry the status-change WHEN clause (their
--     notify behaviour itself is covered by the transition_order suites); the
--     redundant ledger indexes are gone while the kept one remains.

begin;
select plan(20);

select tests.create_supabase_user('rider_a');
select tests.create_supabase_user('rider_b');
select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('vendor_owner_a');

-- ---------------------------------------------------------------------------
-- (1) + (2) scheduler
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_extension where extname = 'pg_cron')
  or not exists (select 1 from pg_available_extensions where name = 'pg_cron'),
  'pg_cron is installed whenever the server offers it (migration enabled it)'
);

create temp table _cron_present as
  select exists (select 1 from pg_extension where extname = 'pg_cron') as yes;
grant all on _cron_present to public;

select ok(
  case when (select yes from _cron_present)
       then (select count(*) = 4 from cron.job where jobname in
              ('dispatch-tick','purge-dispatch-events','purge-customer-events','prune-cron-run-details'))
            and not exists (select 1 from cron.job where jobname in ('sweep-dispatch-offers','dispatch-orders-nearing-prep-completion'))
       else true end,
  'all four jobs are registered and the two pre-0103 dispatch jobs are gone (or pg_cron is absent)'
);

select is(
  case when (select yes from _cron_present)
       then (select schedule from cron.job where jobname = 'dispatch-tick') else '5 seconds' end,
  '5 seconds',
  'the dispatch worker runs every 5 seconds (0103; was the 15 s sweep)'
);

select ok(
  case when (select yes from _cron_present)
       then (select command = 'call dispatch_tick();' from cron.job where jobname = 'dispatch-tick')
       else true end,
  'the worker command is a single CALL (a procedure that commits per order cannot run in a multi-statement command)'
);

-- idempotent: a second call neither duplicates nor changes job ids
create temp table _ids as
  select case when (select yes from _cron_present)
    then (select array_agg(jobid order by jobname) from cron.job) else null end as ids;
grant all on _ids to public;

select is(_ensure_scheduled_jobs(), true, '_ensure_scheduled_jobs() returns true');
select is(
  case when (select yes from _cron_present)
       then (select array_agg(jobid order by jobname) from cron.job) else null end,
  (select ids from _ids),
  '_ensure_scheduled_jobs() is idempotent: same job ids, no duplicates'
);

-- heals drift, preserves a deliberately paused job
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.alter_job((select jobid from cron.job where jobname = 'dispatch-tick'), schedule => '30 seconds');
    perform cron.alter_job((select jobid from cron.job where jobname = 'purge-customer-events'), active => false);
  end if;
end $$;
do $$ begin perform _ensure_scheduled_jobs(); end $$;
select is(
  case when (select yes from _cron_present)
       then (select schedule from cron.job where jobname = 'dispatch-tick') else '5 seconds' end,
  '5 seconds',
  'a drifted schedule is restored'
);
select is(
  case when (select yes from _cron_present)
       then (select active from cron.job where jobname = 'purge-customer-events') else false end,
  false,
  'an unchanged job keeps an operator-set active=false'
);

select is(
  (select count(*)::int from pg_proc where proname = 'cron_job_health'
     and has_function_privilege('authenticated', oid, 'execute')),
  0, 'cron_job_health() is not executable by authenticated'
);
select is(
  (select count(*)::int from pg_proc where proname = 'cron_job_health'
     and has_function_privilege('service_role', oid, 'execute')),
  1, 'cron_job_health() is executable by service_role'
);
select is(
  (select count(*)::int from pg_proc where proname = '_ensure_scheduled_jobs'
     and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('service_role', oid, 'execute')
          or has_function_privilege('anon', oid, 'execute'))),
  0, '_ensure_scheduled_jobs() is not executable by any API role'
);
select ok(
  case when (select yes from _cron_present)
       then (select count(*) >= 4 from cron_job_health()) else true end,
  'cron_job_health() lists the jobs'
);

-- ---------------------------------------------------------------------------
-- (3) rider RLS equivalence
-- ---------------------------------------------------------------------------
insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('00000000-0000-7000-8000-0000000093a1', tests.get_supabase_uid('vendor_owner_a'), 'V93', 'v93', 'active', 1500);

insert into riders (user_id, is_online, current_location, last_ping_at, kyc_status) values
  (tests.get_supabase_uid('rider_a'), true, st_geogfromtext('POINT(7.5 9.5)'), now(), 'approved'),
  (tests.get_supabase_uid('rider_b'), true, st_geogfromtext('POINT(7.5 9.5)'), now(), 'approved');

insert into orders (id, customer_id, vendor_id, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values ('00000000-0000-7000-8000-0000000093a2', tests.get_supabase_uid('customer_a'),
        '00000000-0000-7000-8000-0000000093a1', 1000, 0, 0, 0, 1000, '{}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'));

insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no) values
  ('00000000-0000-7000-8000-0000000093a2', tests.get_supabase_uid('rider_a'), 'offered', 1, 1);
insert into rider_notifications (rider_id, order_id, title, body) values
  (tests.get_supabase_uid('rider_a'), null, 't', 'b');

select ok(
  (select bool_and(coalesce(qual,'') || coalesce(with_check,'') ~ 'SELECT auth\.uid\(\)')
   from pg_policies where schemaname = 'public' and policyname in
     ('rider reads own offers','rider reads own documents','read own rider notifications',
      'update own rider notifications','rider reads own push tokens','read own rider row')),
  'all six rider policies now use the initplan form'
);

select tests.authenticate_as('rider_a');
select is((select count(*)::int from dispatch_offers), 1, 'rider_a sees their own offer');
select is((select count(*)::int from rider_notifications), 1, 'rider_a sees their own notification');
select is((select count(*)::int from riders), 1, 'rider_a sees only their own rider row');
select tests.authenticate_as('rider_b');
select is(
  (select count(*)::int from dispatch_offers) + (select count(*)::int from rider_notifications)
  + (select count(*)::int from riders where user_id <> tests.get_supabase_uid('rider_b')),
  0, 'rider_b sees none of rider_a''s offers, notifications or rider row'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- (4) triggers + indexes
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_trigger
   where tgrelid = 'orders'::regclass and tgname like 'orders\_notify\_%'
     and pg_get_triggerdef(oid) ilike '%WHEN%old.status IS DISTINCT FROM new.status%'),
  3, 'the three notify triggers carry the status-change WHEN clause'
);

select is(
  (select count(*)::int from pg_indexes where tablename = 'ledger_entries'
     and indexname in ('ledger_entries_account_id_idx','ledger_entries_account_id_created_at_idx')),
  0, 'redundant ledger indexes are gone'
);
select is(
  (select count(*)::int from pg_indexes where tablename = 'ledger_entries' and indexname = 'ledger_entries_account_created_idx'),
  1, 'the (account_id, created_at desc) index remains'
);

select * from finish();
rollback;
