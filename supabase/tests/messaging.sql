-- pgTAP: email + SMS messaging (0094_messaging_core, 0095_messaging_admin_rpcs,
-- 0096_rider_offer_sms_and_scheduling).
--
-- Protects, in order of how bad a miss would be:
--  (1) CONSENT / COMPLIANCE: promotional sends only reach users with
--      marketing_<channel> = true; opt-out wins even for already queued rows;
--      suspended and addressless accounts are never sent to.
--  (2) AUTHORITY: every writer is service_role only; promotional broadcasts need
--      a superadmin, transactional an admin; clients cannot read the outbox.
--  (3) SAFETY RAILS: recipient cap, rate limit, idempotent double submit, length
--      limits, rider-offer SMS dedupe / hourly cap / no private data.
--  (4) WORKER CONTRACT: claim / retry / backoff / expiry / provider events.
--
-- Concurrency (FOR UPDATE SKIP LOCKED between two live sessions) cannot run
-- inside one transaction; here claims are exercised sequentially and the
-- no-double-claim property is asserted on the claimed set.

begin;
select plan(218);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('m_admin');
select tests.create_supabase_user('m_super');
select tests.create_supabase_user('m_c1');   -- customer, consent email+sms, recent order
select tests.create_supabase_user('m_c2');   -- customer, no consent, old order
select tests.create_supabase_user('m_c3');   -- customer, consent, unconfirmed email, no phone
select tests.create_supabase_user('m_c4');   -- customer, consent, suspended
select tests.create_supabase_user('m_c5');   -- customer, deleted
select tests.create_supabase_user('m_v1');   -- vendor owner (two stores: active + pending)
select tests.create_supabase_user('m_v2');   -- vendor owner (suspended store)
select tests.create_supabase_user('m_r1');   -- rider approved + online
select tests.create_supabase_user('m_r2');   -- rider approved offline
select tests.create_supabase_user('m_r3');   -- rider pending
select tests.create_supabase_user('m_r4');   -- rider rejected
select tests.create_supabase_user('m_r5');   -- rider approved + online but suspended
select tests.create_supabase_user('m_r6');   -- rider approved + online, no phone
select tests.create_supabase_user('m_nobody'); -- a plain non-admin actor

-- Neutralise every pre-existing account (dev data in a shared local DB): a
-- deleted profile is never in an audience. Rolled back with the transaction.
update profiles set status = 'deleted'
where id not in (select tests.get_supabase_uid(i) from (values
  ('m_admin'),('m_super'),('m_c1'),('m_c2'),('m_c3'),('m_c4'),('m_c5'),('m_v1'),('m_v2'),
  ('m_r1'),('m_r2'),('m_r3'),('m_r4'),('m_r5'),('m_r6'),('m_nobody')) t(i));
update profiles set status = 'deleted' where id in (tests.get_supabase_uid('m_c5'), tests.get_supabase_uid('m_nobody'));
update profiles set status = 'suspended' where id in (tests.get_supabase_uid('m_c4'), tests.get_supabase_uid('m_r5'));

insert into user_roles (user_id, role) values
  (tests.get_supabase_uid('m_admin'), 'admin'),
  (tests.get_supabase_uid('m_super'), 'superadmin'),
  (tests.get_supabase_uid('m_v1'), 'vendor_owner'),
  (tests.get_supabase_uid('m_v2'), 'vendor_owner'),
  (tests.get_supabase_uid('m_r1'), 'rider'), (tests.get_supabase_uid('m_r2'), 'rider'),
  (tests.get_supabase_uid('m_r3'), 'rider'), (tests.get_supabase_uid('m_r4'), 'rider'),
  (tests.get_supabase_uid('m_r5'), 'rider'), (tests.get_supabase_uid('m_r6'), 'rider');

-- names / phones / confirmed emails
update profiles set full_name = 'Ada Lovelace Okoro', phone = '+2348010000001' where id = tests.get_supabase_uid('m_c1');
update profiles set full_name = 'Bola Tinubu', phone = '+2348010000002' where id = tests.get_supabase_uid('m_c2');
update profiles set full_name = 'Chidi {{store_name}} Eze' where id = tests.get_supabase_uid('m_c3');
update profiles set full_name = 'Dayo Suspended', phone = '+2348010000004' where id = tests.get_supabase_uid('m_c4');
update profiles set full_name = 'Vera Vendor', phone = '+2348010000011' where id = tests.get_supabase_uid('m_v1');
update profiles set full_name = 'Wale Vendor', phone = '+2348010000012' where id = tests.get_supabase_uid('m_v2');
update profiles set full_name = 'Rita Rider', phone = '+2348010000021' where id = tests.get_supabase_uid('m_r1');
update profiles set full_name = 'Rex Rider', phone = '+2348010000022' where id = tests.get_supabase_uid('m_r2');
update profiles set full_name = 'Ruth Rider', phone = '+2348010000023' where id = tests.get_supabase_uid('m_r3');
update profiles set full_name = 'Remi Rider', phone = '+2348010000024' where id = tests.get_supabase_uid('m_r4');
update profiles set full_name = 'Rob Rider', phone = '+2348010000025' where id = tests.get_supabase_uid('m_r5');
update profiles set full_name = 'Ron Rider' where id = tests.get_supabase_uid('m_r6');
update profiles set full_name = 'Admin Person' where id = tests.get_supabase_uid('m_admin');

update auth.users set email_confirmed_at = now()
where id in (select tests.get_supabase_uid(i) from (values
  ('m_c1'),('m_c2'),('m_c4'),('m_v1'),('m_v2'),('m_r1'),('m_r2')) t(i));
-- m_c3 stays unconfirmed (no usable email) and has no phone.

create temp table _mail as select id, lower(email) as email from auth.users;
grant all on _mail to public;

insert into message_preferences (user_id, marketing_email, marketing_sms) values
  (tests.get_supabase_uid('m_c1'), true, true),
  (tests.get_supabase_uid('m_c3'), true, true),
  (tests.get_supabase_uid('m_c4'), true, true),
  (tests.get_supabase_uid('m_v1'), true, false);

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo,
                           rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('bf100000-0000-7000-8000-000000000001', 'M Area',
        st_geogfromtext('POLYGON((7.0 9.0, 8.0 9.0, 8.0 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 30000, 10000);

insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, location, created_at) values
  ('bf100000-0000-7000-8000-000000000011', tests.get_supabase_uid('m_v1'), 'Mama Put Kitchen', 'm-mama-put', 'active', true,
   st_geogfromtext('POINT(7.5 9.5)'), now() - interval '2 days'),
  ('bf100000-0000-7000-8000-000000000012', tests.get_supabase_uid('m_v1'), 'Second Store', 'm-second', 'pending', false,
   st_geogfromtext('POINT(7.5 9.5)'), now() - interval '1 day'),
  ('bf100000-0000-7000-8000-000000000013', tests.get_supabase_uid('m_v2'), 'Closed Down Cafe', 'm-closed', 'suspended', false,
   st_geogfromtext('POINT(7.5 9.5)'), now());

insert into riders (user_id, kyc_status, is_online, current_location) values
  (tests.get_supabase_uid('m_r1'), 'approved', true, st_geogfromtext('POINT(7.5 9.52)')),
  (tests.get_supabase_uid('m_r2'), 'approved', false, null),
  (tests.get_supabase_uid('m_r3'), 'pending', false, null),
  (tests.get_supabase_uid('m_r4'), 'rejected', false, null),
  (tests.get_supabase_uid('m_r5'), 'approved', true, null),
  (tests.get_supabase_uid('m_r6'), 'approved', true, null);

-- orders: c1 ordered 3 days ago, c2 ordered 40 days ago, c3 never
insert into orders (id, customer_id, vendor_id, status, subtotal_kobo, total_kobo, delivery_address, delivery_location, created_at)
values
  ('bf100000-0000-7000-8000-000000000021', tests.get_supabase_uid('m_c1'), 'bf100000-0000-7000-8000-000000000011', 'delivered',
   100000, 100000, '{"line1":"1 Test"}'::jsonb, st_geogfromtext('POINT(7.5 9.5)'), now() - interval '3 days'),
  ('bf100000-0000-7000-8000-000000000022', tests.get_supabase_uid('m_c2'), 'bf100000-0000-7000-8000-000000000011', 'delivered',
   100000, 100000, '{"line1":"2 Test"}'::jsonb, st_geogfromtext('POINT(7.5 9.5)'), now() - interval '40 days');

-- ---------------------------------------------------------------------------
-- 1. Privileges, RLS, structure
-- ---------------------------------------------------------------------------

select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('message_preferences'::regclass, 'message_broadcasts'::regclass, 'message_outbox'::regclass,
                         'message_settings'::regclass, 'message_consent_events'::regclass)),
  'RLS is enabled on every messaging table');

