-- KiaKia - admin messaging RPCs (see 0094 for the model and compliance notes).
--
-- All service_role only, SECURITY DEFINER, search_path pinned. Writers take the
-- acting admin as p_actor_id and authorise it with _assert_admin_actor() (0080):
--   transactional broadcast / direct message  -> admin tier
--   promotional broadcast                      -> superadmin tier
-- and write an admin_audit_log row (target_type 'message') in the same
-- transaction.
--
-- admin_audience_preview   read-only counts + sample, no audit.
-- admin_create_broadcast   resolves the audience in THIS transaction, inserts
--                          the broadcast and one outbox row per recipient
--                          (suppressed rows recorded with a reason, never sent).
--                          Guards: promotional needs consent; suspended /
--                          addressless accounts skipped; recipient cap
--                          (message_settings.broadcast_recipient_cap, 5000);
--                          rate limit per rolling 24 h (promotional 5,
--                          transactional 30); a global advisory lock serialises
--                          creation so two concurrent submits cannot both pass
--                          the limit or both insert; an identical request by
--                          the same admin within 10 minutes (or the same
--                          p_idempotency_key, any time) returns the original
--                          broadcast id instead of creating another.
-- admin_send_message       one operational (transactional) message to one user.
-- admin_list_broadcasts / admin_get_broadcast / admin_list_user_messages: reads.
--
-- Status vocabulary in the stats: queued = queued + sending; sent = accepted by
-- the provider, no receipt yet; delivered = receipt received; failed; suppressed.

-- ---------------------------------------------------------------------------
-- admin_audience_preview
-- ---------------------------------------------------------------------------

create function admin_audience_preview(p_audience jsonb, p_channel text, p_category text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_aud    jsonb;
  v_result jsonb;
begin
  perform _message_assert_service('admin_audience_preview');
  if p_channel is null or p_channel not in ('email', 'sms') then
    raise exception 'admin_audience_preview: channel must be email or sms' using errcode = 'check_violation';
  end if;
  if p_category is null or p_category not in ('transactional', 'promotional') then
    raise exception 'admin_audience_preview: category must be transactional or promotional' using errcode = 'check_violation';
  end if;
  v_aud := _message_normalize_audience('admin_audience_preview', p_audience);

  with r as materialized (
    select * from _message_resolve_audience(v_aud, p_channel, p_category)
  )
  select jsonb_build_object(
    'recipient_count', count(*) filter (where suppress_reason is null),
    'suppressed_count', count(*) filter (where suppress_reason is not null),
    'suppressed_reasons', jsonb_build_object(
      'no_address', count(*) filter (where suppress_reason = 'no_address'),
      'no_consent', count(*) filter (where suppress_reason = 'no_consent'),
      'suspended',  count(*) filter (where suppress_reason = 'suspended')),
    'sample', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'display_name', s.display_name, 'role', s.role))
      from (select r2.user_id, r2.display_name, r2.role from r r2
            where r2.suppress_reason is null order by r2.user_id limit 5) s
    ), '[]'::jsonb))
  into v_result
  from r;

  return v_result;
end;
$$;

comment on function admin_audience_preview(jsonb, text, text) is
  'Counts for an audience + channel + category: deliverable recipients, suppressed (with reasons no_address / no_consent / suspended) and up to 5 sample recipients (id, display name, role; never addresses). Read-only. service_role only.';

