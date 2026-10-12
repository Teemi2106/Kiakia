-- KiaKia - at most one platform account per kind.
--
-- STATUS: UNVERIFIED, NOT RUN. Written while local Docker was off (no
-- `supabase db reset`, no pgTAP run). Run the reset and
-- supabase/tests/capture_payment.sql before relying on it.
--
-- accounts has unique (owner_type, owner_id, kind) since 0005, but platform
-- accounts have owner_id NULL and Postgres treats NULLs as distinct, so that
-- constraint never stopped a second ('platform', NULL, 'escrow') row. The
-- seeding inserts in 0010 and 0020 rely on `on conflict ... do nothing` and so
-- were never actually idempotent. A second row would break every single-row
-- lookup in capture_payment, verify_delivery_and_release_escrow and the refund
-- path ("query returned more than one row").
--
-- Nothing in the app or the tests writes an owner_id-NULL account after
-- 0010/0020 (checked: migrations, supabase/tests, seed.sql,
-- test_helpers_shim.sql, apps/web), so on a correctly migrated database each
-- (owner_type, kind) with owner_id NULL has exactly one row and this index
-- builds cleanly.
--
-- Existing data: if a database already holds duplicates, this migration
-- stops with an explicit error rather than picking a survivor, because
-- ledger_entries reference these rows and merging them is a money decision,
-- not a schema one.
--
-- Side effect, intended: re-running the 0010/0020 seeding statements now
-- raises unique_violation instead of silently adding a duplicate, because
-- their ON CONFLICT target is the 0005 constraint, not this index.

do $$
declare
  v_dupes text;
begin
  select string_agg(format('%s/%s x%s', owner_type, kind, n), ', ')
    into v_dupes
  from (
    select owner_type, kind, count(*) as n
    from accounts
    where owner_id is null
    group by owner_type, kind
    having count(*) > 1
  ) d;

  if v_dupes is not null then
    raise exception '0086: duplicate owner-less accounts exist (%); resolve them by hand before applying', v_dupes;
  end if;
end;
$$;

create unique index if not exists accounts_ownerless_unique_idx
  on accounts (owner_type, kind)
  where owner_id is null;

comment on index accounts_ownerless_unique_idx is
  'One platform account per kind. The 0005 unique (owner_type, owner_id, kind) cannot enforce this because owner_id is NULL for platform accounts.';
