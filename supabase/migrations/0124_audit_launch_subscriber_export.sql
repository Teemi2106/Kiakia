-- An export copies opted-in email addresses out of the application, so record
-- the admin action before the route reads or returns any subscriber data.
create function admin_log_launch_subscribers_export(p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export_id uuid := uuid_generate_v7();
begin
  perform _assert_admin_actor('admin_log_launch_subscribers_export', p_actor_id, 'admin');
  perform _write_admin_audit(
    p_actor_id,
    'export.launch_subscribers',
    'export',
    v_export_id,
    null,
    jsonb_build_object('kind', 'launch_subscribers', 'format', 'json')
  );
  return v_export_id;
end;
$$;

comment on function admin_log_launch_subscribers_export(uuid) is
  'Audits the start of an active launch-subscriber export before any contact data is read. Requires an active platform admin and is service_role only.';

revoke execute on function admin_log_launch_subscribers_export(uuid) from public, anon, authenticated;
grant execute on function admin_log_launch_subscribers_export(uuid) to service_role;
