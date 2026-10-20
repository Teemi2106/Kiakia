-- KiaKia - admin directory pages (Customers, Riders) and the combined payables list.
--
-- Four read-only, service_role-only RPCs, same style as admin_list_users (0087):
-- no dynamic SQL, search terms matched as literal substrings, validated inputs,
-- total_count repeated on every row so a page paginates from one query.
--
--   admin_list_customers()         accounts whose ONLY role is 'customer' (no
--                                  rider, vendor or admin role), with order
--                                  count and wallet balance computed for the
--                                  page's rows only.
--   admin_list_riders()            riders with their name/phone (riders has no
--                                  FK to profiles, so PostgREST cannot join) and
--                                  a derived 'state': suspended and deleted come
--                                  from profiles.status, otherwise kyc_status
--                                  (pending / approved -> active / rejected).
--   admin_rider_state_counts()     rows per state, for the tab counts.
--   admin_list_payables()          vendors and riders whose available balance is
--                                  above zero, largest first, with the total owed
--                                  repeated on every row. Exposes rider bank
--                                  account numbers (callers mask them), hence
--                                  service_role only.
--
-- No new indexes: customers/riders are searched through the 0087 trigram
-- indexes on profiles, and payables aggregates the ledger exactly as
-- admin_list_balances (0081) does.

-- ---------------------------------------------------------------------------
-- admin_list_customers
-- ---------------------------------------------------------------------------

create function admin_list_customers(
  p_q       text default null,
  p_status  text default null,
  p_limit   integer default 25,
  p_offset  integer default 0
)
returns table (
  id                  uuid,
  full_name           text,
  phone               text,
  status              text,
  created_at          timestamptz,
  order_count         bigint,
  wallet_balance_kobo bigint,
  total_count         bigint
)
language plpgsql
stable
security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
declare
  v_pattern text;
begin
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    raise exception 'admin_list_customers: limit must be 1-200 and offset non-negative'
      using errcode = 'check_violation';
  end if;
  if p_status is not null and p_status not in ('active', 'suspended', 'deleted') then
    raise exception 'admin_list_customers: status must be active, suspended or deleted, got %', p_status
      using errcode = 'check_violation';
  end if;
  if p_q is not null and char_length(p_q) > 100 then
    raise exception 'admin_list_customers: search term must be at most 100 characters'
      using errcode = 'check_violation';
  end if;

  if p_q is not null and btrim(p_q) <> '' then
    v_pattern := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with page as (
    select p.id, p.full_name, p.phone, p.status, p.created_at, count(*) over () as total_count
    from profiles p
    where (v_pattern is null or p.full_name ilike v_pattern or p.phone ilike v_pattern)
      and (p_status is null or p.status = p_status)
      and not exists (select 1 from user_roles r where r.user_id = p.id and r.role <> 'customer')
    order by p.created_at desc, p.id desc
    limit p_limit offset p_offset
  )
  select pg.id,
         pg.full_name,
         pg.phone,
         pg.status,
         pg.created_at,
         (select count(*) from orders o where o.customer_id = pg.id),
         coalesce((
           select sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end)
           from accounts a
           join ledger_entries le on le.account_id = a.id
           where a.owner_type = 'customer' and a.owner_id = pg.id and a.kind = 'wallet'
         ), 0)::bigint,
         pg.total_count
  from page pg
  order by pg.created_at desc, pg.id desc;
end;
$$;

comment on function admin_list_customers(text, text, integer, integer) is
  'Admin Customers page: accounts holding no role other than customer, newest first, with order count and customer wallet balance for the returned rows. Search is a literal substring of name or phone. service_role only.';

