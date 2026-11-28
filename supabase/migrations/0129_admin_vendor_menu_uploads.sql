-- Let platform admins prepare vendor menus after a vendor account is created.
-- Item, option rows, category and audit record commit together.

create or replace function admin_create_vendor_menu_item(
  p_actor_id       uuid,
  p_vendor_id      uuid,
  p_name           text,
  p_description    text,
  p_image_url      text,
  p_price_kobo     bigint,
  p_category_key   text,
  p_is_available   boolean,
  p_option_groups  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id       uuid;
  v_category_id   uuid;
  v_group         jsonb;
  v_option        jsonb;
  v_group_id      uuid;
  v_group_name    text;
  v_option_name   text;
  v_min_select    integer;
  v_max_select    integer;
  v_is_required   boolean;
  v_delta_kobo    bigint;
  v_group_count   integer := 0;
  v_option_count  integer := 0;
begin
  perform _assert_admin_actor('admin_create_vendor_menu_item', p_actor_id);

  if not exists (select 1 from vendors where id = p_vendor_id) then
    raise exception 'admin_create_vendor_menu_item: vendor not found' using errcode = 'P0002';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'admin_create_vendor_menu_item: invalid item name' using errcode = '22023';
  end if;
  if p_description is not null and char_length(p_description) > 1000 then
    raise exception 'admin_create_vendor_menu_item: description is too long' using errcode = '22023';
  end if;
  if p_price_kobo is null or p_price_kobo not between 1 and 100000000 then
    raise exception 'admin_create_vendor_menu_item: invalid item price' using errcode = '22023';
  end if;
  if p_category_key is not null and p_category_key not in (
    'swallow', 'soups', 'rice_dishes', 'beans_dishes', 'pasta_noodles',
    'swallow_soup_combos', 'proteins_meat', 'snacks_small_chops', 'breakfast',
    'grills_bbq', 'fast_food', 'sides', 'drinks', 'local_specials'
  ) then
    raise exception 'admin_create_vendor_menu_item: invalid category' using errcode = '22023';
  end if;
  if p_image_url is not null and (
    char_length(p_image_url) > 2048
    or position('/storage/v1/object/public/vendor-media/' || p_vendor_id::text || '/menu/' in p_image_url) = 0
  ) then
    raise exception 'admin_create_vendor_menu_item: invalid menu image' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_option_groups, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_option_groups, '[]'::jsonb)) > 20 then
    raise exception 'admin_create_vendor_menu_item: invalid option groups' using errcode = '22023';
  end if;

  if p_category_key is not null then
    insert into menu_categories (vendor_id, category_key)
    values (p_vendor_id, p_category_key)
    on conflict (vendor_id, category_key) do update set is_active = true
    returning id into v_category_id;
  end if;

  insert into menu_items (
    vendor_id, category_id, name, description, image_url, price_kobo, is_available
  ) values (
    p_vendor_id, v_category_id, btrim(p_name), nullif(btrim(p_description), ''), p_image_url,
    p_price_kobo, coalesce(p_is_available, true)
  ) returning id into v_item_id;

  for v_group in select value from jsonb_array_elements(coalesce(p_option_groups, '[]'::jsonb)) loop
    v_group_name := nullif(btrim(v_group->>'name'), '');
    if v_group_name is null then
      continue;
    end if;
    v_group_count := v_group_count + 1;
    if v_group_count > 20 or char_length(v_group_name) > 100 then
      raise exception 'admin_create_vendor_menu_item: invalid option group name' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(v_group->'options', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(v_group->'options', '[]'::jsonb)) > 50 then
      raise exception 'admin_create_vendor_menu_item: invalid options' using errcode = '22023';
    end if;

    v_min_select := (v_group->>'min_select')::integer;
    v_max_select := (v_group->>'max_select')::integer;
    v_is_required := coalesce((v_group->>'is_required')::boolean, false);
    if v_min_select < 0 or v_min_select > 50 or v_max_select < 1 or v_max_select > 50
       or v_max_select < v_min_select or (v_is_required and v_min_select < 1) then
      raise exception 'admin_create_vendor_menu_item: invalid option selection limits' using errcode = '22023';
    end if;

    insert into option_groups (menu_item_id, name, min_select, max_select, is_required)
    values (v_item_id, v_group_name, v_min_select, v_max_select, v_is_required)
    returning id into v_group_id;

    for v_option in select value from jsonb_array_elements(coalesce(v_group->'options', '[]'::jsonb)) loop
      v_option_name := nullif(btrim(v_option->>'name'), '');
      if v_option_name is null then
        continue;
      end if;
      v_option_count := v_option_count + 1;
      if v_option_count > 1000 or char_length(v_option_name) > 100 then
        raise exception 'admin_create_vendor_menu_item: invalid option name' using errcode = '22023';
      end if;
      v_delta_kobo := (v_option->>'price_delta_kobo')::bigint;
      if v_delta_kobo is null or v_delta_kobo < 0 or v_delta_kobo > 100000000 then
        raise exception 'admin_create_vendor_menu_item: invalid option price' using errcode = '22023';
      end if;

      insert into options (group_id, name, price_delta_kobo)
      values (v_group_id, v_option_name, v_delta_kobo);
    end loop;
  end loop;

  perform _write_admin_audit(
    p_actor_id,
    'vendor.menu_item.create',
    'vendor',
    p_vendor_id,
    null,
    jsonb_build_object(
      'menu_item_id', v_item_id,
      'name', btrim(p_name),
      'price_kobo', p_price_kobo,
      'category_key', p_category_key,
      'is_available', coalesce(p_is_available, true),
      'option_groups', v_group_count,
      'options', v_option_count
    )
  );

  return v_item_id;
end;
$$;

comment on function admin_create_vendor_menu_item(uuid, uuid, text, text, text, bigint, text, boolean, jsonb) is
  'Creates a menu item and its options for a vendor after verifying an active platform admin. Category, item, options, and vendor.menu_item.create audit entry commit atomically. Service role only.';

revoke all on function admin_create_vendor_menu_item(uuid, uuid, text, text, text, bigint, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function admin_create_vendor_menu_item(uuid, uuid, text, text, text, bigint, text, boolean, jsonb) to service_role;