select ok(not has_table_privilege('authenticated', 'message_outbox', 'select')
      and not has_table_privilege('anon', 'message_outbox', 'select')
      and not has_table_privilege('authenticated', 'message_broadcasts', 'select')
      and not has_table_privilege('authenticated', 'message_settings', 'select')
      and not has_table_privilege('authenticated', 'message_consent_events', 'select'),
  'clients have no access to outbox, broadcasts, settings or the consent log');
select ok(has_table_privilege('service_role', 'message_outbox', 'select')
      and not has_table_privilege('service_role', 'message_outbox', 'insert')
      and not has_table_privilege('service_role', 'message_outbox', 'update')
      and not has_table_privilege('service_role', 'message_broadcasts', 'insert'),
  'service_role reads the outbox but writes only through the RPCs');
select ok(not has_table_privilege('authenticated', 'message_preferences', 'insert')
      and not has_table_privilege('authenticated', 'message_preferences', 'delete')
      and has_column_privilege('authenticated', 'message_preferences', 'marketing_email', 'update')
      and not has_column_privilege('authenticated', 'message_preferences', 'user_id', 'update'),
  'authenticated may only update the two marketing columns of message_preferences');
select is((select count(*) from pg_policies where tablename in ('message_outbox', 'message_broadcasts', 'message_settings', 'message_consent_events')),
  0::bigint, 'the outbox/broadcast/settings/consent tables have no RLS policies at all');