revoke execute on function admin_list_customers(text, text, integer, integer) from public, anon, authenticated;
grant execute on function admin_list_customers(text, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- admin_list_riders / admin_rider_state_counts
-- ---------------------------------------------------------------------------

-- One definition of "state" for the list and the counts: a suspended or deleted
-- account outranks the KYC decision.
create function _rider_state(p_profile_status text, p_kyc_status text)
returns text
language sql
immutable
as $$
  select case
    when p_profile_status in ('suspended', 'deleted') then p_profile_status
    when p_kyc_status = 'approved' then 'active'
    else p_kyc_status
  end
$$;

create function admin_list_riders(
  p_q             text default null,
  p_state         text default null,
  p_availability  text default null,
  p_limit         integer default 25,
  p_offset        integer default 0
)
returns table (
  user_id           uuid,
  full_name         text,
  phone             text,
  vehicle_type      text,
  plate_number      text,
  kyc_status        text,
  state             text,
  is_online         boolean,
  rating_avg        numeric,
  rating_count      integer,
  last_ping_at      timestamptz,
  documents_pending bigint,
  created_at        timestamptz,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
declare
  v_pattern text;
begin
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    raise exception 'admin_list_riders: limit must be 1-200 and offset non-negative'
      using errcode = 'check_violation';
  end if;
  if p_state is not null and p_state not in ('pending', 'active', 'rejected', 'suspended', 'deleted') then
    raise exception 'admin_list_riders: state must be pending, active, rejected, suspended or deleted, got %', p_state
      using errcode = 'check_violation';
  end if;
  if p_availability is not null and p_availability not in ('online', 'offline') then
    raise exception 'admin_list_riders: availability must be online or offline, got %', p_availability
      using errcode = 'check_violation';
  end if;
  if p_q is not null and char_length(p_q) > 100 then
    raise exception 'admin_list_riders: search term must be at most 100 characters'
      using errcode = 'check_violation';
  end if;

  if p_q is not null and btrim(p_q) <> '' then
    v_pattern := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with page as (
    select r.user_id, p.full_name, p.phone, r.vehicle_type, r.plate_number, r.kyc_status,
           _rider_state(p.status, r.kyc_status) as state,
           r.is_online, r.rating_avg, r.rating_count, r.last_ping_at, r.created_at,
           count(*) over () as total_count
    from riders r
    left join profiles p on p.id = r.user_id
    where (v_pattern is null or p.full_name ilike v_pattern or p.phone ilike v_pattern or r.plate_number ilike v_pattern)
      and (p_state is null or _rider_state(p.status, r.kyc_status) = p_state)
      and (p_availability is null or r.is_online = (p_availability = 'online'))
    order by r.created_at desc, r.user_id desc
    limit p_limit offset p_offset
  )
  select pg.user_id, pg.full_name, pg.phone, pg.vehicle_type, pg.plate_number, pg.kyc_status, pg.state,
         pg.is_online, pg.rating_avg, pg.rating_count, pg.last_ping_at,
         (select count(*) from rider_documents d where d.rider_id = pg.user_id and d.status = 'pending'),
         pg.created_at, pg.total_count
  from page pg
  order by pg.created_at desc, pg.user_id desc;
end;
$$;

create function admin_rider_state_counts()
returns table (state text, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select _rider_state(p.status, r.kyc_status), count(*)
  from riders r
  left join profiles p on p.id = r.user_id
  group by 1
$$;

comment on function admin_list_riders(text, text, text, integer, integer) is
  'Admin Riders page: riders with name/phone, derived state (pending, active, rejected, suspended, deleted), pending document count and total_count. Search is a literal substring of name, phone or plate number. service_role only.';
comment on function admin_rider_state_counts() is
  'Rider count per derived state, for the Riders page tabs. service_role only.';

revoke execute on function admin_list_riders(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function admin_list_riders(text, text, text, integer, integer) to service_role;
revoke execute on function admin_rider_state_counts() from public, anon, authenticated;
grant execute on function admin_rider_state_counts() to service_role;
revoke execute on function _rider_state(text, text) from public, anon, authenticated;
grant execute on function _rider_state(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- admin_list_payables
-- ---------------------------------------------------------------------------

create function admin_list_payables(
  p_limit   integer default 25,
  p_offset  integer default 0
)
returns table (
  owner_type           text,
  owner_id             uuid,
  display_name         text,
  balance_kobo         bigint,
  disbursed_kobo       bigint,
  bank_name            text,
  bank_account_name    text,
  bank_account_number  text,
  total_count          bigint,
  total_owed_kobo      bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    raise exception 'admin_list_payables: limit must be 1-200 and offset non-negative'
      using errcode = 'check_violation';
  end if;

  return query
  with bal as (
    select a.owner_type, a.owner_id,
           sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end)::bigint as balance_kobo,
           coalesce(sum(le.amount_kobo) filter (where le.direction = 'debit' and t.kind = 'payout'), 0)::bigint as disbursed_kobo
    from accounts a
    join ledger_entries le on le.account_id = a.id
    left join transactions t on t.id = le.transaction_id
    where a.owner_type in ('vendor', 'rider') and a.kind = 'available'
    group by a.owner_type, a.owner_id
    having sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end) > 0
  )
  select b.owner_type,
         b.owner_id,
         case when b.owner_type = 'vendor' then v.name else pr.full_name end,
         b.balance_kobo,
         b.disbursed_kobo,
         r.bank_name,
         r.bank_account_name,
         r.bank_account_number,
         count(*) over (),
         (sum(b.balance_kobo) over ())::bigint
  from bal b
  left join vendors v on b.owner_type = 'vendor' and v.id = b.owner_id
  left join profiles pr on b.owner_type = 'rider' and pr.id = b.owner_id
  left join riders r on b.owner_type = 'rider' and r.user_id = b.owner_id
  order by b.balance_kobo desc, b.owner_id
  limit p_limit offset p_offset;
end;
$$;

comment on function admin_list_payables(integer, integer) is
  'Vendors and riders with an available balance above zero (money the platform owes), largest first, with the count and the total owed on every row. Exposes rider bank account numbers: service_role only.';

revoke execute on function admin_list_payables(integer, integer) from public, anon, authenticated;
grant execute on function admin_list_payables(integer, integer) to service_role;
