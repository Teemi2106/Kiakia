-- KiaKia - email (Resend) + SMS (Termii) messaging: schema, consent, outbox,
-- worker claim/ack functions, provider-event ingestion.
--
-- THREE migrations make up the feature:
--   0094 (this file)  tables, consent, template rendering, audience resolver,
--                     the worker-facing functions (claim / mark_*), provider
--                     events (delivery receipts, bounces, complaints).
--   0095              admin RPCs: preview, create broadcast, send one message,
--                     list / get broadcasts, list a user's messages.
--   0096              rider-offer SMS fallback + pg_cron/pg_net scheduling
--                     (extends _ensure_scheduled_jobs from 0093).
--
-- MODEL
--   message_preferences  per-user marketing consent, default FALSE (opt-in).
--   message_consent_events  append-only log of every consent change + its source
--                        (NDPA: be able to show when and how consent was given
--                        or withdrawn).
--   message_broadcasts   one row per admin send (the TEMPLATE, audience, reason).
--   message_outbox       one row per recipient message (the RENDERED text, the
--                        address, delivery state machine). Written ONLY by
--                        SECURITY DEFINER functions; the Edge Function worker
--                        consumes it through message_claim_batch()/mark_*().
--   message_settings     tunables (caps, delays, kill switch). service_role may
--                        read; the owner changes them with plain SQL.
--
-- COMPLIANCE POSTURE (Nigeria, NDPA 2023 + NCC rules; assumptions, verify with
-- counsel):
--   * category 'transactional' (operational: order, account, safety, rider
--     dispatch) needs no marketing consent; category 'promotional' needs
--     message_preferences.marketing_<channel> = true. Consent is re-checked at
--     claim time, so an opt-out between enqueue and send still wins.
--   * Every promotional message carries an opt-out path (appended by the worker).
--   * Promotional SMS are only released between 08:00 and 20:00 Africa/Lagos
--     (NCC promotional-SMS window as I understand it); the claim function leaves
--     them queued outside it.
--   * Message bodies/addresses are scrubbed after 90 days (scrub_message_outbox).
--
-- SECURITY: every new table has RLS enabled; only message_preferences has
-- (own-row) policies. No client role can touch the outbox/broadcasts/settings.

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- message_settings
-- ---------------------------------------------------------------------------

create table message_settings (
  key         text primary key,
  value_int   integer not null,
  updated_at  timestamptz not null default now(),
  constraint message_settings_known_key check (key in (
    'rider_offer_sms_enabled',
    'rider_offer_sms_delay_seconds',
    'rider_offer_sms_hourly_cap',
    'promo_broadcasts_per_day',
    'transactional_broadcasts_per_day',
    'direct_messages_per_actor_hour',
    'broadcast_recipient_cap',
    'max_send_attempts'
  )),
  constraint message_settings_bounds check (value_int >= 0)
);

comment on table message_settings is
  'Messaging tunables. rider_offer_sms_enabled is a 0/1 kill switch. service_role may select; change a value with plain SQL as the owner (no admin UI by design).';

alter table message_settings enable row level security;
revoke all on message_settings from public, anon, authenticated, service_role;
grant select on message_settings to service_role;

insert into message_settings (key, value_int) values
  ('rider_offer_sms_enabled', 1),
  ('rider_offer_sms_delay_seconds', 12),
  ('rider_offer_sms_hourly_cap', 6),
  ('promo_broadcasts_per_day', 5),
  ('transactional_broadcasts_per_day', 30),
  ('direct_messages_per_actor_hour', 30),
  ('broadcast_recipient_cap', 5000),
  ('max_send_attempts', 5);