select ok(
  has_function_privilege('service_role', 'admin_audience_preview(jsonb,text,text)', 'execute')
  and has_function_privilege('service_role', 'admin_create_broadcast(uuid,jsonb,text,text,text,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'admin_send_message(uuid,uuid,text,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'admin_list_broadcasts(integer,integer)', 'execute')
  and has_function_privilege('service_role', 'admin_get_broadcast(uuid)', 'execute')
  and has_function_privilege('service_role', 'admin_list_user_messages(uuid,integer)', 'execute')
  and has_function_privilege('service_role', 'message_claim_batch(integer)', 'execute')
  and has_function_privilege('service_role', 'message_apply_provider_event(text,text,uuid,text,text)', 'execute')
  and has_function_privilege('service_role', 'message_opt_out(uuid,text,text)', 'execute')
  and has_function_privilege('service_role', 'enqueue_rider_offer_sms()', 'execute'),
  'service_role can execute every messaging RPC');
select ok(
  not has_function_privilege('authenticated', 'admin_audience_preview(jsonb,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'admin_create_broadcast(uuid,jsonb,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'admin_send_message(uuid,uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'admin_list_broadcasts(integer,integer)', 'execute')
  and not has_function_privilege('authenticated', 'admin_get_broadcast(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'admin_list_user_messages(uuid,integer)', 'execute')
  and not has_function_privilege('authenticated', 'message_claim_batch(integer)', 'execute')
  and not has_function_privilege('authenticated', 'message_mark_sent(uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'message_mark_failed(uuid,text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'message_apply_provider_event(text,text,uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'message_opt_out(uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'enqueue_rider_offer_sms()', 'execute')
  and not has_function_privilege('authenticated', 'scrub_message_outbox()', 'execute'),
  'authenticated cannot execute any admin / worker messaging RPC');
select ok(
  not has_function_privilege('anon', 'admin_create_broadcast(uuid,jsonb,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'set_message_preferences(boolean,boolean)', 'execute')
  and not has_function_privilege('anon', 'message_claim_batch(integer)', 'execute'),
  'anon cannot execute messaging RPCs');
select ok(
  has_function_privilege('authenticated', 'set_message_preferences(boolean,boolean)', 'execute')
  and has_function_privilege('authenticated', 'get_message_preferences()', 'execute')
  and has_function_privilege('service_role', 'get_message_preferences()', 'execute') is not null,
  'signed-in users can call set/get_message_preferences');
select ok(
  not has_function_privilege('service_role', 'invoke_message_worker()', 'execute')
  and not has_function_privilege('authenticated', 'invoke_message_worker()', 'execute')
  and not has_function_privilege('service_role', '_message_resolve_audience(jsonb,text,text)', 'execute')
  and not has_function_privilege('service_role', '_message_check_content(text,text,text,text,text)', 'execute'),
  'internal helpers and the pg_net invoker are not executable by any API role');


-- ---------------------------------------------------------------------------
-- 2. Authority (callers)
-- ---------------------------------------------------------------------------

select tests.authenticate_as('m_c1');
select throws_ok($$ select * from message_outbox $$, '42501', null, 'a signed-in user cannot read the outbox');
select throws_ok($$ select * from message_broadcasts $$, '42501', null, 'a signed-in user cannot read broadcasts');
select throws_ok(
  format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional', 's', 'b', 'r') $$,
         tests.get_supabase_uid('m_admin')),
  '42501', null, 'a signed-in user cannot call admin_create_broadcast');

select tests.authenticate_as_service_role();

select throws_ok(
  format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional', 's', 'b', 'r') $$,
         tests.get_supabase_uid('m_nobody')),
  'P0001', null, 'a non-admin actor is refused');
select throws_ok(
  $$ select admin_create_broadcast(null, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional', 's', 'b', 'r') $$,
  'P0001', null, 'a missing actor is refused');
select throws_ok(
  format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'promotional', 's', 'b', 'r') $$,
         tests.get_supabase_uid('m_admin')),
  '42501', null, 'PROMOTIONAL broadcasts need a superadmin: a plain admin is refused');
select throws_ok(
  format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'sms', 'promotional', null, 'b', 'r') $$,
         tests.get_supabase_uid('m_admin')),
  '42501', null, '... for SMS too');
select throws_ok(
  format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional', 's', 'b', '  ') $$,
         tests.get_supabase_uid('m_admin')),
  '23514', null, 'a blank reason is refused');
select is((select count(*) from message_broadcasts), 0::bigint, 'refused calls created no broadcast');

-- ---------------------------------------------------------------------------
-- 3. Audience validation (strict)
-- ---------------------------------------------------------------------------

select throws_ok($$ select admin_audience_preview('{"kind":"role","role":"customer","extra":1}'::jsonb, 'email', 'transactional') $$,
  '23514', null, 'unknown audience key rejected');
select throws_ok($$ select admin_audience_preview('{"kind":"role","role":"admin","segment":"all"}'::jsonb, 'email', 'transactional') $$,
  '23514', null, 'role must be customer / vendor / rider');
select throws_ok($$ select admin_audience_preview('{"kind":"role","role":"customer","segment":"online"}'::jsonb, 'email', 'transactional') $$,
  '23514', null, 'a rider-only segment is invalid for customers');
select throws_ok($$ select admin_audience_preview('{"kind":"role","role":"vendor","segment":"ordered_30d"}'::jsonb, 'email', 'transactional') $$,
  '23514', null, 'a customer-only segment is invalid for vendors');
select throws_ok($$ select admin_audience_preview('{"kind":"role","role":"rider","segment":"suspended"}'::jsonb, 'email', 'transactional') $$,
  '23514', null, 'riders have no suspended segment');
select throws_ok($$ select admin_audience_preview('{"kind":"everyone"}'::jsonb, 'email', 'transactional') $$,
  '23514', null, 'unknown kind rejected');
select throws_ok($$ select admin_audience_preview('{"kind":"user","user_id":"not-a-uuid"}'::jsonb, 'email', 'transactional') $$,
  '23514', null, 'a non-UUID user_id rejected');
select throws_ok($$ select admin_audience_preview('{"kind":"user","user_id":"00000000-0000-0000-0000-000000000000","segment":"all"}'::jsonb, 'email', 'transactional') $$,
  '23514', null, 'a user audience takes no segment');
select throws_ok($$ select admin_audience_preview('[1]'::jsonb, 'email', 'transactional') $$,
  '23514', null, 'a non-object audience rejected');
select throws_ok($$ select admin_audience_preview('{"kind":"user","user_id":"00000000-0000-0000-0000-000000000000"}'::jsonb, 'email', 'transactional') $$,
  'P0002', null, 'a nonexistent user is reported, not silently empty');
select throws_ok($$ select admin_audience_preview('{"kind":"role","role":"customer"}'::jsonb, 'push', 'transactional') $$,
  '23514', null, 'channel must be email or sms');
select throws_ok($$ select admin_audience_preview('{"kind":"role","role":"customer"}'::jsonb, 'email', 'marketing') $$,
  '23514', null, 'category must be transactional or promotional');

-- ---------------------------------------------------------------------------
-- 4. Audience segments + preview shape
--    customers: c1 (recent order), c2 (old order), c3 (never), c4 (suspended); c5 deleted.
-- ---------------------------------------------------------------------------

select is(admin_audience_preview('{"kind":"role","role":"customer"}'::jsonb, 'sms', 'transactional') #>> '{recipient_count}',
  '2', 'customers/all over SMS (transactional): c1 + c2 deliverable (c3 has no phone, c4 suspended)');
select is(admin_audience_preview('{"kind":"role","role":"customer","segment":"all"}'::jsonb, 'sms', 'transactional') #> '{suppressed_reasons}',
  '{"no_address":1,"no_consent":0,"suspended":1}'::jsonb, 'suppressed reasons: c3 no_address, c4 suspended; the deleted c5 is absent entirely');
select is(admin_audience_preview('{"kind":"role","role":"customer","segment":"ordered_30d"}'::jsonb, 'sms', 'transactional') #>> '{recipient_count}',
  '1', 'ordered_30d = c1 only (c2 ordered 40 days ago)');
select is((admin_audience_preview('{"kind":"role","role":"customer","segment":"inactive_30d"}'::jsonb, 'sms', 'transactional') ->> 'recipient_count')::int
        + (admin_audience_preview('{"kind":"role","role":"customer","segment":"inactive_30d"}'::jsonb, 'sms', 'transactional') ->> 'suppressed_count')::int,
  3, 'inactive_30d = c2 + c3 + c4 (never-ordered counts; suspended listed but suppressed)');
select is(admin_audience_preview('{"kind":"role","role":"customer"}'::jsonb, 'email', 'promotional') #> '{suppressed_reasons}',
  '{"no_address":1,"no_consent":1,"suspended":1}'::jsonb, 'promotional email: c2 no_consent, c3 no_address, c4 suspended');
select is(admin_audience_preview('{"kind":"role","role":"customer"}'::jsonb, 'email', 'promotional') #>> '{recipient_count}',
  '1', 'promotional email reaches only c1 (the one confirmed-email consenting active customer)');
select is(jsonb_array_length(admin_audience_preview('{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional') -> 'sample'),
  2, 'sample lists the deliverable recipients (max 5)');
select ok(admin_audience_preview('{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional')::text not like '%@%',
  'preview never exposes email addresses');
select is((select array_agg(k order by k) from jsonb_object_keys(
            (admin_audience_preview('{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional') -> 'sample') -> 0) k),
  array['display_name','role','user_id'], 'sample rows are {user_id, display_name, role}');

select is(admin_audience_preview('{"kind":"role","role":"vendor"}'::jsonb, 'email', 'transactional') ->> 'recipient_count',
  '2', 'vendors/all: one row per owner (v1 has two stores)');
select is(admin_audience_preview('{"kind":"role","role":"vendor","segment":"active"}'::jsonb, 'email', 'transactional') ->> 'recipient_count',
  '1', 'vendor active = v1 (store status active)');
select is(admin_audience_preview('{"kind":"role","role":"vendor","segment":"pending"}'::jsonb, 'email', 'transactional') ->> 'recipient_count',
  '1', 'vendor pending = v1 via its pending store');
select is(admin_audience_preview('{"kind":"role","role":"vendor","segment":"suspended"}'::jsonb, 'email', 'transactional') ->> 'recipient_count',
  '1', 'vendor suspended = v2 (suspended STORE; the owner account itself is active)');
select is(admin_audience_preview('{"kind":"role","role":"vendor"}'::jsonb, 'email', 'promotional') #>> '{recipient_count}',
  '1', 'vendor promotional email: v1 has consent, v2 does not');

select is(admin_audience_preview('{"kind":"role","role":"rider"}'::jsonb, 'sms', 'transactional') ->> 'recipient_count',
  '4', 'riders/all over SMS: r1 r2 r3 r4 (r5 suspended, r6 no phone)');
select is(admin_audience_preview('{"kind":"role","role":"rider","segment":"active"}'::jsonb, 'sms', 'transactional') ->> 'recipient_count',
  '2', 'rider active = approved: r1, r2 deliverable (r5 suspended / r6 no phone suppressed)');
select is(admin_audience_preview('{"kind":"role","role":"rider","segment":"pending"}'::jsonb, 'sms', 'transactional') ->> 'recipient_count',
  '1', 'rider pending = r3');
select is(admin_audience_preview('{"kind":"role","role":"rider","segment":"online"}'::jsonb, 'sms', 'transactional') ->> 'recipient_count',
  '1', 'rider online = approved + is_online: r1 (r5, r6 online but undeliverable)');
select is(admin_audience_preview('{"kind":"role","role":"rider","segment":"online"}'::jsonb, 'sms', 'transactional') #> '{suppressed_reasons}',
  '{"no_address":1,"no_consent":0,"suspended":1}'::jsonb, 'online riders: r6 no_address, r5 suspended');
select is(admin_audience_preview(jsonb_build_object('kind','user','user_id',tests.get_supabase_uid('m_c1')), 'email', 'promotional') ->> 'recipient_count',
  '1', 'single user audience resolves (with consent)');
select is(admin_audience_preview(jsonb_build_object('kind','user','user_id',tests.get_supabase_uid('m_c2')), 'email', 'promotional') #>> '{suppressed_reasons,no_consent}',
  '1', 'single user without consent is suppressed for promotional');
select is(admin_audience_preview(jsonb_build_object('kind','user','user_id',tests.get_supabase_uid('m_r1')), 'sms', 'transactional') #>> '{sample,0,role}',
  'rider', 'a single user''s role is derived (rider)');

-- ---------------------------------------------------------------------------
-- 5. Content rules, variables
-- ---------------------------------------------------------------------------

create temp table _aud (a jsonb);
grant all on _aud to public;
insert into _aud values ('{"kind":"role","role":"customer"}'::jsonb);

select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'sms', 'transactional', null, %L, 'r') $$,
  tests.get_supabase_uid('m_admin'), repeat('a', 613)), '23514', null, 'SMS over 612 characters rejected');
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'sms', 'transactional', null, %L, 'r') $$,
  tests.get_supabase_uid('m_admin'), repeat('a', 600) || '{{first_name}}'), '23514', null,
  'worst-case variable expansion counts: 600 chars + {{first_name}} (up to 40) exceeds 612');
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'sms', 'transactional', null, %L, 'r') $$,
  tests.get_supabase_uid('m_admin'), repeat(U&'\00e9', 269)), '23514', null, 'a non-ASCII (Unicode) SMS is limited to 268 characters');
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'sms', 'promotional', null, %L, 'r') $$,
  tests.get_supabase_uid('m_super'), repeat('a', 441)), '23514', null, 'promotional SMS leaves room for the opt-out line (440)');
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional', %L, 'b', 'r') $$,
  tests.get_supabase_uid('m_admin'), repeat('s', 151)), '23514', null, 'email subject over 150 rejected');
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional', E'line1\nline2', 'b', 'r') $$,
  tests.get_supabase_uid('m_admin')), '23514', null, 'a multi-line subject (header injection) rejected');
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional', 's', %L, 'r') $$,
  tests.get_supabase_uid('m_admin'), repeat('b', 5001)), '23514', null, 'email body over 5000 rejected');
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'transactional', null, 'b', 'r') $$,
  tests.get_supabase_uid('m_admin')), '23514', null, 'an email needs a subject');
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'sms', 'transactional', 'subject', 'b', 'r') $$,
  tests.get_supabase_uid('m_admin')), '23514', null, 'an SMS must not carry a subject');
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'sms', 'transactional', null, '{{foo}}', 'r') $$,
  tests.get_supabase_uid('m_admin')), '23514', null, 'a body that is empty after variables are removed is rejected');
