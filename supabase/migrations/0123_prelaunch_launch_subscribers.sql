-- Public pre-launch email list. Raw subscriber data is never readable from
-- anon/authenticated clients; public writes go through the server action's
-- service-role RPC, with explicit consent and a server-generated rate key.

create table launch_subscribers (
  id               uuid primary key default uuid_generate_v7(),
  email            text not null unique
                   check (email = lower(btrim(email)) and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  consented_at     timestamptz not null default now(),
  consent_version  text not null,
  source           text not null default 'homepage_prelaunch' check (source = 'homepage_prelaunch'),
  unsubscribed_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table launch_subscribers is
  'Private opt-in list for KiaKia launch announcements. Email is stored only for that purpose; opt-outs are retained as a suppression record.';

create index launch_subscribers_active_consented_idx
  on launch_subscribers (consented_at desc, id)
  where unsubscribed_at is null;

create trigger launch_subscribers_set_updated_at
  before update on launch_subscribers
  for each row execute function set_updated_at();

create table launch_subscriber_consent_events (
  id               uuid primary key default uuid_generate_v7(),
  subscriber_id    uuid not null references launch_subscribers (id) on delete cascade,
  event            text not null check (event in ('subscribed', 'unsubscribed')),
  consent_version  text not null,
  source           text not null check (source in ('homepage_prelaunch', 'unsubscribe_link')),
  created_at       timestamptz not null default now()
);

comment on table launch_subscriber_consent_events is
  'Append-only evidence of launch-list opt-in and withdrawal.';

create index launch_subscriber_consent_events_subscriber_idx
  on launch_subscriber_consent_events (subscriber_id, created_at desc);

create table launch_signup_rate_limits (
  rate_key          text primary key check (rate_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts          integer not null check (attempts > 0),
  last_attempt_at   timestamptz not null default now()
);

comment on table launch_signup_rate_limits is
  'Short-lived HMAC fingerprints and signup attempt counts; raw client IP addresses are never stored.';

create table launch_unsubscribe_tokens (
  token_hash     text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  subscriber_id  uuid not null references launch_subscribers (id) on delete cascade,
  issued_at      timestamptz not null default now(),
  used_at        timestamptz
);

create index launch_unsubscribe_tokens_subscriber_idx
  on launch_unsubscribe_tokens (subscriber_id)
  where used_at is null;

alter table launch_subscribers enable row level security;
alter table launch_subscriber_consent_events enable row level security;
alter table launch_signup_rate_limits enable row level security;
alter table launch_unsubscribe_tokens enable row level security;

revoke all on launch_subscribers, launch_subscriber_consent_events,
  launch_signup_rate_limits, launch_unsubscribe_tokens
  from public, anon, authenticated, service_role;
-- The app reads active contacts directly for the authenticated admin list and
-- export. All writes and all token/rate-limit access stay inside the RPCs.
grant select on launch_subscribers to service_role;

create function subscribe_launch_email(
  p_email text,
  p_rate_key text,
  p_consent_version text,
  p_unsubscribe_token_hash text
)
returns table (subscriber_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_attempts integer;
  v_subscriber_id uuid;
  v_outcome text;
begin
  perform _message_assert_service('subscribe_launch_email');

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
     or length(v_email) > 254 then
    raise exception 'subscribe_launch_email: invalid email address' using errcode = 'check_violation';
  end if;
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then
    raise exception 'subscribe_launch_email: invalid rate key' using errcode = 'check_violation';
  end if;
  if p_consent_version is distinct from 'launch-list-v1' then
    raise exception 'subscribe_launch_email: unknown consent text version' using errcode = 'check_violation';
  end if;
  if p_unsubscribe_token_hash is null or p_unsubscribe_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'subscribe_launch_email: invalid unsubscribe token hash' using errcode = 'check_violation';
  end if;

  insert into launch_signup_rate_limits (rate_key, window_started_at, attempts, last_attempt_at)
  values (p_rate_key, now(), 1, now())
  on conflict (rate_key) do update
    set attempts = case
          when launch_signup_rate_limits.window_started_at < now() - interval '1 hour' then 1
          else launch_signup_rate_limits.attempts + 1
        end,
        window_started_at = case
          when launch_signup_rate_limits.window_started_at < now() - interval '1 hour' then now()
          else launch_signup_rate_limits.window_started_at
        end,
        last_attempt_at = now()
  returning attempts into v_attempts;

  -- Keep this small table bounded without introducing a new cron dependency.
  if random() < 0.01 then
    delete from launch_signup_rate_limits where last_attempt_at < now() - interval '7 days';
  end if;

  if v_attempts > 12 then
    return query select null::uuid, 'rate_limited'::text;
    return;
  end if;

  insert into launch_subscribers (email, consented_at, consent_version, source, unsubscribed_at)
  values (v_email, now(), p_consent_version, 'homepage_prelaunch', null)
  on conflict (email) do update
    set consented_at = now(),
        consent_version = excluded.consent_version,
        source = excluded.source,
        unsubscribed_at = null,
        updated_at = now()
    where launch_subscribers.unsubscribed_at is not null
  returning id into v_subscriber_id;

  if v_subscriber_id is null then
    select id into v_subscriber_id from launch_subscribers where email = v_email;
    v_outcome := 'already_subscribed';
  else
    v_outcome := 'subscribed';
    insert into launch_subscriber_consent_events (subscriber_id, event, consent_version, source)
    values (v_subscriber_id, 'subscribed', p_consent_version, 'homepage_prelaunch');
  end if;

  -- Store only the hash; the raw token is shown once in the response and is
  -- required to withdraw consent or to include an opt-out URL in an export.
  insert into launch_unsubscribe_tokens (token_hash, subscriber_id)
  values (p_unsubscribe_token_hash, v_subscriber_id);

  return query select v_subscriber_id, v_outcome;
end;
$$;

comment on function subscribe_launch_email(text, text, text, text) is
  'Service-role-only public signup. Normalizes email, applies a 12-attempt/hour HMAC rate limit, records consent, deduplicates active addresses, reactivates only after a new explicit opt-in, and stores only an unsubscribe-token hash.';

revoke all on function subscribe_launch_email(text, text, text, text) from public, anon, authenticated;
grant execute on function subscribe_launch_email(text, text, text, text) to service_role;

create function issue_launch_unsubscribe_tokens(p_tokens jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_count integer := 0;
  v_rows integer;
begin
  perform _message_assert_service('issue_launch_unsubscribe_tokens');
  if jsonb_typeof(p_tokens) is distinct from 'array' or jsonb_array_length(p_tokens) > 1000 then
    raise exception 'issue_launch_unsubscribe_tokens: expected at most 1000 tokens' using errcode = 'check_violation';
  end if;

  for v_entry in
    select * from jsonb_to_recordset(p_tokens) as x(subscriber_id uuid, token_hash text)
  loop
    if v_entry.subscriber_id is null or v_entry.token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'issue_launch_unsubscribe_tokens: invalid token entry' using errcode = 'check_violation';
    end if;
    insert into launch_unsubscribe_tokens (token_hash, subscriber_id)
    select v_entry.token_hash, s.id
    from launch_subscribers s
    where s.id = v_entry.subscriber_id and s.unsubscribed_at is null
    on conflict (token_hash) do nothing;
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end loop;

  return v_count;
end;
$$;

comment on function issue_launch_unsubscribe_tokens(jsonb) is
  'Stores hashes of newly issued high-entropy unsubscribe tokens for currently active launch subscribers. service_role only.';

revoke all on function issue_launch_unsubscribe_tokens(jsonb) from public, anon, authenticated;
grant execute on function issue_launch_unsubscribe_tokens(jsonb) to service_role;

create function validate_launch_unsubscribe_token(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _message_assert_service('validate_launch_unsubscribe_token');
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  return exists (
    select 1
    from launch_unsubscribe_tokens t
    join launch_subscribers s on s.id = t.subscriber_id
    where t.token_hash = p_token_hash
      and t.used_at is null
      and s.unsubscribed_at is null
  );
end;
$$;

revoke all on function validate_launch_unsubscribe_token(text) from public, anon, authenticated;
grant execute on function validate_launch_unsubscribe_token(text) to service_role;

create function unsubscribe_launch_email(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscriber_id uuid;
  v_changed boolean := false;
begin
  perform _message_assert_service('unsubscribe_launch_email');
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select subscriber_id into v_subscriber_id
  from launch_unsubscribe_tokens
  where token_hash = p_token_hash and used_at is null
  for update;
  if not found then
    return false;
  end if;

  update launch_subscribers
  set unsubscribed_at = now(), updated_at = now()
  where id = v_subscriber_id and unsubscribed_at is null;
  v_changed := found;

  if v_changed then
    insert into launch_subscriber_consent_events (subscriber_id, event, consent_version, source)
    select id, 'unsubscribed', consent_version, 'unsubscribe_link'
    from launch_subscribers where id = v_subscriber_id;
  end if;

  update launch_unsubscribe_tokens
  set used_at = now()
  where subscriber_id = v_subscriber_id and used_at is null;

  return true;
end;
$$;

comment on function unsubscribe_launch_email(text) is
  'Withdraws launch-announcement consent using a one-time high-entropy token. A GET never calls this function; the public page requires an explicit confirmation POST. service_role only.';

revoke all on function unsubscribe_launch_email(text) from public, anon, authenticated;
grant execute on function unsubscribe_launch_email(text) to service_role;
