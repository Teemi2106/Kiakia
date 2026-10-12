-- pgTAP: authorization of every admin RPC and the append-only admin_audit_log
-- (0080_admin_audit_log.sql, 0081_admin_operations.sql). Companion file:
-- admin_operations.sql (behaviour, audit rows, money, ledger health).
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) NO ROLE BUT service_role CAN CALL AN ADMIN RPC, not even an
--     authenticated user who really is an admin: the Server Action layer is
--     the only intended caller, and a browser holding a user JWT must never be
--     able to reach these (PostgREST exposes every function granted to
--     authenticated).
-- (2) service_role alone is not enough: p_actor_id must be a real, ACTIVE
--     platform admin (superadmin for the superadmin-only paths). A suspended
--     admin, a customer, or a null actor is refused before any write.
-- (3) admin_audit_log can never be rewritten or read by app roles, even by
--     service_role / the table owner for UPDATE, DELETE and TRUNCATE.
-- (4) the internal helpers (_assert_admin_actor, _write_admin_audit) are not
--     callable by any API role, so nobody can forge an audit row.
--
-- throws_ok() uses the 4-arg form (sql, sqlstate, message, description); null
-- message = match on SQLSTATE only (used where the message embeds a uuid or
-- the denial is a plain "permission denied for function").

begin;
select plan(124);

select tests.create_supabase_user('az_customer');
select tests.create_supabase_user('az_admin');
select tests.create_supabase_user('az_superadmin');
select tests.create_supabase_user('az_suspended_admin');
select tests.create_supabase_user('az_scoped_admin');

insert into user_roles (user_id, role) values
  (tests.get_supabase_uid('az_admin'), 'admin'),
  (tests.get_supabase_uid('az_superadmin'), 'superadmin'),
  (tests.get_supabase_uid('az_suspended_admin'), 'admin');

-- An 'admin' row that is vendor-SCOPED is not a platform admin.
insert into user_roles (user_id, role, scope_type, scope_id)
values (tests.get_supabase_uid('az_scoped_admin'), 'admin', 'vendor', 'ad000000-0000-7000-8000-0000000000bb');

-- Suspension is written here as the owner (the profiles_protect_status trigger
-- only blocks non-service-role sessions that carry a role).
update profiles set status = 'suspended' where id = tests.get_supabase_uid('az_suspended_admin');

select is(
  (select status from profiles where id = tests.get_supabase_uid('az_suspended_admin')),
  'suspended',
  'fixture: the suspended admin really has profiles.status = suspended while still holding its admin role row'
);