select is(_message_render('Hi {{first_name}} / {{ FIRST_NAME }} / {{store_name}} / {{nope}} / {{', 'Ada', 'Kitchen'),
  'Hi Ada / Ada / Kitchen /  / {{', 'variables: case-insensitive, spaces tolerated, unknown -> empty, stray braces kept');
select is(_message_render('{{first_name}}', 'a{{store_name}}b', 'S'), 'astore_nameb', 'braces are stripped from substituted values, so no second-order substitution');
select is(_message_render('{{first_name}}', repeat('z', 100), 'S'), repeat('z', 40), 'first_name is capped at 40 characters');
select is(_message_render('{{store_name}}', 'x', repeat('z', 100)), repeat('z', 60), 'store_name is capped at 60 characters');
select is(_message_render('{{first_name}}', 'a\1&b', 'S'), 'a\1&b', 'backslashes and ampersands in values are literal');

-- ---------------------------------------------------------------------------
-- 6. Broadcast creation: consent, suppression, audit
-- ---------------------------------------------------------------------------

create temp table _ids (k text primary key, v uuid);
grant all on _ids to public;

insert into _ids select 'promo_email', admin_create_broadcast(
  tests.get_supabase_uid('m_super'), '{"kind":"role","role":"customer"}'::jsonb, 'email', 'promotional',
  'Weekend deal for {{first_name}}', 'Hi {{first_name}}, 10% off this weekend. {{unknown}}', 'Weekend promo');

select is((select recipient_count from message_broadcasts where id = (select v from _ids where k = 'promo_email')), 1,
  'promo broadcast recipient_count = consenting deliverable customers (c1)');
select is((select count(*) from message_outbox where broadcast_id = (select v from _ids where k = 'promo_email')), 4::bigint,
  'one outbox row per resolved account (c1, c2, c3, c4)');
select is((select status from message_outbox where broadcast_id = (select v from _ids where k = 'promo_email') and recipient_user_id = tests.get_supabase_uid('m_c1')),
  'queued', 'consenting customer is queued');
select is((select suppress_reason from message_outbox where broadcast_id = (select v from _ids where k = 'promo_email') and recipient_user_id = tests.get_supabase_uid('m_c2')),
  'no_consent', 'no consent -> suppressed with reason no_consent (never sent)');
select is((select suppress_reason from message_outbox where broadcast_id = (select v from _ids where k = 'promo_email') and recipient_user_id = tests.get_supabase_uid('m_c3')),
  'no_address', 'unconfirmed email -> suppressed no_address');
select is((select suppress_reason from message_outbox where broadcast_id = (select v from _ids where k = 'promo_email') and recipient_user_id = tests.get_supabase_uid('m_c4')),
  'suspended', 'suspended account (even with consent) -> suppressed suspended');
select is((select subject || ' | ' || body from message_outbox where broadcast_id = (select v from _ids where k = 'promo_email') and recipient_user_id = tests.get_supabase_uid('m_c1')),
  'Weekend deal for Ada | Hi Ada, 10% off this weekend. ', 'subject and body are rendered per recipient (first_name, unknown -> empty)');
select is((select to_address from message_outbox where broadcast_id = (select v from _ids where k = 'promo_email') and recipient_user_id = tests.get_supabase_uid('m_c1')),
  (select email from _mail where id = tests.get_supabase_uid('m_c1')), 'the address is the confirmed auth email');
select is((select count(*) from message_outbox where broadcast_id = (select v from _ids where k = 'promo_email') and status = 'queued' and category <> 'promotional'),
  0::bigint, 'outbox rows inherit the promotional category');
select is((select count(*) from admin_audit_log where action = 'message.broadcast' and target_id = (select v from _ids where k = 'promo_email')
           and target_type = 'message' and actor_id = tests.get_supabase_uid('m_super') and reason = 'Weekend promo'),
  1::bigint, 'exactly one audit row (message.broadcast / message) with actor and reason');
select is((select details ->> 'recipient_count' from admin_audit_log where target_id = (select v from _ids where k = 'promo_email')),
  '1', 'audit details carry the recipient count');

-- transactional broadcast by a plain admin: no consent needed
insert into _ids select 'tx_sms', admin_create_broadcast(
  tests.get_supabase_uid('m_admin'), '{"kind":"role","role":"customer"}'::jsonb, 'sms', 'transactional',
  null, E'KiaKia: service notice for {{first_name}}.\r\nThanks', 'Planned maintenance notice');
select is((select recipient_count from message_broadcasts where id = (select v from _ids where k = 'tx_sms')), 2,
  'transactional SMS needs no consent: c1 and c2 queued (c3 no phone, c4 suspended)');
select is((select body from message_broadcasts where id = (select v from _ids where k = 'tx_sms')),
  E'KiaKia: service notice for {{first_name}}.\nThanks', 'the stored template normalises CRLF');
select is((select count(*) from message_outbox where broadcast_id = (select v from _ids where k = 'tx_sms') and status = 'queued' and subject is null),
  2::bigint, 'SMS rows have no subject');

-- ---------------------------------------------------------------------------
-- 7. Idempotency, caps, rate limits
-- ---------------------------------------------------------------------------

select is(admin_create_broadcast(tests.get_supabase_uid('m_admin'), '{"kind":"role","role":"customer"}'::jsonb, 'sms', 'transactional',
  null, E'KiaKia: service notice for {{first_name}}.\nThanks', 'Planned maintenance notice'),
  (select v from _ids where k = 'tx_sms'), 'a double submit (same admin, same content and audience) returns the original broadcast');
select is((select count(*) from message_broadcasts), 2::bigint, '... and created no second broadcast');
select is((select count(*) from message_outbox where kind = 'broadcast'), 8::bigint, '... and no extra outbox rows (4 + 4)');

insert into _ids select 'idem', admin_create_broadcast(tests.get_supabase_uid('m_admin'), '{"kind":"role","role":"vendor"}'::jsonb,
  'email', 'transactional', 'Vendor notice', 'Hello {{store_name}}', 'Vendor ops notice', 'key-1');
select is(admin_create_broadcast(tests.get_supabase_uid('m_admin'), '{"kind":"role","role":"vendor"}'::jsonb,
  'email', 'transactional', 'DIFFERENT subject', 'Different body', 'again', 'key-1'),
  (select v from _ids where k = 'idem'), 'the same idempotency key returns the original even if the content differs');
select is((select body from message_outbox where broadcast_id = (select v from _ids where k = 'idem') and recipient_user_id = tests.get_supabase_uid('m_v1')),
  'Hello Mama Put Kitchen', '{{store_name}} resolves to the owner''s earliest store');
select is((select body from message_outbox where broadcast_id = (select v from _ids where k = 'idem') and recipient_user_id = tests.get_supabase_uid('m_v2')),
  'Hello Closed Down Cafe', '... and to the other owner''s store');

-- recipient cap
reset role;
update message_settings set value_int = 1 where key = 'broadcast_recipient_cap';
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"rider"}'::jsonb, 'sms', 'transactional', null, 'cap test', 'cap') $$,
  tests.get_supabase_uid('m_admin')), '23514', null, 'a broadcast over the recipient cap is refused');
select is((select count(*) from message_broadcasts where audience_label = 'Riders: all'), 0::bigint, '... and leaves nothing behind (rolled back)');
reset role;
update message_settings set value_int = 5000 where key = 'broadcast_recipient_cap';
select tests.authenticate_as_service_role();

