-- Pre-launch emails use the existing message_outbox, Resend worker, retry
-- schedule, provider idempotency keys, and admin audit log.

alter table launch_subscribers
  add column welcome_status text not null default 'not_queued'
    check (welcome_status in ('not_queued', 'queued', 'sending', 'sent', 'failed', 'suppressed')),
  add column welcome_attempts integer not null default 0 check (welcome_attempts >= 0),
  add column welcome_sent_at timestamptz,
  add column launch_status text not null default 'not_queued'
    check (launch_status in ('not_queued', 'queued', 'sending', 'sent', 'failed', 'suppressed')),
  add column launch_attempts integer not null default 0 check (launch_attempts >= 0),
  add column launch_sent_at timestamptz;

create table launch_campaigns (
  id                 uuid primary key default uuid_generate_v7(),
  campaign_key       text not null unique check (campaign_key = 'kia-open-v1'),
  status             text not null default 'queued'
                     check (status in ('queued', 'sending', 'sent', 'partial', 'failed')),
  approved_by        uuid not null references auth.users (id),
  approved_at        timestamptz not null default now(),
  recipient_count    integer not null check (recipient_count > 0),
  pending_count      integer not null check (pending_count >= 0),
  sent_count         integer not null default 0 check (sent_count >= 0),
  failed_count       integer not null default 0 check (failed_count >= 0),
  suppressed_count   integer not null default 0 check (suppressed_count >= 0),
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint launch_campaign_counts_valid
    check (pending_count + sent_count + failed_count + suppressed_count = recipient_count)
);

comment on table launch_campaigns is
  'One-time, explicitly approved public launch announcement. The unique key, superadmin RPC, and audit row prevent duplicate or countdown-triggered campaigns.';

create trigger launch_campaigns_set_updated_at
  before update on launch_campaigns
  for each row execute function set_updated_at();

alter table message_outbox
  add column launch_subscriber_id uuid references launch_subscribers (id) on delete set null,
  add column launch_campaign_id uuid references launch_campaigns (id) on delete set null;

alter table message_outbox drop constraint message_outbox_kind_check;
alter table message_outbox add constraint message_outbox_kind_check
  check (kind in ('broadcast', 'direct', 'rider_offer', 'system', 'launch_welcome', 'launch_announcement'));
alter table message_outbox add constraint message_outbox_launch_link_check
  check (
    (kind in ('launch_welcome', 'launch_announcement')) = (launch_subscriber_id is not null)
    and (kind = 'launch_announcement') = (launch_campaign_id is not null)
    and (kind not in ('launch_welcome', 'launch_announcement') or recipient_user_id is null)
    and (kind <> 'launch_welcome' or category = 'transactional')
    and (kind <> 'launch_announcement' or category = 'promotional')
  );

create index message_outbox_launch_subscriber_idx
  on message_outbox (launch_subscriber_id, kind, created_at desc)
  where launch_subscriber_id is not null;
create index message_outbox_launch_campaign_idx
  on message_outbox (launch_campaign_id, status)
  where launch_campaign_id is not null;

alter table launch_campaigns enable row level security;
revoke all on launch_campaigns from public, anon, authenticated, service_role;

