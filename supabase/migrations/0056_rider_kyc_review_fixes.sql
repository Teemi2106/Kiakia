-- KiaKia - fixes from the independent security review of 0049-0055 (rider
-- KYC documents, rider push notifications, rider earnings history, dispatch
-- offer sweep) plus a separate type-drift audit. 0049-0055 are treated as
-- already shipped and reviewed, per this repo's "never edit a migration
-- that already shipped" rule (see 0050's own convention note) - every fix
-- below is applied on top, never by editing those files.
--
-- Read together with 0034_fix_missing_table_grants.sql before either of the
-- two grant-related fixes here (tasks 2 and 4b): 0034 is the migration that
-- established this schema's actual baseline - `alter default privileges`
-- grants select/insert/update/delete on every future table to
-- anon/authenticated automatically, which is why 0052/0053 never needed an
-- explicit `grant select` to have one, and why RLS alone (never
-- column-restrictive) leaves a table-wide UPDATE grant reachable unless a
-- migration narrows it with an explicit column grant the way 0049 did for
-- `notifications`. Every finding below is a variant of "0034's default
-- privileges reached further than the table's own migration accounted for".
--
-- ---------------------------------------------------------------------------
-- TASK 1 (BLOCKING) - rider-kyc storage bucket must re-assert public=false,
-- not assume it, on every apply.
-- ---------------------------------------------------------------------------
--
-- 0052_rider_kyc_documents.sql:72 used `on conflict (id) do nothing`. That
-- is correct for a bucket that is deliberately public (0036_vendor_media_
-- storage.sql, 0046_customer_avatar_storage.sql both use the same idiom,
-- and their conflict branch converges on the same public=true state either
-- way) but it is exactly wrong here: `public = false` on the bucket row is
-- the ENTIRE mechanism that makes the four storage.objects RLS policies
-- below matter at all. A public bucket is served from
-- /storage/v1/object/public/... with no auth and no RLS evaluation
-- whatsoever - the policies become dead code the instant the bucket itself
-- is public, regardless of how carefully they are written.
--
-- `do nothing` means: if a bucket with id = 'rider-kyc' already exists -
-- created by hand in the Supabase dashboard (whose own default is
-- PUBLIC, not private), or left over from a partial/aborted earlier
-- migration run - this migration succeeds silently and the database ends
-- up in exactly the state it must never be in: every rider's government ID,
-- driver's licence, and vehicle photo readable by anyone with the URL, with
-- no error, no warning, nothing in the migration output to suggest
-- anything went wrong. 0051_dispatch_offers_realtime.sql:22-28 already
-- reasons explicitly about the "configured out of band via the dashboard"
-- case for a different object (a publication membership) - the same
-- out-of-band risk applies here, with a much worse consequence.
--
-- Fix: force convergence with `on conflict (id) do update set public =
-- false, ...` so this migration is idempotent AND self-healing - re-running
-- it (or applying it after any out-of-band bucket creation) always leaves
-- the bucket private, never merely assumes a prior run got it right. `name`
-- is left out of the update set deliberately - it is immutable in practice
-- for a bucket keyed by id anyway, and there is no security consequence to
-- leaving it as whatever it already is.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rider-kyc',
  'rider-kyc',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public              = false,
  file_size_limit     = excluded.file_size_limit,
  allowed_mime_types  = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- TASK 2 (SHOULD-FIX) - rider_notifications UPDATE was not column-scoped.