-- One table of every admin RPC call. %1$L is the p_actor_id. Targets do not
-- exist on purpose: authorization must fail before the target is even looked
-- at. Arguments are otherwise valid so no earlier validation can mask a
-- missing authorization check.
create temporary table az_calls (n int, name text, tmpl text, takes_actor boolean) on commit drop;
grant all on az_calls to public;
insert into az_calls values
  (1,  'approve_vendor',                      $q$ select approve_vendor('ad000000-0000-7000-8000-0000000000aa'::uuid, %1$L::uuid) $q$, true),
  (2,  'reject_vendor',                       $q$ select reject_vendor('ad000000-0000-7000-8000-0000000000aa'::uuid, %1$L::uuid) $q$, true),
  (3,  'approve_rider',                       $q$ select approve_rider('ad000000-0000-7000-8000-0000000000aa'::uuid, %1$L::uuid) $q$, true),
  (4,  'reject_rider',                        $q$ select reject_rider('ad000000-0000-7000-8000-0000000000aa'::uuid, %1$L::uuid) $q$, true),
  (5,  'approve_rider_document',              $q$ select approve_rider_document('ad000000-0000-7000-8000-0000000000aa'::uuid, %1$L::uuid) $q$, true),
  (6,  'reject_rider_document',               $q$ select reject_rider_document('ad000000-0000-7000-8000-0000000000aa'::uuid, %1$L::uuid, 'blurry') $q$, true),
  (7,  'refund_order_escrow',                 $q$ select refund_order_escrow('ad000000-0000-7000-8000-0000000000aa'::uuid, %1$L::uuid, 'r') $q$, true),
  (8,  'admin_reset_delivery_code_attempts',  $q$ select admin_reset_delivery_code_attempts('ad000000-0000-7000-8000-0000000000aa'::uuid, %1$L::uuid) $q$, true),
  (9,  'admin_set_user_status',               $q$ select admin_set_user_status('ad000000-0000-7000-8000-0000000000aa'::uuid, 'suspended', 'r', %1$L::uuid) $q$, true),
  (10, 'admin_set_platform_role',             $q$ select admin_set_platform_role('ad000000-0000-7000-8000-0000000000aa'::uuid, 'rider', true, 'r', %1$L::uuid) $q$, true),
  (11, 'admin_set_vendor_commission',         $q$ select admin_set_vendor_commission('ad000000-0000-7000-8000-0000000000aa'::uuid, 1000, 'r', %1$L::uuid) $q$, true),
  (12, 'admin_update_service_area',           $q$ select admin_update_service_area('ad000000-0000-7000-8000-0000000000aa'::uuid, 1, 1, 1, 1, true, 'r', %1$L::uuid) $q$, true),
  (13, 'admin_record_payout',                 $q$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-0000000000aa'::uuid, 100, 'AZ-REF-1', 'r', %1$L::uuid) $q$, true),
  (14, 'admin_request_gateway_refund',        $q$ select admin_request_gateway_refund('ad000000-0000-7000-8000-0000000000aa'::uuid, 'r', %1$L::uuid) $q$, true),
  (15, 'admin_dashboard_metrics',             $q$ select admin_dashboard_metrics() $q$, false),
  (16, 'admin_ledger_health',                 $q$ select admin_ledger_health() $q$, false),
  (17, 'admin_list_balances',                 $q$ select * from admin_list_balances('vendor') $q$, false);

-- ---------------------------------------------------------------------------
-- (1) anon, a plain authenticated user, and an authenticated ADMIN are all
-- denied on all 17 RPCs (permission denied for function = 42501).
-- ---------------------------------------------------------------------------

select tests.clear_authentication(); -- role anon
select throws_ok(format(tmpl, tests.get_supabase_uid('az_admin')), '42501', null, 'anon cannot call ' || name)
from az_calls order by n;

select tests.authenticate_as('az_customer');
select throws_ok(format(tmpl, tests.get_supabase_uid('az_admin')), '42501', null, 'a plain authenticated user cannot call ' || name || ', even naming a real admin as p_actor_id')
from az_calls order by n;

select tests.authenticate_as('az_admin');
select throws_ok(format(tmpl, tests.get_supabase_uid('az_admin')), '42501', null, 'an authenticated admin (user JWT) cannot call ' || name || ' directly - service_role only')
from az_calls order by n;

-- ---------------------------------------------------------------------------
-- (2) service_role, but a bad actor. 14 actor-taking RPCs x 3 bad actors is
-- covered by 2 messages-checked classes (non-admin / null -> P0001 "is not an
-- admin") and 1 SQLSTATE class (suspended -> 42501).
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select throws_ok(format(tmpl, tests.get_supabase_uid('az_customer')), 'P0001', null, 'service_role + non-admin actor is refused by ' || name)
from az_calls where takes_actor order by n;

select throws_ok(format(tmpl, null), 'P0001', null, 'service_role + NULL actor is refused by ' || name)
from az_calls where takes_actor order by n;

select throws_ok(format(tmpl, tests.get_supabase_uid('az_suspended_admin')), '42501', null, 'service_role + SUSPENDED admin actor is refused by ' || name)
from az_calls where takes_actor order by n;

select throws_ok(
  format($$ select approve_vendor('ad000000-0000-7000-8000-0000000000aa'::uuid, %L::uuid) $$, tests.get_supabase_uid('az_customer')),
  'P0001',
  format('approve_vendor: actor %s is not an admin', tests.get_supabase_uid('az_customer')),
  'the non-admin refusal message is unchanged by the 0080 retrofit (existing callers/tests key on it)'
);
select throws_ok(
  format($$ select approve_vendor('ad000000-0000-7000-8000-0000000000aa'::uuid, %L::uuid) $$, tests.get_supabase_uid('az_suspended_admin')),
  '42501',
  format('approve_vendor: actor %s is not an active account', tests.get_supabase_uid('az_suspended_admin')),
  'a suspended admin is refused with the explicit "not an active account" message'
);

select throws_ok(
  format($$ select approve_vendor('ad000000-0000-7000-8000-0000000000aa'::uuid, %L::uuid) $$, tests.get_supabase_uid('az_scoped_admin')),
  'P0001',
  format('approve_vendor: actor %s is not an admin', tests.get_supabase_uid('az_scoped_admin')),
  'a vendor-scoped "admin" role row does not make a platform admin (0080 tightening)'
);

-- Superadmin-only paths reject a plain admin.
select throws_ok(
  format($$ select admin_set_platform_role('%s'::uuid, 'admin', true, 'promote', %L::uuid) $$, tests.get_supabase_uid('az_customer'), tests.get_supabase_uid('az_admin')),
  '42501',
  format('admin_set_platform_role: actor %s is not a superadmin', tests.get_supabase_uid('az_admin')),
  'a plain admin cannot grant the admin role'
);
select throws_ok(
  format($$ select admin_set_platform_role('%s'::uuid, 'superadmin', true, 'promote', %L::uuid) $$, tests.get_supabase_uid('az_customer'), tests.get_supabase_uid('az_admin')),
  '42501',
  format('admin_set_platform_role: actor %s is not a superadmin', tests.get_supabase_uid('az_admin')),
  'a plain admin cannot grant the superadmin role'
);
select throws_ok(
  format($$ select admin_set_platform_role('%s'::uuid, 'admin', false, 'demote', %L::uuid) $$, tests.get_supabase_uid('az_superadmin'), tests.get_supabase_uid('az_admin')),
  '42501',
  format('admin_set_platform_role: actor %s is not a superadmin', tests.get_supabase_uid('az_admin')),
  'a plain admin cannot revoke an admin/superadmin role either'
);
select throws_ok(
  format($$ select admin_set_user_status('%s'::uuid, 'suspended', 'r', %L::uuid) $$, tests.get_supabase_uid('az_superadmin'), tests.get_supabase_uid('az_admin')),
  '42501',
  format('admin_set_user_status: actor %s is not a superadmin', tests.get_supabase_uid('az_admin')),
  'a plain admin cannot suspend a superadmin'
);
select throws_ok(
  format($$ select admin_set_user_status('%s'::uuid, 'suspended', 'r', %L::uuid) $$, tests.get_supabase_uid('az_suspended_admin'), tests.get_supabase_uid('az_admin')),
  '42501',
  format('admin_set_user_status: actor %s is not a superadmin', tests.get_supabase_uid('az_admin')),
  'a plain admin cannot suspend another admin'
);

-- A direct service-role session: no JWT claims at all (auth.role() is NULL),
-- only the Postgres role. This is the NULL-safe branch of _assert_admin_actor.
-- The claims are cleared explicitly because the local helper shim
-- (test_helpers_shim.sql) sets a service_role claim and basejump's does not.
select tests.authenticate_as_service_role();
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.role', '', true);
select ok(auth.role() is null, 'fixture: a direct service_role session has a NULL auth.role() (the case the actor check must handle NULL-safely)');
select throws_ok(
  format($$ select approve_vendor('ad000000-0000-7000-8000-0000000000aa'::uuid, %L::uuid) $$, tests.get_supabase_uid('az_admin')),
  'P0002',
  'approve_vendor: vendor ad000000-0000-7000-8000-0000000000aa does not exist',
  'a real admin from a direct service_role session passes authorization (fails only on the missing target)'
);

-- ---------------------------------------------------------------------------
-- (4) internal helpers are not reachable by any API role (incl. service_role).
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select _write_admin_audit(%L::uuid, 'forged.action', 'user', %L::uuid, 'x') $$, tests.get_supabase_uid('az_admin'), tests.get_supabase_uid('az_customer')),
  '42501', null, 'service_role cannot call _write_admin_audit directly to forge an audit row'
);
select throws_ok(
  format($$ select _assert_admin_actor('x', %L::uuid) $$, tests.get_supabase_uid('az_admin')),
  '42501', null, 'service_role cannot call _assert_admin_actor directly'
);
select tests.authenticate_as('az_admin');
select throws_ok(
  format($$ select _write_admin_audit(%L::uuid, 'forged.action', 'user', %L::uuid, 'x') $$, tests.get_supabase_uid('az_admin'), tests.get_supabase_uid('az_customer')),
  '42501', null, 'an authenticated admin cannot call _write_admin_audit directly'
);

