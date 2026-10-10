-- Rider payout destination. The mobile app may only write the authenticated
-- caller's row through update_rider_bank_details(); direct rider-table writes
-- remain revoked by 0007_rls.sql.

alter table riders
  add column bank_name text,
  add column bank_account_name text,
  add column bank_account_number text;

alter table riders
  add constraint riders_bank_details_all_or_none check (
    (bank_name is null and bank_account_name is null and bank_account_number is null)
    or
    (bank_name is not null and bank_account_name is not null and bank_account_number is not null)
  ),
  add constraint riders_bank_name_valid check (
    bank_name is null or char_length(btrim(bank_name)) between 2 and 100
  ),
  add constraint riders_bank_account_name_valid check (
    bank_account_name is null or char_length(btrim(bank_account_name)) between 2 and 150
  ),
  add constraint riders_bank_account_number_valid check (
    bank_account_number is null or bank_account_number ~ '^[0-9]{10}$'
  );

comment on column riders.bank_name is
  'Rider-provided Nigerian bank name for manual or automated payouts.';
comment on column riders.bank_account_name is
  'Rider-provided account holder name for payouts.';
comment on column riders.bank_account_number is
  'Rider-provided 10-digit NUBAN account number. Sensitive: expose only through the rider own-row policy and trusted finance/admin tooling.';

create function update_rider_bank_details(
  p_bank_name text,
  p_account_name text,
  p_account_number text
)
returns riders
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rider riders;
  v_bank_name text := btrim(p_bank_name);
  v_account_name text := btrim(p_account_name);
  v_account_number text := btrim(p_account_number);
begin
  if auth.uid() is null then
    raise exception 'update_rider_bank_details: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if v_bank_name is null or char_length(v_bank_name) not between 2 and 100 then
    raise exception 'update_rider_bank_details: bank name must be between 2 and 100 characters'
      using errcode = 'check_violation';
  end if;
  if v_account_name is null or char_length(v_account_name) not between 2 and 150 then
    raise exception 'update_rider_bank_details: account name must be between 2 and 150 characters'
      using errcode = 'check_violation';
  end if;
  if v_account_number is null or v_account_number !~ '^[0-9]{10}$' then
    raise exception 'update_rider_bank_details: account number must contain exactly 10 digits'
      using errcode = 'check_violation';
  end if;

  update riders
  set bank_name = v_bank_name,
      bank_account_name = v_account_name,
      bank_account_number = v_account_number
  where user_id = auth.uid()
  returning * into v_rider;

  if not found then
    raise exception 'update_rider_bank_details: no rider row for the caller -- call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  return v_rider;
end;
$function$;

comment on function update_rider_bank_details(text, text, text) is
  'Validates and updates the authenticated caller''s own payout destination. It cannot update another rider and direct authenticated writes to riders remain revoked.';

revoke execute on function update_rider_bank_details(text, text, text) from public, anon;
grant execute on function update_rider_bank_details(text, text, text) to authenticated;
