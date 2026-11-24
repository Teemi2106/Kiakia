-- Cap KiaKia Coins cashback at 0.5% and ₦500 (5,000 coins) per order.

-- Bring forward any existing admin setting within the new supported range
-- before tightening the platform_settings constraint.
update platform_settings
set value_int = 50,
    updated_at = now()
where key = 'cashback_bps'
  and value_int > 50;

alter table platform_settings
  drop constraint platform_settings_known_key_and_bounds;

alter table platform_settings
  add constraint platform_settings_known_key_and_bounds check (
    (key = 'service_fee_bps' and unit = 'bps' and value_int between 0 and 2000)
    or (key = 'default_vendor_commission_bps' and unit = 'bps' and value_int between 0 and 5000)
    or (key = 'cashback_bps' and unit = 'bps' and value_int between 0 and 50)
  );

create or replace function admin_set_platform_fee(
  p_key        text,
  p_value      bigint,
  p_reason     text,
  p_actor_id   uuid
)
returns platform_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     platform_settings;
  v_before  bigint;
  v_reason  text;
begin
  perform _assert_admin_actor('admin_set_platform_fee', p_actor_id, 'finance');
  v_reason := _admin_reason('admin_set_platform_fee', p_reason, true);

  if p_key is null or p_value is null then
    raise exception 'admin_set_platform_fee: a fee and a value are required'
      using errcode = 'check_violation';
  end if;

  if p_key = 'service_fee_bps' then
    if p_value not between 0 and 2000 then
      raise exception 'admin_set_platform_fee: the service fee must be between 0%% and 20%% (0-2000 basis points), got % basis points', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'default_vendor_commission_bps' then
    if p_value not between 0 and 5000 then
      raise exception 'admin_set_platform_fee: the default commission must be between 0%% and 50%% (0-5000 basis points), got % basis points', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'cashback_bps' then
    if p_value not between 0 and 50 then
      raise exception 'admin_set_platform_fee: cashback must be between 0%% and 0.5%% (0-50 basis points), got % basis points', p_value
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'admin_set_platform_fee: unknown fee %', p_key
      using errcode = 'check_violation';
  end if;

  select * into v_row from platform_settings where key = p_key for update;
  if not found then
    raise exception 'admin_set_platform_fee: fee % is not configured', p_key
      using errcode = 'no_data_found';
  end if;

  v_before := v_row.value_int;
  if v_before = p_value then
    return v_row;
  end if;

  update platform_settings
  set value_int = p_value, updated_at = now(), updated_by = p_actor_id
  where key = p_key
  returning * into v_row;

  perform _write_admin_audit(p_actor_id, 'platform_fee.set', 'platform_setting', v_row.id, v_reason,
    jsonb_build_object('key', p_key, 'unit', v_row.unit, 'from', v_before, 'to', p_value));

  return v_row;
end;
$$;

comment on function admin_set_platform_fee(text, bigint, text, uuid) is
  'Sets service_fee_bps (0-2000), default_vendor_commission_bps (0-5000), or cashback_bps (0-50), row-locked and audited with before/after. Cashback rates are snapshotted on new orders and awarded after delivery, capped at 5,000 coins (₦500) per order. Service fee applies to new orders; default commission applies to new vendors. service_role only; actor must be a superadmin or hold the finance role.';

create or replace function award_order_cashback_coins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eligible_kobo bigint;
  v_rate_bps      integer;
  v_coins         bigint;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then
    return new;
  end if;

  v_eligible_kobo := greatest(new.subtotal_kobo - new.discount_kobo, 0);
  -- Clamp legacy order snapshots too, so no order can earn above 0.5%.
  v_rate_bps := least(coalesce(new.cashback_bps_snapshot, _platform_setting_int('cashback_bps')::integer), 50);

  -- 100 kobo = ₦1 and 10 coins = ₦1. Applying basis points therefore
  -- converts eligible kobo to coins with a denominator of 100,000.
  v_coins := least(floor(v_eligible_kobo::numeric * v_rate_bps / 100000)::bigint, 5000);
  if v_coins <= 0 then
    return new;
  end if;

  insert into customer_coin_entries (customer_id, order_id, entry_type, coins)
  values (new.customer_id, new.id, 'cashback', v_coins)
  on conflict (order_id, entry_type) do nothing;

  return new;
end;
$$;

comment on function award_order_cashback_coins() is
  'Awards up to 0.5% of eligible discounted food spend after delivery, capped at 5,000 KiaKia Coins (₦500) per order.';