-- ---------------------------------------------------------------------------
-- (3) admin_audit_log is append-only and unreadable by app roles.
-- ---------------------------------------------------------------------------

reset role;
insert into admin_audit_log (id, actor_id, action, target_type, target_id, reason, details)
values ('ad000000-0000-7000-8000-0000000000f1', tests.get_supabase_uid('az_admin'), 'vendor.approve', 'vendor',
        'ad000000-0000-7000-8000-0000000000aa', 'fixture row', '{"k": 1}');

-- Table owner / superuser: the trigger still refuses.
select throws_ok($$ update admin_audit_log set reason = 'rewritten' $$, '42501', 'admin_audit_log is append-only (UPDATE rejected)', 'the table owner cannot UPDATE an audit row');
select throws_ok($$ delete from admin_audit_log $$, '42501', 'admin_audit_log is append-only (DELETE rejected)', 'the table owner cannot DELETE an audit row');
select throws_ok($$ truncate admin_audit_log $$, '42501', 'admin_audit_log is append-only (TRUNCATE rejected)', 'the table owner cannot TRUNCATE the audit log');

-- service_role: SELECT only.
select tests.authenticate_as_service_role();
select is((select count(*)::int from admin_audit_log where id = 'ad000000-0000-7000-8000-0000000000f1'), 1, 'service_role can SELECT the audit log');
select throws_ok($$ update admin_audit_log set reason = 'rewritten' $$, '42501', null, 'service_role cannot UPDATE the audit log');
select throws_ok($$ delete from admin_audit_log $$, '42501', null, 'service_role cannot DELETE from the audit log');
select throws_ok($$ truncate admin_audit_log $$, '42501', null, 'service_role cannot TRUNCATE the audit log');
select throws_ok(
  format($$ insert into admin_audit_log (actor_id, action, target_type, target_id) values (%L::uuid, 'forged.action', 'user', %L::uuid) $$, tests.get_supabase_uid('az_admin'), tests.get_supabase_uid('az_customer')),
  '42501', null, 'service_role cannot INSERT into the audit log directly (only _write_admin_audit can)'
);