-- zero deliverable
select throws_ok(format($$ select admin_create_broadcast(%L, jsonb_build_object('kind','user','user_id',%L::uuid), 'email', 'promotional', 's', 'b', 'r') $$,
  tests.get_supabase_uid('m_super'), tests.get_supabase_uid('m_c2')), '23514', null,
  'a broadcast with no deliverable recipient is refused');

-- rate limit (promotional): limit 1 per 24 h, one already exists
reset role;
update message_settings set value_int = 1 where key = 'promo_broadcasts_per_day';
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_create_broadcast(%L, '{"kind":"role","role":"customer"}'::jsonb, 'email', 'promotional', 'another', 'another body', 'second') $$,
  tests.get_supabase_uid('m_super')), '23514', null, 'the promotional rate limit blocks a second, different broadcast');
select is(admin_create_broadcast(tests.get_supabase_uid('m_super'), '{"kind":"role","role":"customer"}'::jsonb, 'email', 'promotional',
  'Weekend deal for {{first_name}}', 'Hi {{first_name}}, 10% off this weekend. {{unknown}}', 'Weekend promo'),
  (select v from _ids where k = 'promo_email'), 'a repeat of the identical request still returns the original (checked before the limit)');
reset role;
update message_settings set value_int = 5 where key = 'promo_broadcasts_per_day';
select tests.authenticate_as_service_role();

-- ---------------------------------------------------------------------------
-- 8. admin_send_message
-- ---------------------------------------------------------------------------

select throws_ok(format($$ select admin_send_message(%L, %L, 'email', 's', 'b', 'r') $$,
  tests.get_supabase_uid('m_nobody'), tests.get_supabase_uid('m_c1')), 'P0001', null, 'send_message: a non-admin actor is refused');
select throws_ok(format($$ select admin_send_message(%L, %L, 'email', 's', 'b', ' ') $$,
  tests.get_supabase_uid('m_admin'), tests.get_supabase_uid('m_c1')), '23514', null, 'send_message: a reason is required');
select throws_ok(format($$ select admin_send_message(%L, %L, 'email', 's', 'b', 'r') $$,
  tests.get_supabase_uid('m_admin'), tests.get_supabase_uid('m_c4')), '23514', 'admin_send_message: the account is suspended; no message was sent',
  'send_message refuses a suspended account with a clear error');
select throws_ok(format($$ select admin_send_message(%L, %L, 'sms', null, 'b', 'r') $$,
  tests.get_supabase_uid('m_admin'), tests.get_supabase_uid('m_c3')), '23514', null, 'send_message refuses a user with no phone');
select throws_ok(format($$ select admin_send_message(%L, %L, 'email', 's', 'b', 'r') $$,
  tests.get_supabase_uid('m_admin'), tests.get_supabase_uid('m_c3')), '23514', null, 'send_message refuses a user with no confirmed email');
select throws_ok(format($$ select admin_send_message(%L, '00000000-0000-0000-0000-000000000000', 'email', 's', 'b', 'r') $$,
  tests.get_supabase_uid('m_admin')), 'P0002', null, 'send_message refuses an unknown user');

insert into _ids select 'direct', admin_send_message(tests.get_supabase_uid('m_admin'), tests.get_supabase_uid('m_c2'), 'email',
  'Your refund', 'Hello {{first_name}}, your refund was processed.', 'Support follow-up');
select is((select category || '/' || kind || '/' || status || '/' || body from message_outbox where id = (select v from _ids where k = 'direct')),
  'transactional/direct/queued/Hello Bola, your refund was processed.', 'a direct message is queued transactional, rendered, even without marketing consent');
select is(admin_send_message(tests.get_supabase_uid('m_admin'), tests.get_supabase_uid('m_c2'), 'email',
  'Your refund', 'Hello {{first_name}}, your refund was processed.', 'clicked twice'),
  (select v from _ids where k = 'direct'), 'a double-clicked direct message returns the original id');
select is((select count(*) from message_outbox where kind = 'direct'), 1::bigint, '... and queued once');
select is((select count(*) from admin_audit_log where action = 'message.send' and target_type = 'message' and target_id = (select v from _ids where k = 'direct')),
  1::bigint, 'one audit row (message.send), none for the replay');

-- ---------------------------------------------------------------------------
-- 9. Reads
-- ---------------------------------------------------------------------------

select is((select count(*) from admin_list_broadcasts(10, 0)), 3::bigint, 'admin_list_broadcasts lists the three broadcasts');
select is((select total_count from admin_list_broadcasts(1, 0)), 3::bigint, 'total_count is repeated on every row');
select is((select queued || '/' || suppressed from admin_list_broadcasts(10, 0) where audience_label = 'Customers: all' and channel = 'email'),
  '1/3', 'list counts: promo email 1 queued, 3 suppressed');
