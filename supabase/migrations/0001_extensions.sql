-- KiaKia — Phase 0 foundation migration 1/7.
-- Extensions + the UUIDv7 helper. Every table's primary key uses this,
-- per kiakia-system-architecture.md §9 ("UUIDv7 primary keys") — UUIDv7 is
-- time-ordered, so primary key inserts stay index-friendly (unlike UUIDv4)
-- while still being safe to generate client- or server-side without a
-- round trip, and without leaking a sequential row count the way a bigserial
-- would.

create extension if not exists "pgcrypto";   -- gen_random_uuid(), used inside uuid_generate_v7()
create extension if not exists "postgis";    -- geography columns + ST_* functions (§9, §11, §15)

-- Reference implementation of RFC 9562 UUIDv7: a 48-bit big-endian
-- millisecond Unix timestamp prefix, version nibble set to 7, variant bits
-- set per RFC 4122, remaining bits random (from gen_random_uuid()).
create or replace function uuid_generate_v7()
returns uuid
language plpgsql
volatile
as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms := substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3 for 6);
  uuid_bytes := unix_ts_ms || substring(uuid_send(gen_random_uuid()) from 7 for 10);

  -- Version 7 in the top nibble of byte 6.
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  -- RFC 4122 variant (10xxxxxx) in the top bits of byte 8.
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);

  return encode(uuid_bytes, 'hex')::uuid;
end;
$$;

comment on function uuid_generate_v7() is
  'Time-ordered UUIDv7 generator used as the default for every primary key in this schema. See kiakia-system-architecture.md §9.';