-- anon / authenticated (incl. an admin): no read, no write.
select tests.clear_authentication();
select throws_ok($$ select * from admin_audit_log $$, '42501', null, 'anon cannot read the audit log');
select tests.authenticate_as('az_customer');
select throws_ok($$ select * from admin_audit_log $$, '42501', null, 'an authenticated customer cannot read the audit log');
select throws_ok($$ update admin_audit_log set reason = 'x' $$, '42501', null, 'an authenticated customer cannot update the audit log');
select tests.authenticate_as('az_admin');
select throws_ok($$ select * from admin_audit_log $$, '42501', null, 'an authenticated admin cannot read the audit log through the user API');
select throws_ok($$ delete from admin_audit_log $$, '42501', null, 'an authenticated admin cannot delete from the audit log');

-- The log must survive: an actor with audit rows cannot be erased from auth.users.
reset role;
select throws_ok(
  format($$ delete from auth.users where id = %L::uuid $$, tests.get_supabase_uid('az_admin')),
  '23503', null, 'deleting an auth user who has acted as an admin fails instead of erasing the trail (no cascade on actor_id)'
);

-- Table shape guards.
select throws_ok(
  format($$ insert into admin_audit_log (actor_id, action, target_type, target_id) values (%L::uuid, 'ok.action', 'payout', %L::uuid) $$, tests.get_supabase_uid('az_admin'), tests.get_supabase_uid('az_customer')),
  '23514', null, 'target_type is constrained to the known set'
);
select throws_ok(
  format($$ insert into admin_audit_log (actor_id, action, target_type, target_id, reason) values (%L::uuid, 'ok.action', 'user', %L::uuid, '') $$, tests.get_supabase_uid('az_admin'), tests.get_supabase_uid('az_customer')),
  '23514', null, 'an empty-string reason is rejected at the table (the writer stores NULL instead)'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass),
  'RLS is enabled on admin_audit_log'
);

select * from finish();
rollback;
