-- KiaKia - only a superadmin can add or remove fleet managers.
--
-- A fleet manager sees every rider's name, phone and live position for their
-- fleet, so who gets that access is a superadmin decision, not any admin's.
-- Same bodies as 0114; the only change is the authorization level passed to
-- _assert_admin_actor. create or replace keeps the existing grants.

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
  perform _assert_admin_actor('admin_add_fleet_manager', p_actor_id, 'superadmin');
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
  perform _assert_admin_actor('admin_remove_fleet_manager', p_actor_id, 'superadmin');
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