revoke execute on function admin_audience_preview(jsonb, text, text) from public, anon, authenticated;
grant execute on function admin_audience_preview(jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- admin_create_broadcast
-- ---------------------------------------------------------------------------

create function admin_create_broadcast(
  p_actor_id        uuid,
  p_audience        jsonb,
  p_channel         text,
  p_category        text,
  p_subject         text,
  p_body            text,
  p_reason          text,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aud       jsonb;
  v_reason    text;
  v_subject   text;
  v_body      text;
  v_hash      text;
  v_existing  uuid;
  v_id        uuid;
  v_cap       integer := _message_setting('broadcast_recipient_cap');
  v_limit     integer;
  v_recent    integer;
  v_queued    integer;
  v_suppr     integer;
  v_user_name text;
begin
  perform _assert_admin_actor('admin_create_broadcast', p_actor_id);
  if p_category = 'promotional' then
    perform _assert_admin_actor('admin_create_broadcast', p_actor_id, 'superadmin');
  end if;
  v_reason := _admin_reason('admin_create_broadcast', p_reason, true);

  v_subject := nullif(btrim(coalesce(p_subject, '')), '');
  v_body := btrim(replace(coalesce(p_body, ''), E'\r\n', E'\n'));
  perform _message_check_content('admin_create_broadcast', p_channel, p_category, v_subject, v_body);
  if btrim(_message_render(v_body, 'a', 'b')) = '' then
    raise exception 'admin_create_broadcast: the body is empty once variables are removed' using errcode = 'check_violation';
  end if;
  v_aud := _message_normalize_audience('admin_create_broadcast', p_audience);
  if p_idempotency_key is not null and char_length(p_idempotency_key) not between 1 and 100 then
    raise exception 'admin_create_broadcast: idempotency key must be 1-100 characters' using errcode = 'check_violation';
  end if;
  if p_channel = 'sms' then v_subject := null; end if;

  -- One lock for all broadcast creation: rare, human-driven writes, and it makes
  -- the duplicate check and the rate limit race-free.
  perform pg_advisory_xact_lock(hashtext('admin_create_broadcast'));

  v_hash := md5(concat_ws('|', p_actor_id::text, p_channel, p_category, coalesce(v_subject, ''), v_body, v_aud::text));

  if p_idempotency_key is not null then
    select id into v_existing from message_broadcasts
    where created_by = p_actor_id and idempotency_key = p_idempotency_key;
  else
    select id into v_existing from message_broadcasts
    where created_by = p_actor_id and request_hash = v_hash and created_at > now() - interval '10 minutes'
    order by created_at desc limit 1;
  end if;
  if v_existing is not null then
    return v_existing;
  end if;

  v_limit := _message_setting(case when p_category = 'promotional'
                                   then 'promo_broadcasts_per_day' else 'transactional_broadcasts_per_day' end);
  select count(*) into v_recent from message_broadcasts
  where category = p_category and created_at > now() - interval '24 hours';
  if v_recent >= v_limit then
    raise exception 'admin_create_broadcast: rate limit reached (% % broadcasts in the last 24 hours, limit %)', v_recent, p_category, v_limit
      using errcode = 'check_violation';
  end if;

  if v_aud->>'kind' = 'user' then
    select full_name into v_user_name from profiles where id = (v_aud->>'user_id')::uuid;
  end if;

  insert into message_broadcasts (created_by, channel, category, audience, audience_label, subject, body,
                                  reason, request_hash, idempotency_key)
  values (p_actor_id, p_channel, p_category, v_aud, _message_audience_label(v_aud, v_user_name),
          v_subject, v_body, v_reason, v_hash, p_idempotency_key)
  returning id into v_id;

  insert into message_outbox (broadcast_id, kind, channel, category, recipient_user_id, to_address,
                              subject, body, status, suppress_reason, dedupe_key, created_by)
  select v_id, 'broadcast', p_channel, p_category, r.user_id, r.to_address,
         case when p_channel = 'email' then _message_render(v_subject, r.first_name, r.store_name) end,
         _message_render(v_body, r.first_name, r.store_name),
         case when r.suppress_reason is null then 'queued' else 'suppressed' end,
         r.suppress_reason,
         'bc:' || v_id::text || ':' || r.user_id::text,
         p_actor_id
  from _message_resolve_audience(v_aud, p_channel, p_category) r;

  select count(*) filter (where status = 'queued'), count(*) filter (where status = 'suppressed')
  into v_queued, v_suppr
  from message_outbox where broadcast_id = v_id;

  if v_queued = 0 then
    raise exception 'admin_create_broadcast: no deliverable recipients (% suppressed: suspended, no address or no consent)', v_suppr
      using errcode = 'check_violation';
  end if;
  if v_queued > v_cap then
    raise exception 'admin_create_broadcast: % deliverable recipients exceeds the cap of % per broadcast; narrow the audience', v_queued, v_cap
      using errcode = 'check_violation';
  end if;

  update message_broadcasts set recipient_count = v_queued where id = v_id;

  perform _write_admin_audit(p_actor_id, 'message.broadcast', 'message', v_id, v_reason,
    jsonb_build_object('channel', p_channel, 'category', p_category, 'audience', v_aud,
                       'recipient_count', v_queued, 'suppressed_count', v_suppr, 'subject', v_subject));

  return v_id;
end;
$$;

comment on function admin_create_broadcast(uuid, jsonb, text, text, text, text, text, text) is
  'Creates a broadcast and one outbox row per recipient (audience resolved in this transaction; promotional needs marketing consent, suspended / addressless accounts and missing-consent rows are recorded as suppressed, never sent). Promotional requires a superadmin actor, transactional an admin. Caps: deliverable recipients <= 5000, rate limit per 24 h. A repeat of the same request (same admin, same content+audience within 10 minutes, or same idempotency key) returns the existing id. Returns the broadcast id. Audited (message.broadcast). service_role only.';

revoke execute on function admin_create_broadcast(uuid, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function admin_create_broadcast(uuid, jsonb, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- admin_send_message  (one operational message to one user)
-- ---------------------------------------------------------------------------

create function admin_send_message(
  p_actor_id  uuid,
  p_user_id   uuid,
  p_channel   text,
  p_subject   text,
  p_body      text,
  p_reason    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason  text;
  v_subject text;
  v_body    text;
  v_rec     record;
  v_hash    text;
  v_existing uuid;
  v_recent  integer;
  v_id      uuid;
begin
  perform _assert_admin_actor('admin_send_message', p_actor_id);
  v_reason := _admin_reason('admin_send_message', p_reason, true);
  if p_user_id is null then
    raise exception 'admin_send_message: a recipient is required' using errcode = 'check_violation';
  end if;

  v_subject := nullif(btrim(coalesce(p_subject, '')), '');
  v_body := btrim(replace(coalesce(p_body, ''), E'\r\n', E'\n'));
  perform _message_check_content('admin_send_message', p_channel, 'transactional', v_subject, v_body);
  if btrim(_message_render(v_body, 'a', 'b')) = '' then
    raise exception 'admin_send_message: the body is empty once variables are removed' using errcode = 'check_violation';
  end if;
  if p_channel = 'sms' then v_subject := null; end if;

  select * into v_rec
  from _message_resolve_audience(jsonb_build_object('kind', 'user', 'user_id', p_user_id), p_channel, 'transactional');
  if v_rec.suppress_reason = 'suspended' then
    raise exception 'admin_send_message: the account is suspended; no message was sent' using errcode = 'check_violation';
  elsif v_rec.suppress_reason = 'no_address' then
    raise exception 'admin_send_message: the user has no % on file (a confirmed email / a phone number is required)',
      case when p_channel = 'email' then 'verified email address' else 'phone number' end
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('admin_send_message:' || p_actor_id::text));

  v_hash := md5(concat_ws('|', p_actor_id::text, p_user_id::text, p_channel, coalesce(v_subject, ''), v_body));
  select id into v_existing from message_outbox
  where kind = 'direct' and created_by = p_actor_id and recipient_user_id = p_user_id
    and channel = p_channel and created_at > now() - interval '2 minutes'
    and starts_with(dedupe_key, 'direct:' || v_hash || ':')
  order by created_at desc limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select count(*) into v_recent from message_outbox
  where kind = 'direct' and created_by = p_actor_id and created_at > now() - interval '1 hour';
  if v_recent >= _message_setting('direct_messages_per_actor_hour') then
    raise exception 'admin_send_message: rate limit reached (% direct messages in the last hour)', v_recent
      using errcode = 'check_violation';
  end if;

  -- dedupe_key stays unique per row: hash plus the send timestamp; the 2-minute
  -- repeat window is the lookup above.
  insert into message_outbox (kind, channel, category, recipient_user_id, to_address, subject, body,
                              status, dedupe_key, created_by)
  values ('direct', p_channel, 'transactional', p_user_id, v_rec.to_address,
          case when p_channel = 'email' then _message_render(v_subject, v_rec.first_name, v_rec.store_name) end,
          _message_render(v_body, v_rec.first_name, v_rec.store_name),
          'queued', 'direct:' || v_hash || ':' || (extract(epoch from now())::bigint)::text, p_actor_id)
  returning id into v_id;

  perform _write_admin_audit(p_actor_id, 'message.send', 'message', v_id, v_reason,
    jsonb_build_object('user_id', p_user_id, 'channel', p_channel, 'subject', v_subject));

  return v_id;
end;
$$;

comment on function admin_send_message(uuid, uuid, text, text, text, text) is
  'Queues one operational (transactional) email/SMS to one user. Refuses suspended accounts and users without a confirmed email / phone. An identical message by the same admin to the same user within 2 minutes returns the original id. Audited (message.send). service_role only, admin tier.';

revoke execute on function admin_send_message(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function admin_send_message(uuid, uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

create function admin_list_broadcasts(p_limit integer default 25, p_offset integer default 0)
returns table (
  id               uuid,
  created_at       timestamptz,
  created_by_name  text,
  channel          text,
  category         text,
  audience_label   text,
  subject          text,
  body             text,
  recipient_count  integer,
  queued           bigint,
  sent             bigint,
  delivered        bigint,
  failed           bigint,
  suppressed       bigint,
  total_count      bigint
)
language plpgsql
stable
security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  perform _message_assert_service('admin_list_broadcasts');
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    raise exception 'admin_list_broadcasts: limit must be 1-200 and offset non-negative' using errcode = 'check_violation';
  end if;

  return query
  with page as (
    select b.id, b.created_at, b.created_by, b.channel, b.category, b.audience_label, b.subject, b.body,
           b.recipient_count, count(*) over () as total_count
    from message_broadcasts b
    order by b.created_at desc, b.id desc
    limit p_limit offset p_offset
  )
  select pg.id, pg.created_at,
         coalesce(nullif(btrim(pr.full_name), ''), 'Admin'),
         pg.channel, pg.category, pg.audience_label, pg.subject, pg.body, pg.recipient_count,
         c.queued, c.sent, c.delivered, c.failed, c.suppressed,
         pg.total_count
  from page pg
  left join profiles pr on pr.id = pg.created_by
  left join lateral (
    select count(*) filter (where o.status in ('queued', 'sending')) as queued,
           count(*) filter (where o.status = 'sent') as sent,
           count(*) filter (where o.status = 'delivered') as delivered,
           count(*) filter (where o.status = 'failed') as failed,
           count(*) filter (where o.status = 'suppressed') as suppressed
    from message_outbox o where o.broadcast_id = pg.id
  ) c on true
  order by pg.created_at desc, pg.id desc;
end;
$$;

comment on function admin_list_broadcasts(integer, integer) is
  'Broadcast history, newest first, with per-status counts (queued includes sending) and total_count on every row. service_role only.';

revoke execute on function admin_list_broadcasts(integer, integer) from public, anon, authenticated;
grant execute on function admin_list_broadcasts(integer, integer) to service_role;

create function admin_get_broadcast(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_b message_broadcasts;
  v_result jsonb;
begin
  perform _message_assert_service('admin_get_broadcast');
  select * into v_b from message_broadcasts where id = p_id;
  if not found then
    raise exception 'admin_get_broadcast: broadcast % does not exist', p_id using errcode = 'no_data_found';
  end if;

  select jsonb_build_object(
    'id', v_b.id,
    'created_at', v_b.created_at,
    'created_by', v_b.created_by,
    'created_by_name', coalesce((select nullif(btrim(full_name), '') from profiles where id = v_b.created_by), 'Admin'),
    'channel', v_b.channel,
    'category', v_b.category,
    'audience', v_b.audience,
    'audience_label', v_b.audience_label,
    'subject', v_b.subject,
    'body', v_b.body,
    'reason', v_b.reason,
    'recipient_count', v_b.recipient_count,
    'counts', jsonb_build_object(
      'queued', count(*) filter (where o.status in ('queued', 'sending')),
      'sent', count(*) filter (where o.status = 'sent'),
      'delivered', count(*) filter (where o.status = 'delivered'),
      'failed', count(*) filter (where o.status = 'failed'),
      'suppressed', count(*) filter (where o.status = 'suppressed'),
      'suppressed_reasons', jsonb_build_object(
        'no_address', count(*) filter (where o.suppress_reason = 'no_address'),
        'no_consent', count(*) filter (where o.suppress_reason in ('no_consent', 'opted_out')),
        'suspended', count(*) filter (where o.suppress_reason = 'suspended'))),
    'failures', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', f.recipient_user_id, 'display_name', f.display_name,
                                          'error', f.error, 'attempts', f.attempts))
      from (
        select o2.recipient_user_id, o2.error, o2.attempts,
               coalesce(nullif(btrim(p.full_name), ''), 'Unnamed') as display_name
        from message_outbox o2
        left join profiles p on p.id = o2.recipient_user_id
        where o2.broadcast_id = p_id and o2.status = 'failed'
        order by o2.created_at desc, o2.id desc
        limit 20
      ) f
    ), '[]'::jsonb))
  into v_result
  from message_outbox o
  where o.broadcast_id = p_id;

  return v_result;
end;
$$;

comment on function admin_get_broadcast(uuid) is
  'One broadcast: template, audience, reason, per-status counts, suppressed reasons and up to 20 failure samples (recipient display name, provider error). Addresses are never returned. service_role only.';

revoke execute on function admin_get_broadcast(uuid) from public, anon, authenticated;
grant execute on function admin_get_broadcast(uuid) to service_role;

create function admin_list_user_messages(p_user_id uuid, p_limit integer default 20)
returns table (
  id               uuid,
  created_at       timestamptz,
  channel          text,
  category         text,
  kind             text,
  subject          text,
  body             text,
  status           text,
  suppress_reason  text,
  error            text,
  sent_at          timestamptz,
  delivered_at     timestamptz,
  broadcast_id     uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform _message_assert_service('admin_list_user_messages');
  if p_user_id is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'admin_list_user_messages: a user and a limit of 1-100 are required' using errcode = 'check_violation';
  end if;
  return query
  select o.id, o.created_at, o.channel, o.category, o.kind, o.subject, o.body, o.status,
         o.suppress_reason, o.error, o.sent_at, o.delivered_at, o.broadcast_id
  from message_outbox o
  where o.recipient_user_id = p_user_id
  order by o.created_at desc, o.id desc
  limit p_limit;
end;
$$;

comment on function admin_list_user_messages(uuid, integer) is
  'Most recent messages (all kinds, including suppressed) addressed to one user, newest first. service_role only.';

revoke execute on function admin_list_user_messages(uuid, integer) from public, anon, authenticated;
grant execute on function admin_list_user_messages(uuid, integer) to service_role;
