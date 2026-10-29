-- KiaKia - fleets: rider management companies that sit between KiaKia and riders.
--
-- A fleet is a company that manages a group of riders. KiaKia admins create fleets,
-- attach riders and name the fleet's managers; managers get their own console
-- (apps/web/src/app/(fleet)) scoped to their riders. They see which riders are
-- online, where each is heading, a city-wide demand heatmap, and can text their
-- riders. They cannot touch dispatch, money, orders or any rider outside their fleet.
--
-- MEMBERSHIP IS ITS OWN TABLE, not a user_roles row. user_roles' role/scope checks
-- are mirrored in generated types and several gates; a fleet manager is not a
-- platform role, so fleet_managers is the single source of truth and a manager's
-- fleet is looked up from it. One fleet per manager (user_id is the primary key).
--
-- ACCESS MODEL. Same as the rest of the admin surface: every function below is
-- SECURITY DEFINER, search_path pinned, service_role only. The Next.js server
-- derives p_fleet_id from the signed-in user's own fleet_managers row and never
-- from the request, and the writer that takes a manager (fleet_send_message)
-- re-checks that membership itself.
--
-- PRIVACY. Managers see their riders' name, phone, vehicle and live position. For
-- an active delivery they see the pickup store, the destination's city and its
-- coordinates rounded to 3 decimals (about 100 m), never the customer's name,
-- phone or street address. The demand heatmap is aggregated onto a ~550 m grid
-- over the last few hours and hides any cell with fewer than 2 orders, so it
-- cannot single out one customer.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table fleets (
  id          uuid primary key default uuid_generate_v7(),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

create unique index fleets_name_uidx on fleets (lower(btrim(name)));

create table fleet_managers (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  fleet_id    uuid not null references fleets (id) on delete cascade,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

create index fleet_managers_fleet_idx on fleet_managers (fleet_id);

alter table riders add column fleet_id uuid references fleets (id) on delete set null;
create index riders_fleet_idx on riders (fleet_id) where fleet_id is not null;

comment on column riders.fleet_id is
  'The fleet (rider management company) that manages this rider; null = KiaKia-direct. Set only by admin_set_rider_fleet() - riders cannot write riders (0007).';

alter table fleets enable row level security;
alter table fleet_managers enable row level security;

revoke all on fleets, fleet_managers from public, anon, authenticated, service_role;
grant select on fleets, fleet_managers to service_role;
grant select on fleets, fleet_managers to authenticated;

-- A manager can read their own membership and the fleet it points at, and
-- nothing else; this is what the console's gate reads, with the user's own JWT.
create policy "read own fleet membership" on fleet_managers for select
  using (user_id = auth.uid());

create policy "managers read their fleet" on fleets for select
  using (exists (select 1 from fleet_managers m where m.fleet_id = fleets.id and m.user_id = auth.uid()));

-- audit log: allow the new target type
alter table admin_audit_log drop constraint admin_audit_log_target_type_check;
alter table admin_audit_log add constraint admin_audit_log_target_type_check
  check (target_type in ('user', 'vendor', 'rider', 'rider_document', 'order', 'service_area', 'export', 'platform_setting', 'message', 'fleet')) not valid;
alter table admin_audit_log validate constraint admin_audit_log_target_type_check;

-- ---------------------------------------------------------------------------
-- Admin writers (KiaKia admins only), all audited
-- ---------------------------------------------------------------------------

create function admin_create_fleet(p_actor_id uuid, p_name text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_reason text;
  v_id     uuid;
begin
  perform _assert_admin_actor('admin_create_fleet', p_actor_id);
  v_reason := _admin_reason('admin_create_fleet', p_reason, true);
  if v_name is null or char_length(v_name) not between 2 and 80 then
    raise exception 'admin_create_fleet: the fleet name must be 2-80 characters' using errcode = 'check_violation';
  end if;

  insert into fleets (name, created_by) values (v_name, p_actor_id) returning id into v_id;

  perform _write_admin_audit(p_actor_id, 'fleet.create', 'fleet', v_id, v_reason, jsonb_build_object('name', v_name));
  return v_id;
end;
$$;

revoke execute on function admin_create_fleet(uuid, text, text) from public, anon, authenticated;
grant execute on function admin_create_fleet(uuid, text, text) to service_role;

create function admin_set_fleet_status(p_actor_id uuid, p_fleet_id uuid, p_status text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason  text;
  v_changed integer;
begin
  perform _assert_admin_actor('admin_set_fleet_status', p_actor_id);
  v_reason := _admin_reason('admin_set_fleet_status', p_reason, true);
  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception 'admin_set_fleet_status: status must be active or suspended' using errcode = 'check_violation';
  end if;

  update fleets set status = p_status where id = p_fleet_id and status <> p_status;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    if not exists (select 1 from fleets where id = p_fleet_id) then
      raise exception 'admin_set_fleet_status: fleet % does not exist', p_fleet_id using errcode = 'no_data_found';
    end if;
    return false;
  end if;

  perform _write_admin_audit(p_actor_id, 'fleet.set_status', 'fleet', p_fleet_id, v_reason, jsonb_build_object('status', p_status));
  return true;
end;
$$;

revoke execute on function admin_set_fleet_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function admin_set_fleet_status(uuid, uuid, text, text) to service_role;

create function admin_add_fleet_manager(p_actor_id uuid, p_fleet_id uuid, p_user_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason   text;
  v_existing uuid;
begin
  perform _assert_admin_actor('admin_add_fleet_manager', p_actor_id);
  v_reason := _admin_reason('admin_add_fleet_manager', p_reason, true);

  if not exists (select 1 from fleets where id = p_fleet_id) then
    raise exception 'admin_add_fleet_manager: fleet % does not exist', p_fleet_id using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from profiles where id = p_user_id and status = 'active') then
    raise exception 'admin_add_fleet_manager: user % does not exist or is not active', p_user_id using errcode = 'no_data_found';
  end if;

  select fleet_id into v_existing from fleet_managers where user_id = p_user_id;
  if v_existing = p_fleet_id then
    return false;
  elsif v_existing is not null then
    raise exception 'admin_add_fleet_manager: this user already manages another fleet; remove them from it first'
      using errcode = 'check_violation';
  end if;

  insert into fleet_managers (user_id, fleet_id, created_by) values (p_user_id, p_fleet_id, p_actor_id);

  perform _write_admin_audit(p_actor_id, 'fleet.add_manager', 'fleet', p_fleet_id, v_reason, jsonb_build_object('user_id', p_user_id));
  return true;
end;
$$;

revoke execute on function admin_add_fleet_manager(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function admin_add_fleet_manager(uuid, uuid, uuid, text) to service_role;

create function admin_remove_fleet_manager(p_actor_id uuid, p_fleet_id uuid, p_user_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason  text;
  v_changed integer;
begin
  perform _assert_admin_actor('admin_remove_fleet_manager', p_actor_id);
  v_reason := _admin_reason('admin_remove_fleet_manager', p_reason, true);

  delete from fleet_managers where user_id = p_user_id and fleet_id = p_fleet_id;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return false;
  end if;

  perform _write_admin_audit(p_actor_id, 'fleet.remove_manager', 'fleet', p_fleet_id, v_reason, jsonb_build_object('user_id', p_user_id));
  return true;
end;
$$;

revoke execute on function admin_remove_fleet_manager(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function admin_remove_fleet_manager(uuid, uuid, uuid, text) to service_role;

-- Attach a rider to a fleet, or detach with a null fleet. A rider that is mid
-- delivery can be moved: the fleet only decides who can SEE the rider, not who
-- dispatch can offer to.
create function admin_set_rider_fleet(p_actor_id uuid, p_rider_id uuid, p_fleet_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason  text;
  v_before  uuid;
begin
  perform _assert_admin_actor('admin_set_rider_fleet', p_actor_id);
  v_reason := _admin_reason('admin_set_rider_fleet', p_reason, true);

  select fleet_id into v_before from riders where user_id = p_rider_id for update;
  if not found then
    raise exception 'admin_set_rider_fleet: rider % does not exist', p_rider_id using errcode = 'no_data_found';
  end if;
  if p_fleet_id is not null and not exists (select 1 from fleets where id = p_fleet_id) then
    raise exception 'admin_set_rider_fleet: fleet % does not exist', p_fleet_id using errcode = 'no_data_found';
  end if;
  if v_before is not distinct from p_fleet_id then
    return false;
  end if;

  update riders set fleet_id = p_fleet_id where user_id = p_rider_id;

  perform _write_admin_audit(p_actor_id, 'rider.set_fleet', 'rider', p_rider_id, v_reason,
    jsonb_build_object('from_fleet_id', v_before, 'to_fleet_id', p_fleet_id));
  return true;
end;
$$;

revoke execute on function admin_set_rider_fleet(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function admin_set_rider_fleet(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Fleet console reads (service_role; the server supplies the manager's own fleet)
-- ---------------------------------------------------------------------------

-- One row per rider in the fleet with their live state and current delivery.
create function fleet_list_riders(p_fleet_id uuid)
returns table (
  user_id        uuid,
  full_name      text,
  phone          text,
  vehicle_type   text,
  kyc_status     text,
  is_online      boolean,
  is_live        boolean,
  last_ping_at   timestamptz,
  lat            double precision,
  lng            double precision,
  order_id       uuid,
  order_code     text,
  order_status   text,
  vendor_name    text,
  dest_city      text,
  dest_lat       double precision,
  dest_lng       double precision
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_max_age integer;
begin
  perform _message_assert_service('fleet_list_riders');
  if not exists (select 1 from fleets f where f.id = p_fleet_id and f.status = 'active') then
    return;
  end if;
  v_max_age := _platform_setting_int('dispatch_location_max_age_seconds')::integer;

  return query
  select r.user_id,
         coalesce(nullif(btrim(pr.full_name), ''), 'Rider'),
         pr.phone,
         r.vehicle_type,
         r.kyc_status,
         r.is_online,
         (r.is_online and r.last_ping_at >= now() - make_interval(secs => v_max_age)),
         r.last_ping_at,
         st_y(r.current_location::geometry),
         st_x(r.current_location::geometry),
         o.id,
         o.code,
         o.status::text,
         v.name,
         o.delivery_address->>'city',
         round(st_y(o.delivery_location::geometry)::numeric, 3)::double precision,
         round(st_x(o.delivery_location::geometry)::numeric, 3)::double precision
  from riders r
  join profiles pr on pr.id = r.user_id
  left join lateral (
    select x.id, x.code, x.status, x.vendor_id, x.delivery_address, x.delivery_location
    from orders x
    where x.rider_id = r.user_id and x.status in ('rider_assigned', 'picked_up', 'in_transit', 'arrived')
    order by x.created_at desc
    limit 1
  ) o on true
  left join vendors v on v.id = o.vendor_id
  where r.fleet_id = p_fleet_id
  order by (r.is_online and r.last_ping_at >= now() - make_interval(secs => v_max_age)) desc nulls last,
           pr.full_name;
end;
$$;

comment on function fleet_list_riders(uuid) is
  'The fleet console''s rider table: identity, online/live state, position and the current delivery (pickup store, destination city and ~100 m-rounded destination, never customer identity). Empty for a suspended or unknown fleet. service_role only.';

revoke execute on function fleet_list_riders(uuid) from public, anon, authenticated;
grant execute on function fleet_list_riders(uuid) to service_role;

-- Where orders are being placed: a ~550 m grid over the last p_hours, platform
-- wide (managers need to steer riders toward unserved demand, not only their own
-- orders). Cells with fewer than 2 orders are hidden.
create function fleet_demand_cells(p_fleet_id uuid, p_hours integer default 3)
returns table (lat double precision, lng double precision, orders bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c_grid constant double precision := 0.005;
begin
  perform _message_assert_service('fleet_demand_cells');
  if p_hours is null or p_hours not between 1 and 72 then
    raise exception 'fleet_demand_cells: hours must be 1-72' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from fleets f where f.id = p_fleet_id and f.status = 'active') then
    return;
  end if;

  return query
  select (g.cy + 0.5) * c_grid, (g.cx + 0.5) * c_grid, g.n
  from (
    select floor(st_y(o.delivery_location::geometry) / c_grid) as cy,
           floor(st_x(o.delivery_location::geometry) / c_grid) as cx,
           count(*) as n
    from orders o
    where o.placed_at >= now() - make_interval(hours => p_hours)
      and o.status not in ('draft', 'rejected_by_vendor', 'cancelled_by_customer', 'cancelled_by_platform')
    group by 1, 2
    having count(*) >= 2
    order by count(*) desc
    limit 500
  ) g;
end;
$$;

comment on function fleet_demand_cells(uuid, integer) is
  'Order demand on a ~550 m grid over the last p_hours (1-72), platform wide, cells under 2 orders hidden, at most 500 cells. Returns the cell centre and its order count. Empty for a suspended or unknown fleet. service_role only.';

revoke execute on function fleet_demand_cells(uuid, integer) from public, anon, authenticated;
grant execute on function fleet_demand_cells(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Manager -> rider text message
-- ---------------------------------------------------------------------------
--
-- Queues a transactional SMS to riders OF THE ACTOR'S OWN FLEET. Authorised in
-- here (not trusted from the caller): the actor must be a manager of p_fleet_id,
-- the fleet must be active, and every recipient must belong to that fleet.
-- Capped at 50 recipients per send and 100 messages per manager per hour; an
-- identical send within 2 minutes returns the same count without queueing again.
-- Suspended riders and riders with no phone are skipped, not errors.

create function fleet_send_message(p_actor_id uuid, p_fleet_id uuid, p_rider_ids uuid[], p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body     text;
  v_prefix   text;
  v_fleet    text;
  v_ids      uuid[];
  v_id       uuid;
  v_rec      record;
  v_hash     text;
  v_recent   integer;
  v_queued   integer := 0;
begin
  perform _message_assert_service('fleet_send_message');

  select f.name into v_fleet
  from fleets f
  join fleet_managers m on m.fleet_id = f.id and m.user_id = p_actor_id
  where f.id = p_fleet_id and f.status = 'active';
  if v_fleet is null then
    raise exception 'fleet_send_message: you do not manage an active fleet' using errcode = 'insufficient_privilege';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_rider_ids) as x where x is not null;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'fleet_send_message: choose at least one rider' using errcode = 'check_violation';
  end if;
  if cardinality(v_ids) > 50 then
    raise exception 'fleet_send_message: at most 50 riders per message' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(v_ids) as x where not exists (
       select 1 from riders r where r.user_id = x and r.fleet_id = p_fleet_id)) then
    raise exception 'fleet_send_message: every recipient must be a rider in your fleet' using errcode = 'insufficient_privilege';
  end if;

  v_prefix := 'KiaKia - ' || v_fleet || ': ';
  v_body := btrim(replace(coalesce(p_body, ''), E'\r\n', E'\n'));
  if v_body = '' then
    raise exception 'fleet_send_message: write a message' using errcode = 'check_violation';
  end if;
  v_body := v_prefix || v_body;
  perform _message_check_content('fleet_send_message', 'sms', 'transactional', null, v_body);

  perform pg_advisory_xact_lock(hashtext('fleet_send_message:' || p_actor_id::text));

  v_hash := md5(concat_ws('|', p_actor_id::text, v_body, array_to_string(v_ids, ',')));
  if exists (
    select 1 from message_outbox
    where kind = 'direct' and created_by = p_actor_id and channel = 'sms'
      and created_at > now() - interval '2 minutes'
      and starts_with(dedupe_key, 'fleet:' || v_hash || ':')
  ) then
    return 0;
  end if;

  select count(*) into v_recent from message_outbox
  where kind = 'direct' and created_by = p_actor_id and dedupe_key like 'fleet:%' and created_at > now() - interval '1 hour';
  if v_recent + cardinality(v_ids) > 100 then
    raise exception 'fleet_send_message: hourly message limit reached (% sent in the last hour, max 100)', v_recent
      using errcode = 'check_violation';
  end if;

  foreach v_id in array v_ids loop
    select * into v_rec
    from _message_resolve_audience(jsonb_build_object('kind', 'user', 'user_id', v_id), 'sms', 'transactional');
    if v_rec.suppress_reason is not null or v_rec.to_address is null then
      continue;
    end if;

    insert into message_outbox (kind, channel, category, recipient_user_id, to_address, body, status, dedupe_key, created_by)
    values ('direct', 'sms', 'transactional', v_id, v_rec.to_address,
            _message_render(v_body, v_rec.first_name, v_rec.store_name),
            'queued', 'fleet:' || v_hash || ':' || v_id::text || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text,
            p_actor_id);
    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

comment on function fleet_send_message(uuid, uuid, uuid[], text) is
  'Queues a transactional SMS from a fleet manager to riders of their own active fleet (max 50 recipients, 100 messages/hour, identical resend within 2 minutes ignored). Skips suspended or phone-less riders and returns how many were queued. service_role only; the manager is authorised inside.';

revoke execute on function fleet_send_message(uuid, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function fleet_send_message(uuid, uuid, uuid[], text) to service_role;