-- ---------------------------------------------------------------------------
--
-- 0053_rider_push_notifications.sql:189-193 created an UPDATE policy scoped
-- to rider_id = auth.uid() and revoked only insert/delete from authenticated
-- (line 193). RLS restricts ROWS, never COLUMNS - and 0034's `alter default
-- privileges` already grants table-wide UPDATE to authenticated (and anon)
-- on every table, rider_notifications included. Net effect before this fix:
-- a rider could run
--   update rider_notifications set title = 'x', body = 'y' where id = '<own row>'
-- and rewrite their own notification's text. rider_id itself stays pinned
-- by the policy's WITH CHECK, so this was never cross-rider reassignment -
-- but it is exactly the column-scoping hole 0049_vendor_notifications.sql:
-- 60-66 identified and closed on the sibling `notifications` table in this
-- same review round, with an explicit comment that only is_read is meant to
-- be user-writable. Mirrored here, verbatim in spirit, with anon included
-- in the revoke (see task 4a below for why anon is revoked everywhere in
-- this migration even where no policy currently admits it).
-- ---------------------------------------------------------------------------

revoke update on rider_notifications from authenticated, anon;
grant update (is_read) on rider_notifications to authenticated;

-- ---------------------------------------------------------------------------
-- TASK 3 (SHOULD-FIX) - a push token could end up claimed by two riders at
-- once.
-- ---------------------------------------------------------------------------
--
-- 0053:54 keys rider_push_tokens on primary key (rider_id, token), so token
-- itself is not globally unique, and register_rider_push_token()'s upsert
-- (0053:113-118) only ever touched the CALLER's own (rider_id, token) row -
-- it never removed a row some OTHER rider already held for that same
-- token. An Expo push token identifies a physical device/app-install, not a
-- rider, and is stable across sign-outs and sign-ins on that one handset.
-- Sequence that exploited this: rider A signs out with no network (the app
-- can call signOut({ scope: "local" }) offline, and unregistering the token
-- server-side is best-effort and can silently fail), then rider B signs in
-- on the SAME phone. Both riders now have a rider_push_tokens row for the
-- identical token. Once push delivery is actually built on top of this
-- registry (deliberately out of scope for 0053, per its own header), every
-- notification meant for rider A would also reach rider B's device.
--
-- Fix: redefine register_rider_push_token() so that, immediately before its
-- own upsert, it deletes any row a DIFFERENT rider holds for the exact same
-- token. This makes a sign-out/sign-in handoff on one device TRANSFER
-- ownership of the token to whoever is now signed in, instead of leaving it
-- registered under both.
--
-- A global `unique (token)` constraint was considered and deliberately
-- rejected in favour of this delete-then-upsert approach: a unique
-- constraint would make the SECOND rider's registration call on that same
-- device FAIL outright (their own upsert would hit the constraint via
-- another rider's row, which `on conflict (rider_id, token)` does not
-- cover, since the conflicting row has a different rider_id). That is
-- exactly the wrong outcome - the whole point of calling this function on
-- every app foreground/token-refresh (0053's own comment) is for the
-- CURRENTLY signed-in rider's registration to always succeed. Deleting the
-- stale cross-rider row first and then upserting the caller's own achieves
-- the transfer atomically, in the same statement-level transaction as the
-- function body itself, with no window where both rows can coexist once
-- the function returns.
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

  -- Task 3 fix - an Expo push token identifies a DEVICE, and a device has
  -- exactly one signed-in rider at a time. Remove any row a DIFFERENT rider
  -- holds for this exact token before upserting the caller's own, so a
  -- sign-out/sign-in handoff on the same phone transfers ownership instead
  -- of leaving the token registered under both riders. See this migration's
  -- header for why a global unique constraint on token was considered and
  -- rejected in favour of this delete-then-upsert shape.
  delete from rider_push_tokens
  where token = p_token
    and rider_id is distinct from auth.uid();

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
  'Upserts the CALLER''S OWN rider_push_tokens row on (rider_id, token) - rider_id is always auth.uid(), never a parameter, so this can never register a token against another rider. Before the upsert (0056 fix), deletes any row a DIFFERENT rider holds for this same token: an Expo push token identifies a device, and a device has one signed-in rider at a time, so without this a sign-out/sign-in handoff on the same phone would leave the token registered under both riders, and every future push meant for the first rider would also reach the second. A global unique constraint on token was considered and rejected - see this migration''s header - because it would make the second rider''s registration call fail outright instead of transferring ownership. Call again on every app foreground/token-refresh event; harmless to call repeatedly with the same token.';

-- Grants are unchanged by this redefinition (create or replace preserves
-- the function's existing ACL) - still `revoke ... from public; grant
-- execute ... to authenticated;` as set by 0053.

-- ---------------------------------------------------------------------------
-- TASK 4a - close the missing anon revokes on the two tables holding rider
-- KYC PII and push capabilities.
-- ---------------------------------------------------------------------------
--
-- 0052:130 (`revoke insert, update, delete on rider_documents from
-- authenticated;`) and 0053:71 (`revoke insert, update, delete on
-- rider_push_tokens from authenticated;`) both narrowed only `authenticated`,
-- while 0038:39 and 0053:193 (the very next table in the same migration)
-- both correctly narrowed `authenticated, anon`. The result: anon retains a
-- dead INSERT/UPDATE/DELETE grant (from 0034's default privileges) on the
-- two tables in this batch that hold the most sensitive data - government
-- ID photos and push-notification capability. Not currently exploitable -
-- RLS is enabled on both tables and no policy admits `anon` on either - but
-- it is the belt without the braces on exactly the tables that most need
-- both. Re-issuing the revoke with `anon` added is a pure narrowing with no
-- behavioral change for `authenticated` (already revoked, so that half is a
-- no-op) and no behavioral change for `anon` today either (RLS already
-- blocks it) - it only removes a grant that RLS was doing the only real
-- work of blocking.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on rider_documents from authenticated, anon;
revoke insert, update, delete on rider_push_tokens from authenticated, anon;

-- ---------------------------------------------------------------------------
-- TASK 4b - explicit `grant select` on the three rider tables added by
-- 0052/0053, so the read path does not depend on 0034's default-privileges
-- side effect ever having run against the same granting role.
-- ---------------------------------------------------------------------------
--
-- `alter default privileges` (0034) is per-GRANTING-ROLE, not global: it
-- only affects tables subsequently created BY THE SAME ROLE that ran 0034.
-- rider_documents, rider_push_tokens, and rider_notifications currently
-- have no explicit `grant select` of their own anywhere in 0052/0053 and
-- rely entirely on that default-privileges side effect having applied to
-- whichever role created them. If 0052/0053 are ever applied by a different
-- database role than the one that ran 0034 - a realistic scenario across
-- CI runners, a fresh environment bootstrap, or a managed-Postgres role
-- rotation - the SELECT grant silently does not exist on these three tables
-- even though every RLS policy on them is correct, and every direct table
-- read (fetchRiderDocuments() in the rider app, the push-token list, the
-- notification feed) fails with "permission denied for table
-- rider_documents" despite nothing being wrong with authorization logic.
-- 0034's OWN header documents that this exact class of bug already broke
-- every direct table read once before, project-wide - this closes the same
-- gap for the three tables this review round added, rather than trusting
-- the same implicit mechanism not to bite a third time.
-- ---------------------------------------------------------------------------

grant select on rider_documents to authenticated;
grant select on rider_push_tokens to authenticated;
grant select on rider_notifications to authenticated;

-- ---------------------------------------------------------------------------
-- TASK 7 - correcting the record on 0050_restore_transition_order_guards.sql
-- ---------------------------------------------------------------------------
--
-- 0050_restore_transition_order_guards.sql:143-147 states that the pgTAP
-- suite covering the three guards it restores "was evidently not run
-- against them in CI at the time" and that "nothing in this migration
-- changes CI wiring - that is a separate, non-database-schema fix this
-- migration does not attempt."
--
-- The first half of that claim is unverified speculation stated as fact,
-- and it is wrong. `.github/workflows/ci.yml` has had a `pgtap` job
-- (`supabase start` then `supabase test db`) since this repository's very
-- first commit (verified directly: `git log --oneline --
-- .github/workflows/ci.yml` shows the file was touched only twice total,
-- and the earlier of the two IS the repository's first commit - the job
-- did not arrive later and was not added or removed around the time 0041/
-- 0042 shipped). So the pgTAP suite WAS wired into CI the entire time 0041
-- and 0042 landed - "the suite was evidently not run against them in CI"
-- is not the accurate explanation for how those two regressions shipped.
--
-- The accurate conclusion is one of: the pgTAP job ran and was red, but
-- nothing required it to pass before merge (no required status check /
-- branch protection on it); or the job errored out before it ever reached
-- the assertions that would have caught the regression. This same review
-- round's own task 5 found exactly that second failure mode already
-- present in the suite (a malformed 2-argument throws_ok() call in
-- supabase/tests/vendor_notifications.sql that cannot pass, because pgTAP's
-- 2-argument throws_ok(sql, text) treats the second argument as an exact
-- expected error message, not a free-text description, unless it is
-- precisely 5 characters and therefore read as a SQLSTATE) - and the same
-- reviewer identified eight more pre-existing malformed throws_ok() calls
-- across other files in supabase/tests/ (rls_carts_addresses_menu.sql,
-- place_order.sql, register_vendor.sql, vendor_location_and_rider_reads.sql
-- - left unfixed in this migration, out of scope for this pass; noted here
-- and in this migration's own accompanying report only). Given that, "the
-- suite has been red for a long time, for reasons unrelated to the actual
-- schema it is meant to protect" is the likely explanation - not "it was
-- not run".
--
-- This note does not edit 0050 itself (already reviewed and shipped, per
-- this repo's own convention - see this migration's header) - it exists
-- here, in the migration that corrects the surrounding record, precisely so
-- the false claim is not repeated as fact in any downstream documentation
-- (e.g. the rider app's own SECURITY.md) that cites 0050's header.
-- ---------------------------------------------------------------------------