create function _message_setting(p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v integer;
begin
  select value_int into v from message_settings where key = p_key;
  if v is null then
    raise exception '_message_setting: setting % is not configured', p_key;
  end if;
  return v;
end;
$$;

revoke all on function _message_setting(text) from public, anon, authenticated;
grant execute on function _message_setting(text) to service_role;

create function _message_assert_service(p_caller text)
returns void
language plpgsql
stable
as $$
begin
  if coalesce(auth.role(), current_setting('role', true)) is distinct from 'service_role' then
    raise exception '%: requires the service-role key', p_caller
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function _message_assert_service(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- message_preferences (consent) + consent log
-- ---------------------------------------------------------------------------

create table message_preferences (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  marketing_email  boolean not null default false,
  marketing_sms    boolean not null default false,
  updated_at       timestamptz not null default now()
);

comment on table message_preferences is
  'Per-user opt-in for PROMOTIONAL email/SMS. Absent row = both false (no consent). Transactional/operational messages ignore this table. Owner may read/update own row; set_message_preferences() is the supported writer.';

alter table message_preferences enable row level security;

revoke all on message_preferences from public, anon, authenticated, service_role;
grant select, update (marketing_email, marketing_sms) on message_preferences to authenticated;
grant select, insert, update, delete on message_preferences to service_role;

create policy "read own message preferences" on message_preferences
  for select using (user_id = (select auth.uid()));
create policy "update own message preferences" on message_preferences
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger message_preferences_set_updated_at
  before update on message_preferences
  for each row execute function set_updated_at();

create table message_consent_events (
  id          uuid primary key default uuid_generate_v7(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  channel     text not null check (channel in ('email', 'sms')),
  granted     boolean not null,
  source      text not null check (source in ('user', 'unsubscribe_link', 'provider_bounce', 'provider_complaint', 'admin')),
  created_at  timestamptz not null default now()
);

create index message_consent_events_user_idx on message_consent_events (user_id, created_at desc);

comment on table message_consent_events is
  'Append-only log of marketing consent grants/withdrawals with their source (NDPA accountability). Written by the message_preferences trigger.';

alter table message_consent_events enable row level security;
revoke all on message_consent_events from public, anon, authenticated, service_role;
grant select on message_consent_events to service_role;

-- ---------------------------------------------------------------------------
-- message_broadcasts / message_outbox
-- ---------------------------------------------------------------------------

create table message_broadcasts (
  id               uuid primary key default uuid_generate_v7(),
  created_by       uuid not null references auth.users (id),
  channel          text not null check (channel in ('email', 'sms')),
  category         text not null check (category in ('transactional', 'promotional')),
  audience         jsonb not null,
  audience_label   text not null,
  subject          text,
  body             text not null,
  recipient_count  integer not null default 0 check (recipient_count >= 0),
  reason           text not null,
  request_hash     text not null,
  idempotency_key  text,
  created_at       timestamptz not null default now()
);

comment on table message_broadcasts is
  'One admin broadcast: the TEMPLATE (with {{first_name}}/{{store_name}} variables), audience and reason. recipient_count = rows queued for sending at creation (suppressed ones are only in message_outbox). request_hash/idempotency_key make a double submit harmless.';

create index message_broadcasts_created_at_idx on message_broadcasts (created_at desc, id desc);
create index message_broadcasts_hash_idx on message_broadcasts (created_by, request_hash, created_at desc);
create unique index message_broadcasts_idem_uidx on message_broadcasts (created_by, idempotency_key)
  where idempotency_key is not null;

alter table message_broadcasts enable row level security;
revoke all on message_broadcasts from public, anon, authenticated, service_role;
grant select on message_broadcasts to service_role;

create table message_outbox (
  id                   uuid primary key default uuid_generate_v7(),
  broadcast_id         uuid references message_broadcasts (id),
  kind                 text not null check (kind in ('broadcast', 'direct', 'rider_offer', 'system')),
  channel              text not null check (channel in ('email', 'sms')),
  category             text not null check (category in ('transactional', 'promotional')),
  recipient_user_id    uuid references auth.users (id) on delete set null,
  to_address           text,
  subject              text,
  body                 text not null,
  status               text not null default 'queued'
                       check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'suppressed')),
  suppress_reason      text check (suppress_reason in ('no_address', 'no_consent', 'suspended', 'expired', 'rate_limited', 'opted_out')),
  attempts             integer not null default 0,
  next_attempt_at      timestamptz not null default now(),
  expires_at           timestamptz,
  provider             text,
  provider_message_id  text,
  error                text,
  dedupe_key           text unique,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  delivered_at         timestamptz,
  constraint message_outbox_suppressed_has_reason
    check ((status = 'suppressed') = (suppress_reason is not null)),
  constraint message_outbox_promotional_never_rider_offer
    check (not (kind = 'rider_offer' and category = 'promotional'))
);

comment on table message_outbox is
  'One row per recipient message with its delivery state machine: queued -> sending -> sent -> delivered | failed, or suppressed (never sent; suppress_reason says why). body/subject are the RENDERED plain text; the worker HTML-escapes for email. expires_at (rider offers) turns a stale queued row into suppressed(expired) instead of texting about a gone offer. Addresses/bodies are scrubbed after 90 days.';

-- worker: due rows only
create index message_outbox_due_idx on message_outbox (next_attempt_at)
  where status in ('queued', 'sending');
-- webhooks: find by provider id
create index message_outbox_provider_msg_idx on message_outbox (provider, provider_message_id)
  where provider_message_id is not null;
-- broadcast stats / detail
create index message_outbox_broadcast_idx on message_outbox (broadcast_id, status)
  where broadcast_id is not null;
-- per-user history, per-rider hourly cap
create index message_outbox_user_idx on message_outbox (recipient_user_id, created_at desc);

alter table message_outbox enable row level security;
revoke all on message_outbox from public, anon, authenticated, service_role;
grant select on message_outbox to service_role;

-- audit log: allow the new target type
alter table admin_audit_log drop constraint admin_audit_log_target_type_check;
alter table admin_audit_log add constraint admin_audit_log_target_type_check
  check (target_type in ('user', 'vendor', 'rider', 'rider_document', 'order', 'service_area', 'export', 'platform_setting', 'message')) not valid;
alter table admin_audit_log validate constraint admin_audit_log_target_type_check;

-- ---------------------------------------------------------------------------
-- Consent trigger: log changes, and honour an opt-out for anything queued
-- ---------------------------------------------------------------------------

create function message_preferences_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := coalesce(nullif(current_setting('kiakia.consent_source', true), ''), 'user');
begin
  if v_source not in ('user', 'unsubscribe_link', 'provider_bounce', 'provider_complaint', 'admin') then
    v_source := 'user';
  end if;

  if tg_op = 'INSERT' then
    if new.marketing_email then
      insert into message_consent_events (user_id, channel, granted, source) values (new.user_id, 'email', true, v_source);
    end if;
    if new.marketing_sms then
      insert into message_consent_events (user_id, channel, granted, source) values (new.user_id, 'sms', true, v_source);
    end if;
    return new;
  end if;

  if new.marketing_email is distinct from old.marketing_email then
    insert into message_consent_events (user_id, channel, granted, source)
    values (new.user_id, 'email', new.marketing_email, v_source);
    if not new.marketing_email then
      update message_outbox set status = 'suppressed', suppress_reason = 'opted_out'
      where recipient_user_id = new.user_id and channel = 'email'
        and category = 'promotional' and status = 'queued';
    end if;
  end if;
  if new.marketing_sms is distinct from old.marketing_sms then
    insert into message_consent_events (user_id, channel, granted, source)
    values (new.user_id, 'sms', new.marketing_sms, v_source);
    if not new.marketing_sms then
      update message_outbox set status = 'suppressed', suppress_reason = 'opted_out'
      where recipient_user_id = new.user_id and channel = 'sms'
        and category = 'promotional' and status = 'queued';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function message_preferences_after_write() from public, anon, authenticated, service_role;

create trigger message_preferences_after_write
  after insert or update on message_preferences
  for each row execute function message_preferences_after_write();

-- ---------------------------------------------------------------------------
-- Preference RPCs (the logged-in user: customer, vendor, rider alike)
-- ---------------------------------------------------------------------------

create function set_message_preferences(
  p_marketing_email boolean default null,
  p_marketing_sms   boolean default null
)
returns message_preferences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  message_preferences;
begin
  if v_uid is null then
    raise exception 'set_message_preferences: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;
  -- Deliberately NOT gated on an active profile: withdrawing consent must
  -- always work. A NULL argument leaves that channel unchanged.

  perform set_config('kiakia.consent_source', 'user', true);

  insert into message_preferences (user_id, marketing_email, marketing_sms)
  values (v_uid, coalesce(p_marketing_email, false), coalesce(p_marketing_sms, false))
  on conflict (user_id) do update
    set marketing_email = coalesce(p_marketing_email, message_preferences.marketing_email),
        marketing_sms   = coalesce(p_marketing_sms, message_preferences.marketing_sms)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function set_message_preferences(boolean, boolean) is
  'The caller sets their own promotional email/SMS consent (NULL = leave unchanged). Works for any signed-in account, including suspended ones (opt-out must always work). Logged in message_consent_events.';

revoke execute on function set_message_preferences(boolean, boolean) from public, anon;
grant execute on function set_message_preferences(boolean, boolean) to authenticated;

create function get_message_preferences()
returns table (marketing_email boolean, marketing_sms boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(mp.marketing_email, false), coalesce(mp.marketing_sms, false)
  from (select 1) one
  left join message_preferences mp on mp.user_id = auth.uid()
  where auth.uid() is not null;
$$;

comment on function get_message_preferences() is
  'The caller''s effective marketing consent (both false when they have never set it). No row for anon.';

revoke execute on function get_message_preferences() from public, anon;
grant execute on function get_message_preferences() to authenticated;

-- Unsubscribe link / bounce / complaint -> consent withdrawn. The Next.js
-- unsubscribe page verifies the HMAC token, then calls this with the
-- service-role key. Idempotent; returns true when something changed.
create function message_opt_out(p_user_id uuid, p_channel text, p_source text default 'unsubscribe_link')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean := false;
  v_row     message_preferences;
begin
  perform _message_assert_service('message_opt_out');

  if p_channel not in ('email', 'sms') then
    raise exception 'message_opt_out: channel must be email or sms' using errcode = 'check_violation';
  end if;
  if p_source not in ('unsubscribe_link', 'provider_bounce', 'provider_complaint', 'admin') then
    raise exception 'message_opt_out: unknown source %', p_source using errcode = 'check_violation';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    return false;
  end if;

  perform set_config('kiakia.consent_source', p_source, true);

  insert into message_preferences (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_row from message_preferences where user_id = p_user_id for update;

  if p_channel = 'email' and v_row.marketing_email then
    update message_preferences set marketing_email = false where user_id = p_user_id;
    v_changed := true;
  elsif p_channel = 'sms' and v_row.marketing_sms then
    update message_preferences set marketing_sms = false where user_id = p_user_id;
    v_changed := true;
  end if;

  perform set_config('kiakia.consent_source', '', true);
  return v_changed;
end;
$$;

comment on function message_opt_out(uuid, text, text) is
  'Withdraws promotional consent for one channel (unsubscribe link, hard bounce, spam complaint). Idempotent; suppresses that user''s queued promotional messages via the trigger. service_role only; the caller (Next.js unsubscribe route / webhook function) has already verified the token or signature.';

revoke execute on function message_opt_out(uuid, text, text) from public, anon, authenticated;
grant execute on function message_opt_out(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Template rendering (plain text; variables substituted per recipient)
-- ---------------------------------------------------------------------------

-- Strips control characters and braces (so a value can never smuggle in a
-- {{variable}}) and caps the length.
create function _message_clean_value(p_value text, p_max integer)
returns text
language sql
immutable
as $$
  select left(btrim(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]{}]', '', 'g')), p_max);
$$;

revoke all on function _message_clean_value(text, integer) from public, anon, authenticated;
grant execute on function _message_clean_value(text, integer) to service_role;

-- Known variables: first_name (max 40), store_name (max 60). Any other
-- {{...}} token renders as the empty string. Matching is case-insensitive and
-- tolerates inner spaces ({{ first_name }}).
create function _message_render(p_template text, p_first_name text, p_store_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               coalesce(p_template, ''),
               '\{\{\s*first_name\s*\}\}',
               replace(_message_clean_value(p_first_name, 40), '\', '\\'), 'gi'),
             '\{\{\s*store_name\s*\}\}',
             replace(_message_clean_value(p_store_name, 60), '\', '\\'), 'gi'),
           '\{\{[^{}]*\}\}', '', 'g');
$$;

comment on function _message_render(text, text, text) is
  'Per-recipient substitution of {{first_name}} / {{store_name}} into a plain-text template; unknown variables become empty; values are stripped of control chars and braces and length-capped (40 / 60).';

revoke all on function _message_render(text, text, text) from public, anon, authenticated;
grant execute on function _message_render(text, text, text) to service_role;

-- Content rules, checked against the WORST CASE render (every variable at its
-- maximum length), so a template that passes can never overflow for any
-- recipient.
--   sms        612 chars (4 x 153 GSM-7 segments); 268 (4 x 67) if the text
--              holds anything outside printable ASCII (treated as Unicode);
--              promotional SMS leave room for the opt-out line the worker
--              appends ("Opt out: <SITE_URL>/u/<signed token>", about 170
--              characters with the exact token format): 440 / 90.
--   email      subject 1-150 chars, one line; body <= 5000 chars.
create function _message_check_content(
  p_caller text, p_channel text, p_category text, p_subject text, p_body text
)
returns void
language plpgsql
immutable
as $$
declare
  v_worst_body    text;
  v_worst_subject text;
  v_limit         integer;
  v_promo         boolean := (p_category = 'promotional');
begin
  if p_channel is null or p_channel not in ('email', 'sms') then
    raise exception '%: channel must be email or sms', p_caller using errcode = 'check_violation';
  end if;
  if p_category is null or p_category not in ('transactional', 'promotional') then
    raise exception '%: category must be transactional or promotional', p_caller using errcode = 'check_violation';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception '%: a message body is required', p_caller using errcode = 'check_violation';
  end if;
  if p_body ~ '[\x01-\x08\x0b-\x1f\x7f]' or coalesce(p_subject, '') ~ '[\x01-\x1f\x7f]' then
    raise exception '%: message text contains control characters', p_caller using errcode = 'check_violation';
  end if;

  v_worst_body := _message_render(p_body, repeat('x', 40), repeat('x', 60));

  if p_channel = 'sms' then
    if nullif(btrim(coalesce(p_subject, '')), '') is not null then
      raise exception '%: an SMS has no subject', p_caller using errcode = 'check_violation';
    end if;
    if v_worst_body ~ '[^ -~\n]' then
      v_limit := case when v_promo then 90 else 268 end;
    else
      v_limit := case when v_promo then 440 else 612 end;
    end if;
    if char_length(v_worst_body) > v_limit then
      raise exception '%: SMS body is too long (% characters after variables, limit %)', p_caller, char_length(v_worst_body), v_limit
        using errcode = 'check_violation';
    end if;
  else
    if nullif(btrim(coalesce(p_subject, '')), '') is null then
      raise exception '%: an email subject is required', p_caller using errcode = 'check_violation';
    end if;
    v_worst_subject := _message_render(btrim(p_subject), repeat('x', 40), repeat('x', 60));
    if char_length(v_worst_subject) > 150 then
      raise exception '%: email subject must be at most 150 characters', p_caller using errcode = 'check_violation';
    end if;
    if char_length(v_worst_body) > 5000 then
      raise exception '%: email body must be at most 5000 characters', p_caller using errcode = 'check_violation';
    end if;
  end if;
end;
$$;

revoke all on function _message_check_content(text, text, text, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audience: strict validation + resolver
-- ---------------------------------------------------------------------------
--
-- Shapes (unknown keys rejected):
--   {"kind":"role","role":"customer","segment":"all|ordered_30d|inactive_30d"}
--   {"kind":"role","role":"vendor",  "segment":"all|active|pending|suspended"}
--   {"kind":"role","role":"rider",   "segment":"all|active|pending|online"}
--   {"kind":"user","user_id":"<uuid>"}
-- segment defaults to "all". Definitions:
--   customer  profile with NO role other than 'customer' (as admin_list_customers,
--             0090). ordered_30d: has an order created in the last 30 days
--             that is not a draft; inactive_30d: has none (never-ordered counts).
--   vendor    the OWNER account (vendors.owner_user_id) of a store; one message
--             per owner, {{store_name}} = their earliest store matching the
--             segment. active/pending/suspended = vendors.status of that store.
--   rider     a riders row. active = kyc approved; pending = kyc pending;
--             online = kyc approved AND is_online. 'all' includes rejected.
--   Deleted accounts are never in an audience. Accounts with status
--   'suspended' are listed but suppressed (reason suspended).

create function _message_normalize_audience(p_caller text, p_audience jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_key      text;
  v_kind     text;
  v_role     text;
  v_segment  text;
  v_user     text;
begin
  if p_audience is null or jsonb_typeof(p_audience) <> 'object' then
    raise exception '%: audience must be a JSON object', p_caller using errcode = 'check_violation';
  end if;
  for v_key in select jsonb_object_keys(p_audience) loop
    if v_key not in ('kind', 'role', 'segment', 'user_id') then
      raise exception '%: unknown audience key %', p_caller, v_key using errcode = 'check_violation';
    end if;
  end loop;

  v_kind := p_audience->>'kind';
  if v_kind = 'user' then
    if p_audience ? 'role' or p_audience ? 'segment' then
      raise exception '%: a user audience takes only user_id', p_caller using errcode = 'check_violation';
    end if;
    v_user := p_audience->>'user_id';
    if jsonb_typeof(p_audience->'user_id') is distinct from 'string'
       or v_user !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception '%: user_id must be a UUID', p_caller using errcode = 'check_violation';
    end if;
    return jsonb_build_object('kind', 'user', 'user_id', lower(v_user));
  elsif v_kind = 'role' then
    if p_audience ? 'user_id' then
      raise exception '%: a role audience takes no user_id', p_caller using errcode = 'check_violation';
    end if;
    v_role := p_audience->>'role';
    v_segment := coalesce(p_audience->>'segment', 'all');
    if jsonb_typeof(p_audience->'role') is distinct from 'string'
       or (p_audience ? 'segment' and jsonb_typeof(p_audience->'segment') is distinct from 'string') then
      raise exception '%: role and segment must be strings', p_caller using errcode = 'check_violation';
    end if;
    if not (
         (v_role = 'customer' and v_segment in ('all', 'ordered_30d', 'inactive_30d'))
      or (v_role = 'vendor'   and v_segment in ('all', 'active', 'pending', 'suspended'))
      or (v_role = 'rider'    and v_segment in ('all', 'active', 'pending', 'online'))
    ) then
      raise exception '%: segment % is not valid for role %', p_caller, v_segment, coalesce(v_role, '(none)')
        using errcode = 'check_violation';
    end if;
    return jsonb_build_object('kind', 'role', 'role', v_role, 'segment', v_segment);
  end if;

  raise exception '%: audience kind must be role or user', p_caller using errcode = 'check_violation';
end;
$$;

revoke all on function _message_normalize_audience(text, jsonb) from public, anon, authenticated, service_role;

create function _message_audience_label(p_audience jsonb, p_user_name text default null)
returns text
language sql
immutable
as $$
  select case
    when p_audience->>'kind' = 'user' then 'User: ' || coalesce(nullif(p_user_name, ''), p_audience->>'user_id')
    else (case p_audience->>'role' when 'customer' then 'Customers' when 'vendor' then 'Vendors' else 'Riders' end)
         || ': '
         || (case p_audience->>'segment'
               when 'all' then 'all'
               when 'ordered_30d' then 'ordered in the last 30 days'
               when 'inactive_30d' then 'no order in the last 30 days'
               else p_audience->>'segment' end)
  end;
$$;

revoke all on function _message_audience_label(jsonb, text) from public, anon, authenticated, service_role;

create function _message_resolve_audience(p_audience jsonb, p_channel text, p_category text)
returns table (
  user_id         uuid,
  role            text,
  display_name    text,
  first_name      text,
  store_name      text,
  to_address      text,
  suppress_reason text
)
language plpgsql
stable
security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
declare
  v_kind     text := p_audience->>'kind';
  v_role     text := p_audience->>'role';
  v_segment  text := p_audience->>'segment';
  v_user     uuid := (p_audience->>'user_id')::uuid;
begin
  if v_kind = 'user' and not exists (select 1 from profiles where id = v_user and status <> 'deleted') then
    raise exception '_message_resolve_audience: user % does not exist or was deleted', v_user
      using errcode = 'no_data_found';
  end if;

  return query
  with base as (
    -- customers: no role other than 'customer'
    select p.id as uid, 'customer'::text as r, p.full_name, null::text as store, p.status, p.phone
    from profiles p
    where v_kind = 'role' and v_role = 'customer'
      and p.status <> 'deleted'
      and not exists (select 1 from user_roles ur where ur.user_id = p.id and ur.role <> 'customer')
      and case v_segment
            when 'ordered_30d' then exists (
              select 1 from orders o
              where o.customer_id = p.id and o.status <> 'draft' and o.created_at >= now() - interval '30 days')
            when 'inactive_30d' then not exists (
              select 1 from orders o
              where o.customer_id = p.id and o.status <> 'draft' and o.created_at >= now() - interval '30 days')
            else true end
    union all
    -- vendors: store owners, one row per owner
    (select distinct on (v.owner_user_id)
           p.id, 'vendor'::text, p.full_name, v.name, p.status, p.phone
     from vendors v
     join profiles p on p.id = v.owner_user_id
     where v_kind = 'role' and v_role = 'vendor'
       and p.status <> 'deleted'
       and (v_segment = 'all' or v.status = v_segment)
     order by v.owner_user_id, v.created_at, v.id)
    union all
    -- riders
    select p.id, 'rider'::text, p.full_name, null::text, p.status, p.phone
    from riders r
    join profiles p on p.id = r.user_id
    where v_kind = 'role' and v_role = 'rider'
      and p.status <> 'deleted'
      and case v_segment
            when 'active' then r.kyc_status = 'approved'
            when 'pending' then r.kyc_status = 'pending'
            when 'online' then r.kyc_status = 'approved' and r.is_online
            else true end
    union all
    -- a single user, role derived (rider > vendor > admin > customer)
    select p.id,
           case when exists (select 1 from riders r where r.user_id = p.id) then 'rider'
                when exists (select 1 from vendors v where v.owner_user_id = p.id) then 'vendor'
                when exists (select 1 from user_roles ur where ur.user_id = p.id and ur.role in ('admin', 'superadmin', 'finance', 'support')) then 'admin'
                else 'customer' end,
           p.full_name,
           (select v.name from vendors v where v.owner_user_id = p.id order by v.created_at, v.id limit 1),
           p.status, p.phone
    from profiles p
    where v_kind = 'user' and p.id = v_user and p.status <> 'deleted'
  ),
  enriched as (
    select b.uid, b.r, b.full_name, b.store, b.status,
           case p_channel
             when 'email' then
               case when u.email_confirmed_at is not null
                         and u.email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
                         and u.email !~* '\.(local|invalid|test|example)$'
                    then lower(u.email) end
             else b.phone
           end as addr,
           coalesce(case p_channel when 'email' then mp.marketing_email else mp.marketing_sms end, false) as consent,
           u.email as raw_email
    from base b
    join auth.users u on u.id = b.uid
    left join message_preferences mp on mp.user_id = b.uid
  )
  select e.uid,
         e.r,
         coalesce(nullif(btrim(e.full_name), ''), nullif(split_part(coalesce(e.raw_email, ''), '@', 1), ''), 'Unnamed'),
         coalesce(nullif(split_part(btrim(coalesce(e.full_name, '')), ' ', 1), ''), 'there'),
         case when e.r = 'vendor' then coalesce(e.store, 'your store') else coalesce(e.store, '') end,
         e.addr,
         case when e.status <> 'active' then 'suspended'
              when e.addr is null then 'no_address'
              when p_category = 'promotional' and not e.consent then 'no_consent'
         end
  from enriched e
  order by e.uid;
end;
$$;

comment on function _message_resolve_audience(jsonb, text, text) is
  'Internal: resolves a validated audience to one row per account with the channel address and, if it cannot be messaged, why (suspended > no_address > no_consent). Email requires a CONFIRMED, plausible, non-dev address; SMS uses profiles.phone. Never granted to clients.';

revoke all on function _message_resolve_audience(jsonb, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Worker functions (service_role): claim, mark sent / failed / suppressed
-- ---------------------------------------------------------------------------

-- 30 s, 2 min, 8 min, 32 min, then 60 min cap.
create function _message_backoff_seconds(p_attempts integer)
returns integer
language sql
immutable
as $$
  select least(3600, (30 * power(4, greatest(coalesce(p_attempts, 1), 1) - 1))::integer);
$$;

comment on function _message_backoff_seconds(integer) is
  'Retry delay after attempt number p_attempts: 30s * 4^(n-1), capped at 3600s.';

revoke all on function _message_backoff_seconds(integer) from public, anon, authenticated;
grant execute on function _message_backoff_seconds(integer) to service_role;

-- Claims up to p_limit due rows for the Edge Function worker.
--   * stale rider-offer rows past expires_at -> suppressed(expired)
--   * promotional rows whose recipient has since withdrawn consent -> suppressed(no_consent)
--   * rows stuck 'sending' with an expired 5-minute lease are re-claimable until
--     max_send_attempts, then failed('worker_timeout')
--   * FOR UPDATE SKIP LOCKED: two workers never receive the same row
--   * promotional SMS only 08:00-19:59 Africa/Lagos; transactional first
create function message_claim_batch(p_limit integer default 20)
returns setof message_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer := _message_setting('max_send_attempts');
begin
  perform _message_assert_service('message_claim_batch');
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'message_claim_batch: limit must be 1-100' using errcode = 'check_violation';
  end if;

  update message_outbox o
  set status = 'suppressed', suppress_reason = 'expired'
  where o.id in (
    select q.id from message_outbox q
    where q.status = 'queued' and q.expires_at is not null and q.expires_at <= now()
    for update skip locked
  );

  update message_outbox o
  set status = 'suppressed', suppress_reason = 'no_consent'
  where o.id in (
    select q.id from message_outbox q
    where q.status = 'queued' and q.category = 'promotional' and q.next_attempt_at <= now()
    for update skip locked
  )
  and not exists (
    select 1 from message_preferences mp
    where mp.user_id = o.recipient_user_id
      and case o.channel when 'email' then mp.marketing_email else mp.marketing_sms end
  );

  update message_outbox o
  set status = 'failed', error = 'worker_timeout'
  where o.id in (
    select q.id from message_outbox q
    where q.status = 'sending' and q.next_attempt_at <= now() and q.attempts >= v_max
    for update skip locked
  );

  return query
  with c as (
    select q.id
    from message_outbox q
    where ((q.status = 'queued' and q.next_attempt_at <= now())
        or (q.status = 'sending' and q.next_attempt_at <= now() and q.attempts < v_max))
      and not (q.category = 'promotional' and q.channel = 'sms'
               and extract(hour from now() at time zone 'Africa/Lagos') not between 8 and 19)
    order by (q.category = 'transactional') desc, q.next_attempt_at
    limit p_limit
    for update skip locked
  )
  update message_outbox o
  set status = 'sending',
      attempts = o.attempts + 1,
      next_attempt_at = now() + interval '5 minutes'
  from c
  where o.id = c.id
  returning o.*;
end;
$$;

comment on function message_claim_batch(integer) is
  'Worker: atomically claims up to p_limit due outbox rows (queued -> sending, attempts+1, 5-minute lease) with FOR UPDATE SKIP LOCKED, after expiring stale rows and re-checking promotional consent. service_role only.';

revoke execute on function message_claim_batch(integer) from public, anon, authenticated;
grant execute on function message_claim_batch(integer) to service_role;

create function message_mark_sent(p_id uuid, p_provider text, p_provider_message_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform _message_assert_service('message_mark_sent');
  update message_outbox
  set status = 'sent', sent_at = now(), provider = left(p_provider, 40),
      provider_message_id = left(p_provider_message_id, 200), error = null
  where id = p_id and status = 'sending';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

revoke execute on function message_mark_sent(uuid, text, text) from public, anon, authenticated;
grant execute on function message_mark_sent(uuid, text, text) to service_role;

-- Records a failed attempt. Permanent (bad address) or attempts exhausted ->
-- failed. Otherwise back to queued with exponential backoff. A row past its
-- expires_at is suppressed(expired) rather than retried. Returns the new status
-- ('ignored' if the row was not in 'sending').
create function message_mark_failed(p_id uuid, p_error text, p_permanent boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row message_outbox;
  v_max integer := _message_setting('max_send_attempts');
  v_err text := left(coalesce(p_error, 'unknown error'), 300);
begin
  perform _message_assert_service('message_mark_failed');

  select * into v_row from message_outbox where id = p_id for update;
  if not found or v_row.status <> 'sending' then
    return 'ignored';
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    update message_outbox set status = 'suppressed', suppress_reason = 'expired', error = v_err where id = p_id;
    return 'suppressed';
  elsif coalesce(p_permanent, false) or v_row.attempts >= v_max then
    update message_outbox set status = 'failed', error = v_err where id = p_id;
    return 'failed';
  end if;

  update message_outbox
  set status = 'queued', error = v_err,
      next_attempt_at = now() + make_interval(secs => _message_backoff_seconds(v_row.attempts))
  where id = p_id;
  return 'queued';
end;
$$;

revoke execute on function message_mark_failed(uuid, text, boolean) from public, anon, authenticated;
grant execute on function message_mark_failed(uuid, text, boolean) to service_role;

-- Worker decided at send time that this must not go out (e.g. no longer
-- deliverable). Only a row it holds ('sending') can be suppressed.
create function message_mark_suppressed(p_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform _message_assert_service('message_mark_suppressed');
  if p_reason not in ('no_address', 'no_consent', 'suspended', 'expired', 'opted_out') then
    raise exception 'message_mark_suppressed: unknown reason %', p_reason using errcode = 'check_violation';
  end if;
  update message_outbox set status = 'suppressed', suppress_reason = p_reason
  where id = p_id and status = 'sending';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

revoke execute on function message_mark_suppressed(uuid, text) from public, anon, authenticated;
grant execute on function message_mark_suppressed(uuid, text) to service_role;

-- Delivery receipts / bounces / complaints from the providers' webhooks.
--   delivered   sent|sending -> delivered
--   failed      sent|sending|delivered -> failed
--   bounced     (HARD bounce) as failed, and withdraws marketing_email
--   complained  spam complaint: status unchanged unless nothing was delivered
--               yet (then failed); records error 'spam_complaint'; withdraws
--               marketing_email
-- Replays are harmless (state guards). Returns 'applied' | 'ignored' |
-- 'not_found' (the webhook answers non-2xx on not_found so the provider retries;
-- covers the receipt racing the worker's mark_sent).
create function message_apply_provider_event(
  p_provider            text,
  p_provider_message_id text,
  p_outbox_id           uuid,
  p_event               text,
  p_detail              text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    message_outbox;
  v_detail text := left(nullif(btrim(coalesce(p_detail, '')), ''), 300);
begin
  perform _message_assert_service('message_apply_provider_event');
  if p_event not in ('delivered', 'failed', 'bounced', 'complained') then
    raise exception 'message_apply_provider_event: unknown event %', p_event using errcode = 'check_violation';
  end if;

  if p_outbox_id is not null then
    select * into v_row from message_outbox where id = p_outbox_id for update;
  elsif p_provider_message_id is not null then
    select * into v_row from message_outbox
    where provider = p_provider and provider_message_id = p_provider_message_id
    order by created_at desc limit 1 for update;
  end if;
  if v_row.id is null then
    return 'not_found';
  end if;

  if p_event = 'delivered' then
    if v_row.status in ('sent', 'sending') then
      update message_outbox set status = 'delivered', delivered_at = now(), error = null where id = v_row.id;
      return 'applied';
    end if;
    return 'ignored';
  end if;

  if p_event in ('failed', 'bounced') then
    if v_row.status in ('sent', 'sending', 'delivered') then
      update message_outbox set status = 'failed', error = coalesce(v_detail, p_event) where id = v_row.id;
    end if;
    if p_event = 'bounced' and v_row.recipient_user_id is not null and v_row.channel = 'email' then
      perform message_opt_out(v_row.recipient_user_id, 'email', 'provider_bounce');
    end if;
    return case when v_row.status in ('sent', 'sending', 'delivered') then 'applied' else 'ignored' end;
  end if;

  -- complained
  if v_row.status in ('sent', 'sending') then
    update message_outbox set status = 'failed', error = 'spam_complaint' where id = v_row.id;
  else
    update message_outbox set error = 'spam_complaint' where id = v_row.id;
  end if;
  if v_row.recipient_user_id is not null and v_row.channel = 'email' then
    perform message_opt_out(v_row.recipient_user_id, 'email', 'provider_complaint');
  end if;
  return 'applied';
end;
$$;

revoke execute on function message_apply_provider_event(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function message_apply_provider_event(text, text, uuid, text, text) to service_role;

-- Retention: remove personal data from finished messages after 90 days.
create function scrub_message_outbox()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform _message_assert_service('scrub_message_outbox');
  update message_outbox
  set to_address = null, subject = null, body = '[removed]'
  where status in ('sent', 'delivered', 'failed', 'suppressed')
    and created_at < now() - interval '90 days'
    and body <> '[removed]';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function scrub_message_outbox() is
  'Retention job: blanks address/subject/body of finished outbox rows older than 90 days (status, timestamps and counts remain). service_role only; scheduled daily by 0096.';

revoke execute on function scrub_message_outbox() from public, anon, authenticated;
grant execute on function scrub_message_outbox() to service_role;
