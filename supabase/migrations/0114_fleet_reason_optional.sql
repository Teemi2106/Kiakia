-- KiaKia - fleet admin actions no longer demand a typed reason.
--
-- 0113 made the reason mandatory like the older admin RPCs. For routine fleet work
-- (creating a fleet, attaching a rider, adding a manager) that is friction with no
-- value: the audit row still records who did what and when, and a reason is
-- stored if one is given. Same signatures and bodies as 0113 apart from
-- _admin_reason(..., false); create or replace keeps the existing grants.

create or replace function admin_create_fleet(p_actor_id uuid, p_name text, p_reason text)
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
  v_reason := _admin_reason('admin_create_fleet', p_reason, false);
  if v_name is null or char_length(v_name) not between 2 and 80 then
    raise exception 'admin_create_fleet: the fleet name must be 2-80 characters' using errcode = 'check_violation';
  end if;

  insert into fleets (name, created_by) values (v_name, p_actor_id) returning id into v_id;

  perform _write_admin_audit(p_actor_id, 'fleet.create', 'fleet', v_id, v_reason, jsonb_build_object('name', v_name));
  return v_id;
end;
$$;

create or replace function admin_set_fleet_status(p_actor_id uuid, p_fleet_id uuid, p_status text, p_reason text)
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
  v_reason := _admin_reason('admin_set_fleet_status', p_reason, false);
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

create or replace function admin_add_fleet_manager(p_actor_id uuid, p_fleet_id uuid, p_user_id uuid, p_reason text)
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
  v_reason := _admin_reason('admin_add_fleet_manager', p_reason, false);

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

create or replace function admin_remove_fleet_manager(p_actor_id uuid, p_fleet_id uuid, p_user_id uuid, p_reason text)
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
  v_reason := _admin_reason('admin_remove_fleet_manager', p_reason, false);

  delete from fleet_managers where user_id = p_user_id and fleet_id = p_fleet_id;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return false;
  end if;

  perform _write_admin_audit(p_actor_id, 'fleet.remove_manager', 'fleet', p_fleet_id, v_reason, jsonb_build_object('user_id', p_user_id));
  return true;
end;
$$;

create or replace function admin_set_rider_fleet(p_actor_id uuid, p_rider_id uuid, p_fleet_id uuid, p_reason text)
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
  v_reason := _admin_reason('admin_set_rider_fleet', p_reason, false);

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