select is((select (admin_get_broadcast((select v from _ids where k = 'promo_email'))) #> '{counts,suppressed_reasons}'),
  '{"no_address": 1, "no_consent": 1, "suspended": 1}'::jsonb, 'get_broadcast: suppressed reasons');
select is((select (admin_get_broadcast((select v from _ids where k = 'promo_email'))) ->> 'reason'), 'Weekend promo', 'get_broadcast carries the reason');
select ok((admin_get_broadcast((select v from _ids where k = 'promo_email')))::text not like '%@%', 'get_broadcast never returns addresses');
select throws_ok($$ select admin_get_broadcast('00000000-0000-0000-0000-000000000000') $$, 'P0002', null, 'get_broadcast: unknown id');
select is((select count(*) from admin_list_user_messages(tests.get_supabase_uid('m_c1'), 10)), 2::bigint,
  'list_user_messages: c1 has the promo email and the SMS notice');
select throws_ok(format($$ select * from admin_list_user_messages(%L, 0) $$, tests.get_supabase_uid('m_c1')), '23514', null, 'list_user_messages validates the limit');

-- ---------------------------------------------------------------------------
-- 10. Consent, opt-out, preferences RLS
-- ---------------------------------------------------------------------------

-- opt out c1's email while the promo row is still queued
select is(message_opt_out(tests.get_supabase_uid('m_c1'), 'email', 'unsubscribe_link'), true, 'opt-out reports a change');
select is((select marketing_email from message_preferences where user_id = tests.get_supabase_uid('m_c1')), false, 'marketing_email is now false');
select is((select marketing_sms from message_preferences where user_id = tests.get_supabase_uid('m_c1')), true, '... and the other channel is untouched');
select is((select status || '/' || suppress_reason from message_outbox where broadcast_id = (select v from _ids where k = 'promo_email') and recipient_user_id = tests.get_supabase_uid('m_c1')),
  'suppressed/opted_out', 'the already-queued promotional email is suppressed by the opt-out');
select is((select count(*) from message_consent_events where user_id = tests.get_supabase_uid('m_c1') and channel = 'email' and granted = false and source = 'unsubscribe_link'),
  1::bigint, 'the consent log records the withdrawal and its source');
select is(message_opt_out(tests.get_supabase_uid('m_c1'), 'email', 'unsubscribe_link'), false, 'a second opt-out is an idempotent no-op');
select is((select count(*) from message_outbox where recipient_user_id = tests.get_supabase_uid('m_c1') and category = 'transactional' and status = 'queued'),
  1::bigint, 'opt-out leaves transactional messages alone');
select throws_ok(format($$ select message_opt_out(%L, 'push') $$, tests.get_supabase_uid('m_c1')), '23514', null, 'opt-out validates the channel');
select is(message_opt_out('00000000-0000-0000-0000-000000000000', 'sms'), false, 'opt-out of an unknown user is a harmless no-op');

-- RLS on message_preferences
select tests.authenticate_as('m_c1');
select is((select count(*) from message_preferences), 1::bigint, 'a user sees only their own preferences row');
select is((select user_id from message_preferences), tests.get_supabase_uid('m_c1'), '... which is theirs');
select is((select marketing_sms from get_message_preferences()), true, 'get_message_preferences returns the effective values');
select is((select marketing_email from set_message_preferences(true, null)), true, 'set_message_preferences(email=true) grants consent; NULL leaves sms unchanged');
select is((select marketing_sms from message_preferences), true, '... sms still true');
update message_preferences set marketing_sms = false;
select is((select marketing_sms from message_preferences), false, 'direct UPDATE of the own row works (RLS own-row policy)');
select throws_ok($$ update message_preferences set user_id = gen_random_uuid() $$, '42501', null, 'user_id cannot be updated');
select throws_ok($$ insert into message_preferences (user_id) values (gen_random_uuid()) $$, '42501', null, 'direct INSERT is not allowed (use set_message_preferences)');
select throws_ok($$ delete from message_preferences $$, '42501', null, 'direct DELETE is not allowed');
select throws_ok($$ select * from message_consent_events $$, '42501', null, 'the consent log is not readable by a user');

select tests.authenticate_as('m_c2');
select is((select count(*) from message_preferences), 0::bigint, 'another user sees no preference rows (c2 has none)');
update message_preferences set marketing_email = true;
select is((select marketing_email from get_message_preferences()), false, 'c2 cannot flip anyone else''s consent; effective default is false');
select is((select marketing_email from set_message_preferences(true, true)), true, 'c2 can opt in for themselves (lazy upsert)');

select tests.authenticate_as('m_v1');
select is((select marketing_email from get_message_preferences()), true, 'vendors can read their own preferences too');
select is((select marketing_sms from set_message_preferences(null, true)), true, 'vendors can set their own preferences');

select tests.authenticate_as('m_r1');
select is((select marketing_email from set_message_preferences(false, false)), false, 'riders can call set_message_preferences');

select tests.authenticate_as('m_c4');
select is((select marketing_email from set_message_preferences(false, false)), false, 'a SUSPENDED account can still withdraw consent');

select tests.clear_authentication();
select throws_ok($$ select set_message_preferences(true, true) $$, '42501', null, 'anon cannot call set_message_preferences');

select tests.authenticate_as_service_role();
select is((select count(*) from message_consent_events where user_id = tests.get_supabase_uid('m_c2') and channel = 'email' and granted and source = 'user'),
  1::bigint, 'granting consent was logged with source user');

-- a promotional send after opt-out reaches nobody who opted out
select is(admin_audience_preview('{"kind":"role","role":"customer"}'::jsonb, 'sms', 'promotional') ->> 'recipient_count',
  '1', 'promotional SMS audience now: c2 (just opted in); c1 turned sms off, c3 has no phone, c4 suspended');

-- ---------------------------------------------------------------------------
-- 11. Worker: claim, send, retry, expiry
-- ---------------------------------------------------------------------------

-- Start from a clean slate: park every queued row (dev data included).
reset role;
update message_outbox set status = 'suppressed', suppress_reason = 'expired' where status = 'queued';
create temp table _w (k text primary key, v uuid);
grant all on _w to public;
insert into message_outbox (id, kind, channel, category, recipient_user_id, to_address, subject, body, dedupe_key)
select gen_random_uuid(), 'system', 'email', 'transactional', tests.get_supabase_uid('m_c1'), 'a' || g || '@example.com', 's', 'b' || g, 'w:' || g
from generate_series(1, 5) g;
select tests.authenticate_as_service_role();

select is((select count(*) from message_claim_batch(3)), 3::bigint, 'claim returns the requested batch size');
select is((select count(*) from message_outbox where dedupe_key like 'w:%' and status = 'sending' and attempts = 1), 3::bigint,
  'claimed rows are sending with attempts = 1');
select is((select count(*) from message_claim_batch(10)), 2::bigint,
  'a second claim returns only the remaining rows (no row is handed out twice)');
select is((select count(*) from message_claim_batch(10)), 0::bigint, 'nothing left to claim');
select throws_ok($$ select * from message_claim_batch(0) $$, '23514', null, 'claim validates the batch size');

insert into _w select 'a', id from message_outbox where dedupe_key = 'w:1';
insert into _w select 'b', id from message_outbox where dedupe_key = 'w:2';
insert into _w select 'c', id from message_outbox where dedupe_key = 'w:3';
insert into _w select 'd', id from message_outbox where dedupe_key = 'w:4';
insert into _w select 'e', id from message_outbox where dedupe_key = 'w:5';

select is(message_mark_sent((select v from _w where k = 'a'), 'resend', 'prov-1'), true, 'mark_sent from sending');
select is((select status || '/' || provider || '/' || provider_message_id || '/' || (sent_at is not null)::text from message_outbox where id = (select v from _w where k = 'a')),
  'sent/resend/prov-1/true', 'mark_sent records provider, provider id and sent_at');
select is(message_mark_sent((select v from _w where k = 'a'), 'resend', 'prov-1'), false, 'mark_sent is a no-op on a row that is no longer sending');

-- transient failure -> queued with backoff
select is(message_mark_failed((select v from _w where k = 'b'), 'HTTP 503', false), 'queued', 'a transient failure re-queues');
select ok((select next_attempt_at between now() + interval '25 seconds' and now() + interval '35 seconds' and attempts = 1 and error = 'HTTP 503'
           from message_outbox where id = (select v from _w where k = 'b')), 'attempt 1 backs off ~30 s and records the error');
select is((select count(*) from message_claim_batch(10) where id = (select v from _w where k = 'b')), 0::bigint, 'a backed-off row is not due yet');
select is(array(select _message_backoff_seconds(n) from generate_series(1, 6) n), array[30, 120, 480, 1920, 3600, 3600],
  'backoff: 30s, 2m, 8m, 32m, then capped at 60m');
-- walk attempts to the cap
reset role;
update message_outbox set next_attempt_at = now() where id = (select v from _w where k = 'b');
select tests.authenticate_as_service_role();
select is((select attempts from message_claim_batch(10) where id = (select v from _w where k = 'b')), 2, 'after the delay it is claimed again (attempts = 2)');
select is(message_mark_failed((select v from _w where k = 'b'), 'HTTP 503', false), 'queued', 'attempt 2 re-queues');
select ok((select next_attempt_at between now() + interval '110 seconds' and now() + interval '130 seconds' from message_outbox where id = (select v from _w where k = 'b')),
  'attempt 2 backs off ~120 s');
reset role;
update message_outbox set status = 'sending', attempts = 5 where id = (select v from _w where k = 'b');
select tests.authenticate_as_service_role();
select is(message_mark_failed((select v from _w where k = 'b'), 'HTTP 503', false), 'failed', 'the 5th failed attempt is final (failed)');
-- permanent
select is(message_mark_failed((select v from _w where k = 'c'), 'invalid address', true), 'failed', 'a permanent failure is final at once');
select is((select status || '/' || error from message_outbox where id = (select v from _w where k = 'c')), 'failed/invalid address', '... with the error recorded');
select is(message_mark_failed((select v from _w where k = 'c'), 'again', true), 'ignored', 'mark_failed on a non-sending row is ignored');
-- worker-side suppression
select is(message_mark_suppressed((select v from _w where k = 'd'), 'no_address'), true, 'worker can suppress a row it holds');
select is((select status || '/' || suppress_reason from message_outbox where id = (select v from _w where k = 'd')), 'suppressed/no_address', '... recorded with its reason');
select throws_ok($$ select message_mark_suppressed(gen_random_uuid(), 'because') $$, '23514', null, 'mark_suppressed validates the reason');
select is(message_mark_failed((select v from _w where k = 'e'), 'x', false), 'queued', 'e is re-queued once');

-- lease expiry on a stuck 'sending' row
reset role;
update message_outbox set status = 'sending', attempts = 2, next_attempt_at = now() - interval '1 minute' where id = (select v from _w where k = 'e');
select tests.authenticate_as_service_role();
select is((select attempts from message_claim_batch(10) where id = (select v from _w where k = 'e')), 3, 'a row stuck in sending past its lease is re-claimed (attempts + 1)');
reset role;
update message_outbox set status = 'sending', attempts = 5, next_attempt_at = now() - interval '1 minute' where id = (select v from _w where k = 'e');
select tests.authenticate_as_service_role();
select is((select count(*) from message_claim_batch(10) where id = (select v from _w where k = 'e')), 0::bigint, 'an exhausted stuck row is not re-claimed');
select is((select status || '/' || error from message_outbox where id = (select v from _w where k = 'e')), 'failed/worker_timeout', '... it is failed (worker_timeout)');

-- expiry of a queued row
reset role;
insert into message_outbox (kind, channel, category, recipient_user_id, to_address, body, expires_at, dedupe_key)
values ('rider_offer', 'sms', 'transactional', tests.get_supabase_uid('m_r1'), '+2348010000021', 'gone', now() - interval '1 second', 'w:exp');
select tests.authenticate_as_service_role();
select is((select count(*) from message_claim_batch(10) where dedupe_key = 'w:exp'), 0::bigint, 'an expired queued row is not claimed');
select is((select status || '/' || suppress_reason from message_outbox where dedupe_key = 'w:exp'), 'suppressed/expired', '... it becomes suppressed(expired)');

-- promotional consent re-check at claim time, and the SMS time window
reset role;
insert into message_outbox (kind, channel, category, recipient_user_id, to_address, subject, body, dedupe_key) values
  ('broadcast', 'email', 'promotional', tests.get_supabase_uid('m_c3'), 'c3@example.com', 's', 'promo to a user without consent row-state', 'w:promo-noconsent'),
  ('broadcast', 'email', 'promotional', tests.get_supabase_uid('m_c2'), 'c2@example.com', 's', 'promo to consenting c2', 'w:promo-consent'),
  ('broadcast', 'sms', 'promotional', tests.get_supabase_uid('m_c2'), '+2348010000002', null, 'promo sms to consenting c2', 'w:promo-sms');
delete from message_preferences where user_id = tests.get_supabase_uid('m_c3');
select tests.authenticate_as_service_role();
select is((select count(*) from message_claim_batch(50) where dedupe_key = 'w:promo-consent'), 1::bigint, 'a promotional email with consent is claimed');
select is((select status || '/' || suppress_reason from message_outbox where dedupe_key = 'w:promo-noconsent'), 'suppressed/no_consent',
  'a promotional row whose recipient has no consent at claim time is suppressed, not sent');
select is((select status from message_outbox where dedupe_key = 'w:promo-sms'),
  case when extract(hour from now() at time zone 'Africa/Lagos') between 8 and 19 then 'sending' else 'queued' end,
  'promotional SMS is only released between 08:00 and 20:00 Lagos time');

-- ---------------------------------------------------------------------------
-- 12. Provider events
-- ---------------------------------------------------------------------------

reset role;
insert into message_outbox (id, kind, channel, category, recipient_user_id, to_address, subject, body, status, provider, provider_message_id, dedupe_key) values
  ('bf100000-0000-7000-8000-0000000000a1', 'broadcast', 'email', 'promotional', tests.get_supabase_uid('m_c2'), 'c2@example.com', 's', 'b', 'sent', 'resend', 'em_1', 'p:1'),
  ('bf100000-0000-7000-8000-0000000000a2', 'broadcast', 'email', 'promotional', tests.get_supabase_uid('m_c2'), 'c2@example.com', 's', 'b', 'sent', 'resend', 'em_2', 'p:2'),
  ('bf100000-0000-7000-8000-0000000000a3', 'broadcast', 'email', 'promotional', tests.get_supabase_uid('m_c2'), 'c2@example.com', 's', 'b', 'sent', 'resend', 'em_3', 'p:3'),
  ('bf100000-0000-7000-8000-0000000000a4', 'rider_offer', 'sms', 'transactional', tests.get_supabase_uid('m_r1'), '+2348010000021', null, 'b', 'sent', 'termii', 'sms_1', 'p:4');
select tests.authenticate_as_service_role();
select is(message_apply_provider_event('resend', 'em_1', null, 'delivered'), 'applied', 'delivered receipt applies by provider id');
select is((select status || '/' || (delivered_at is not null)::text from message_outbox where id = 'bf100000-0000-7000-8000-0000000000a1'), 'delivered/true', '... status delivered with delivered_at');
select is(message_apply_provider_event('resend', 'em_1', null, 'delivered'), 'ignored', 'a replayed delivered receipt is ignored (idempotent)');
select is(message_apply_provider_event('resend', 'missing', null, 'delivered'), 'not_found', 'an unknown provider id reports not_found (webhook answers non-2xx so the provider retries)');
select is(message_apply_provider_event('termii', null, 'bf100000-0000-7000-8000-0000000000a4', 'failed', 'DND blocked'), 'applied', 'failed receipt applies by outbox id');
select is((select status || '/' || error from message_outbox where id = 'bf100000-0000-7000-8000-0000000000a4'), 'failed/DND blocked', '... status failed with the detail');
select is((select marketing_email from message_preferences where user_id = tests.get_supabase_uid('m_c2')), true, 'c2 still has email consent before any bounce');
select is(message_apply_provider_event('resend', 'em_2', null, 'bounced', 'Permanent bounce'), 'applied', 'a hard bounce applies');
select is((select status from message_outbox where id = 'bf100000-0000-7000-8000-0000000000a2'), 'failed', '... the message is failed');
select is((select marketing_email from message_preferences where user_id = tests.get_supabase_uid('m_c2')), false, '... and marketing_email is withdrawn');
select is((select count(*) from message_consent_events where user_id = tests.get_supabase_uid('m_c2') and source = 'provider_bounce' and not granted), 1::bigint, '... logged with source provider_bounce');
reset role;
update message_preferences set marketing_email = true where user_id = tests.get_supabase_uid('m_c2');
select tests.authenticate_as_service_role();
select is(message_apply_provider_event('resend', 'em_3', null, 'complained'), 'applied', 'a spam complaint applies');
select is((select error from message_outbox where id = 'bf100000-0000-7000-8000-0000000000a3'), 'spam_complaint', '... recorded');
select is((select marketing_email from message_preferences where user_id = tests.get_supabase_uid('m_c2')), false, '... and withdraws marketing_email');
select throws_ok($$ select message_apply_provider_event('resend', 'x', null, 'opened') $$, '23514', null, 'unknown event rejected');
select tests.authenticate_as('m_c1');
select throws_ok($$ select message_apply_provider_event('resend', 'x', null, 'delivered') $$, '42501', null, 'a signed-in user cannot post provider events');
select tests.authenticate_as_service_role();

-- retention scrub
reset role;
update message_outbox set created_at = now() - interval '100 days' where id = 'bf100000-0000-7000-8000-0000000000a1';
select tests.authenticate_as_service_role();
select ok(scrub_message_outbox() >= 1, 'scrub_message_outbox blanks old finished rows');
select is((select to_address is null and body = '[removed]' and status = 'delivered' from message_outbox where id = 'bf100000-0000-7000-8000-0000000000a1'),
  true, '... address and body gone, status kept');

-- ---------------------------------------------------------------------------
-- 13. Rider offer SMS
-- ---------------------------------------------------------------------------

reset role;
-- private data that must never appear in the SMS
update profiles set full_name = 'Secretina Customerson', phone = '+2349099988877' where id = tests.get_supabase_uid('m_c1');
insert into orders (id, code, customer_id, vendor_id, service_area_id, status, subtotal_kobo, total_kobo, delivery_address, delivery_location, distance_m) values
  ('bf100000-0000-7000-8000-000000000031', 'MSG-ORD-1', tests.get_supabase_uid('m_c1'), 'bf100000-0000-7000-8000-000000000011', 'bf100000-0000-7000-8000-000000000001',
   'ready_for_pickup', 500000, 500000, '{"line1":"77 Hidden Street Secretland"}'::jsonb, st_geogfromtext('POINT(7.55 9.55)'), 2500),
  ('bf100000-0000-7000-8000-000000000032', 'MSG-ORD-2', tests.get_supabase_uid('m_c1'), 'bf100000-0000-7000-8000-000000000011', 'bf100000-0000-7000-8000-000000000001',
   'ready_for_pickup', 500000, 500000, '{"line1":"78 Hidden Street Secretland"}'::jsonb, st_geogfromtext('POINT(7.55 9.55)'), 2500);

-- order 1: r1 (should text), r2 offline, r5 suspended, r6 no phone, r3 not approved; order 2: r1 again (cap test) + fresh offer for r2
insert into dispatch_offers (id, order_id, rider_id, status, offered_at, expires_at) values
  ('bf100000-0000-7000-8000-000000000041', 'bf100000-0000-7000-8000-000000000031', tests.get_supabase_uid('m_r1'), 'offered', now() - interval '20 seconds', now() + interval '40 seconds'),
  ('bf100000-0000-7000-8000-000000000042', 'bf100000-0000-7000-8000-000000000031', tests.get_supabase_uid('m_r2'), 'offered', now() - interval '20 seconds', now() + interval '40 seconds'),
  ('bf100000-0000-7000-8000-000000000043', 'bf100000-0000-7000-8000-000000000031', tests.get_supabase_uid('m_r5'), 'offered', now() - interval '20 seconds', now() + interval '40 seconds'),
  ('bf100000-0000-7000-8000-000000000044', 'bf100000-0000-7000-8000-000000000031', tests.get_supabase_uid('m_r6'), 'offered', now() - interval '20 seconds', now() + interval '40 seconds'),
  ('bf100000-0000-7000-8000-000000000045', 'bf100000-0000-7000-8000-000000000031', tests.get_supabase_uid('m_r3'), 'offered', now() - interval '20 seconds', now() + interval '40 seconds'),
  ('bf100000-0000-7000-8000-000000000046', 'bf100000-0000-7000-8000-000000000031', tests.get_supabase_uid('m_r4'), 'accepted', now() - interval '20 seconds', now() + interval '40 seconds');
-- plus an offer to r1 that is too fresh / about to expire (separate orders would be needed; reuse order 2)
insert into dispatch_offers (id, order_id, rider_id, status, offered_at, expires_at) values
  ('bf100000-0000-7000-8000-000000000047', 'bf100000-0000-7000-8000-000000000032', tests.get_supabase_uid('m_r1'), 'offered', now() - interval '3 seconds', now() + interval '57 seconds');
delete from message_outbox where kind = 'rider_offer' and dedupe_key like 'w:%';

select tests.authenticate_as('m_c1');
select throws_ok($$ select enqueue_rider_offer_sms() $$, '42501', null, 'a signed-in user cannot run the rider-offer enqueuer');
select tests.authenticate_as_service_role();

select is(enqueue_rider_offer_sms(), 1, 'one SMS queued: only the online, approved, active rider with a phone and an open offer older than 12 s');
select is((select count(*) from message_outbox where kind = 'rider_offer' and dedupe_key like 'offer:%'), 1::bigint, '... exactly one rider_offer row');
select is((select recipient_user_id from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000041:sms'), tests.get_supabase_uid('m_r1'), '... for r1');
select is((select channel || '/' || category || '/' || status || '/' || to_address from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000041:sms'),
  'sms/transactional/queued/+2348010000021', 'transactional SMS to the rider''s phone');
select is((select expires_at from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000041:sms'),
  (select expires_at from dispatch_offers where id = 'bf100000-0000-7000-8000-000000000041'), 'the SMS expires with the offer');
select matches((select body from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000041:sms'),
  '^KiaKia: new delivery from Mama Put Kitchen worth about N[0-9,]+\. Open the rider app to accept\. Expires in ~[0-9]+s$', 'the SMS has the agreed shape');
select ok((select body from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000041:sms') not ilike all (array[
  '%Secretina%', '%Customerson%', '%9099988877%', '%Hidden Street%', '%Secretland%', '%MSG-ORD%', '%@%']),
  'the SMS contains no customer name, phone, address, order code or email');
select ok((select char_length(body) <= 160 from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000041:sms'), 'it fits one SMS segment');
-- fee estimate: base 30000 + 10000 * ceil((pickup distance + 2500)/1000) kobo -> naira
select matches((select body from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000041:sms'),
  'worth about N' || to_char(round((30000 + 10000 * ceil((st_distance(st_geogfromtext('POINT(7.5 9.52)'), st_geogfromtext('POINT(7.5 9.5)')) + 2500) / 1000.0)) / 100.0), 'FM999,999,999') || '\.',
  'the fee shown is the same estimate get_rider_offer_details gives the rider');

select is(enqueue_rider_offer_sms(), 0, 'rerun: nothing new (idempotent)');
select is((select count(*) from message_outbox where dedupe_key like 'offer:%'), 1::bigint, '... still one row per offer');
select is((select count(*) from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000042:sms'), 0::bigint, 'offline rider skipped');
select is((select count(*) from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000043:sms'), 0::bigint, 'suspended rider skipped');
select is((select count(*) from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000044:sms'), 0::bigint, 'rider without a phone skipped');
select is((select count(*) from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000045:sms'), 0::bigint, 'not-yet-approved rider skipped');
select is((select count(*) from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000046:sms'), 0::bigint, 'an accepted (no longer open) offer is skipped');
select is((select count(*) from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000047:sms'), 0::bigint, 'an offer younger than the 12 s delay is not texted yet');

-- the fresh offer becomes eligible once old enough; hourly cap of 1 then suppresses it
reset role;
update dispatch_offers set offered_at = now() - interval '15 seconds' where id = 'bf100000-0000-7000-8000-000000000047';
update message_settings set value_int = 1 where key = 'rider_offer_sms_hourly_cap';
select tests.authenticate_as_service_role();
select is(enqueue_rider_offer_sms(), 0, 'with the per-rider hourly cap reached nothing more is queued');
select is((select status || '/' || suppress_reason from message_outbox where dedupe_key = 'offer:bf100000-0000-7000-8000-000000000047:sms'),
  'suppressed/rate_limited', '... the excess offer is recorded as suppressed(rate_limited), never sent');
reset role;
update message_settings set value_int = 6 where key = 'rider_offer_sms_hourly_cap';
-- kill switch
update message_settings set value_int = 0 where key = 'rider_offer_sms_enabled';
insert into dispatch_offers (id, order_id, rider_id, status, offered_at, expires_at) values
  ('bf100000-0000-7000-8000-000000000048', 'bf100000-0000-7000-8000-000000000032', tests.get_supabase_uid('m_r2'), 'offered', now() - interval '20 seconds', now() + interval '40 seconds');
update riders set is_online = true where user_id = tests.get_supabase_uid('m_r2');
select tests.authenticate_as_service_role();
select is(enqueue_rider_offer_sms(), 0, 'the kill switch (rider_offer_sms_enabled = 0) stops all rider SMS');
reset role;
update message_settings set value_int = 1 where key = 'rider_offer_sms_enabled';
select tests.authenticate_as_service_role();
select is(enqueue_rider_offer_sms(), 2, 're-enabled: the now-online rider is texted for both of their open offers (042 and 048)');

-- claim returns rider offers ahead of promotional rows; stale offer rows expire
select is((select kind from message_claim_batch(1)), 'rider_offer', 'transactional rider-offer SMS are claimed before anything promotional');

-- ---------------------------------------------------------------------------
-- 14. Scheduling + invoker
-- ---------------------------------------------------------------------------

reset role;
create temp table _cron_present as select exists (select 1 from pg_extension where extname = 'pg_cron') as yes;
grant all on _cron_present to public;
select ok(case when (select yes from _cron_present)
               then (select count(*) = 3 from cron.job where jobname in ('enqueue-rider-offer-sms', 'message-worker-tick', 'scrub-message-outbox'))
               else true end, 'the three messaging jobs are scheduled (or pg_cron is absent)');
select is(case when (select yes from _cron_present) then (select schedule from cron.job where jobname = 'enqueue-rider-offer-sms') else '15 seconds' end,
  '15 seconds', 'the rider-offer SMS enqueuer runs every 15 s');
select ok(case when (select yes from _cron_present)
               then (select command ilike '%set local role service_role%enqueue_rider_offer_sms()%' from cron.job where jobname = 'enqueue-rider-offer-sms')
               else true end, 'it switches to service_role first');
select is(_ensure_scheduled_jobs(), true, '_ensure_scheduled_jobs() still succeeds and is idempotent');
select is(invoke_message_worker(), false, 'invoke_message_worker is a no-op (false) without the Vault secrets');

select * from finish();
rollback;