-- The same append-only opt-in events that document consent also give each
-- welcome message a unique idempotency key, including a later re-subscription.
create or replace function subscribe_launch_email(
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
  v_consent_event_id uuid;
  v_existing_consent text;
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
  if p_consent_version is distinct from 'launch-list-v1'
     and p_consent_version is distinct from 'launch-list-v2' then
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
    select id, consent_version into v_subscriber_id, v_existing_consent
    from launch_subscribers where email = v_email for update;
    v_outcome := 'already_subscribed';

    -- A repeat opt-in explicitly accepted the current wording. Upgrade the
    -- consent record once, without sending another welcome message.
    if v_existing_consent is distinct from p_consent_version then
      update launch_subscribers
      set consent_version = p_consent_version, consented_at = now(), updated_at = now()
      where id = v_subscriber_id;
      insert into launch_subscriber_consent_events (subscriber_id, event, consent_version, source)
      values (v_subscriber_id, 'subscribed', p_consent_version, 'homepage_prelaunch');
    end if;
  else
    v_outcome := 'subscribed';
    insert into launch_subscriber_consent_events (subscriber_id, event, consent_version, source)
    values (v_subscriber_id, 'subscribed', p_consent_version, 'homepage_prelaunch')
    returning id into v_consent_event_id;

    insert into message_outbox (
      kind, channel, category, recipient_user_id, to_address, subject, body,
      status, dedupe_key, launch_subscriber_id
    )
    select
      'launch_welcome', 'email', 'transactional', null, s.email,
      'You''re on the list! KiaKia is cooking...',
      'Your KiaKia first-to-know seat is saved. Good food is coming. Fast fast!',
      'queued', 'launch-welcome:' || v_consent_event_id::text, s.id
    from launch_subscribers s
    where s.id = v_subscriber_id and p_consent_version = 'launch-list-v2';
    if p_consent_version = 'launch-list-v2' then
      begin
        perform invoke_message_worker();
      exception when others then
        -- The durable queue and subscriber consent are the source of truth;
        -- the existing scheduled worker will retry if this nudge is offline.
        raise warning 'subscribe_launch_email: worker nudge unavailable for subscriber %', v_subscriber_id;
      end;
    end if;
  end if;

  insert into launch_unsubscribe_tokens (token_hash, subscriber_id)
  values (p_unsubscribe_token_hash, v_subscriber_id);

  return query select v_subscriber_id, v_outcome;
end;
$$;

comment on function subscribe_launch_email(text, text, text, text) is
  'Records a launch-list opt-in and queues one welcome email atomically for a new or reactivated v2 signup. Active duplicate submissions never queue another welcome. Existing v1 consent remains valid for one launch announcement until explicitly upgraded.';

-- At opt-out time, suppress all launch messages that have not reached the
-- provider. The worker also checks active consent immediately before sending.
create function launch_suppress_queued_messages_after_optout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.unsubscribed_at is null and new.unsubscribed_at is not null then
    update message_outbox
    set status = 'suppressed', suppress_reason = 'opted_out'
    where launch_subscriber_id = new.id
      and kind in ('launch_welcome', 'launch_announcement')
      and status = 'queued';
  end if;
  return new;
end;
$$;

revoke all on function launch_suppress_queued_messages_after_optout() from public, anon, authenticated, service_role;
create trigger launch_suppress_queued_messages_after_optout
  after update of unsubscribed_at on launch_subscribers
  for each row execute function launch_suppress_queued_messages_after_optout();

create function launch_track_outbox_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_sent_delta integer := 0;
  v_failed_delta integer := 0;
  v_suppressed_delta integer := 0;
begin
  if new.launch_subscriber_id is null then return new; end if;

  v_status := case
    when new.status in ('sent', 'delivered') then 'sent'
    when new.status = 'sending' then 'sending'
    when new.status = 'failed' then 'failed'
    when new.status = 'suppressed' then 'suppressed'
    else 'queued'
  end;

  if new.kind = 'launch_welcome' then
    update launch_subscribers
    set welcome_status = v_status,
        welcome_attempts = new.attempts,
        welcome_sent_at = case when v_status = 'sent' then coalesce(new.sent_at, now()) else null end,
        updated_at = now()
    where id = new.launch_subscriber_id;
  else
    update launch_subscribers
    set launch_status = v_status,
        launch_attempts = new.attempts,
        launch_sent_at = case when v_status = 'sent' then coalesce(new.sent_at, now()) else null end,
        updated_at = now()
    where id = new.launch_subscriber_id;
  end if;

  if new.launch_campaign_id is not null then
    if tg_op = 'UPDATE' and new.status = 'sending' and old.status = 'queued' then
      update launch_campaigns set status = 'sending'
      where id = new.launch_campaign_id and status = 'queued';
    end if;

    if tg_op = 'UPDATE'
       and old.status in ('queued', 'sending')
       and new.status in ('sent', 'delivered', 'failed', 'suppressed') then
      v_sent_delta := case when new.status in ('sent', 'delivered') then 1 else 0 end;
      v_failed_delta := case when new.status = 'failed' then 1 else 0 end;
      v_suppressed_delta := case when new.status = 'suppressed' then 1 else 0 end;

      update launch_campaigns
      set pending_count = pending_count - 1,
          sent_count = sent_count + v_sent_delta,
          failed_count = failed_count + v_failed_delta,
          suppressed_count = suppressed_count + v_suppressed_delta,
          status = case
            when pending_count - 1 > 0 then 'sending'
            when sent_count + v_sent_delta = recipient_count then 'sent'
            when sent_count + v_sent_delta > 0 then 'partial'
            else 'failed'
          end,
          completed_at = case when pending_count - 1 = 0 then now() else null end
      where id = new.launch_campaign_id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function launch_track_outbox_state() from public, anon, authenticated, service_role;
create trigger launch_track_outbox_state
  after insert or update of status, attempts, sent_at on message_outbox
  for each row execute function launch_track_outbox_state();

-- Extend the worker claim RPC to preserve existing message behavior while
-- suppressing unsubscribed launch contacts and exempting them from the
-- auth-user marketing-preference lookup.
create or replace function message_claim_batch(p_limit integer default 20)
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
    where q.status = 'queued' and q.category = 'promotional'
      and q.kind <> 'launch_announcement' and q.next_attempt_at <= now()
    for update skip locked
  )
  and not exists (
    select 1 from message_preferences mp
    where mp.user_id = o.recipient_user_id
      and case o.channel when 'email' then mp.marketing_email else mp.marketing_sms end
  );

  update message_outbox o
  set status = 'suppressed', suppress_reason = 'opted_out'
  where o.id in (
    select q.id from message_outbox q
    where q.status = 'queued' and q.kind in ('launch_welcome', 'launch_announcement')
      and q.next_attempt_at <= now()
    for update skip locked
  )
  and not exists (
    select 1 from launch_subscribers s
    where s.id = o.launch_subscriber_id and s.unsubscribed_at is null
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
      and (q.kind not in ('launch_welcome', 'launch_announcement') or exists (
        select 1 from launch_subscribers s
        where s.id = q.launch_subscriber_id and s.unsubscribed_at is null
      ))
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
  'Claims due messages with FOR UPDATE SKIP LOCKED, enforcing auth-user promotional consent and launch-list active consent separately. service_role only.';

create function admin_launch_announcement_preview(p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eligible integer;
  v_campaign jsonb;
begin
  perform _assert_admin_actor('admin_launch_announcement_preview', p_actor_id, 'admin');

  select count(*) into v_eligible
  from launch_subscribers
  where unsubscribed_at is null and consent_version in ('launch-list-v1', 'launch-list-v2');

  select jsonb_build_object(
    'id', id,
    'status', status,
    'approved_at', approved_at,
    'recipient_count', recipient_count,
    'pending_count', pending_count,
    'sent_count', sent_count,
    'failed_count', failed_count,
    'suppressed_count', suppressed_count,
    'completed_at', completed_at
  ) into v_campaign
  from launch_campaigns where campaign_key = 'kia-open-v1';

  return jsonb_build_object('eligible_count', v_eligible, 'campaign', v_campaign);
end;
$$;

revoke all on function admin_launch_announcement_preview(uuid) from public, anon, authenticated;
grant execute on function admin_launch_announcement_preview(uuid) to service_role;

create function admin_start_launch_announcement(
  p_actor_id uuid,
  p_confirmation_phrase text,
  p_expected_recipient_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing launch_campaigns;
  v_campaign_id uuid;
  v_eligible integer;
  v_queued integer;
begin
  perform _message_assert_service('admin_start_launch_announcement');
  perform _assert_admin_actor('admin_start_launch_announcement', p_actor_id, 'superadmin');

  if p_confirmation_phrase is distinct from 'ANNOUNCE KIAKIA' then
    raise exception 'admin_start_launch_announcement: confirmation phrase did not match' using errcode = 'check_violation';
  end if;
  if p_expected_recipient_count is null or p_expected_recipient_count < 1 then
    raise exception 'admin_start_launch_announcement: expected recipient count must be positive' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kia-open-v1', 0));

  select * into v_existing from launch_campaigns where campaign_key = 'kia-open-v1';
  if found then
    return jsonb_build_object(
      'outcome', 'already_started',
      'campaign_id', v_existing.id,
      'recipient_count', v_existing.recipient_count,
      'status', v_existing.status
    );
  end if;

  select count(*) into v_eligible
  from launch_subscribers
  where unsubscribed_at is null and consent_version in ('launch-list-v1', 'launch-list-v2');

  if v_eligible = 0 then
    return jsonb_build_object('outcome', 'no_recipients');
  end if;

  if v_eligible <> p_expected_recipient_count then
    return jsonb_build_object('outcome', 'count_changed', 'eligible_count', v_eligible);
  end if;

  insert into launch_campaigns (campaign_key, approved_by, recipient_count, pending_count)
  values ('kia-open-v1', p_actor_id, v_eligible, v_eligible)
  returning id into v_campaign_id;

  insert into message_outbox (
    kind, channel, category, recipient_user_id, to_address, subject, body,
    status, dedupe_key, launch_subscriber_id, launch_campaign_id
  )
  select
    'launch_announcement', 'email', 'promotional', null, s.email,
    'We''re open! KiaKia is serving Lagos',
    'The wait is over. KiaKia is live and ready to serve Lagos.',
    'queued', 'launch-announcement:' || s.id::text, s.id, v_campaign_id
  from launch_subscribers s
  where s.unsubscribed_at is null and s.consent_version in ('launch-list-v1', 'launch-list-v2');
  get diagnostics v_queued = row_count;

  if v_queued <> v_eligible then
    raise exception 'admin_start_launch_announcement: eligible audience changed while queueing' using errcode = 'serialization_failure';
  end if;

  perform _write_admin_audit(
    p_actor_id,
    'launch.announcement_approved',
    'message',
    v_campaign_id,
    null,
    jsonb_build_object(
      'campaign_key', 'kia-open-v1',
      'recipient_count', v_queued,
      'approval_phrase', 'ANNOUNCE KIAKIA'
    )
  );
  begin
    perform invoke_message_worker();
  exception when others then
    raise warning 'admin_start_launch_announcement: worker nudge unavailable for campaign %', v_campaign_id;
  end;

  return jsonb_build_object(
    'outcome', 'started',
    'campaign_id', v_campaign_id,
    'recipient_count', v_queued,
    'status', 'queued'
  );
end;
$$;

comment on function admin_start_launch_announcement(uuid, text, integer) is
  'Queues the one official launch announcement only after a superadmin explicitly confirms the eligible count shown to them. Recipient rows, the campaign record, and audit entry commit together; repeat execution returns the existing campaign.';

revoke all on function admin_start_launch_announcement(uuid, text, integer) from public, anon, authenticated;
grant execute on function admin_start_launch_announcement(uuid, text, integer) to service_role;
