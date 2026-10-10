-- KiaKia - real browser push notifications for customers and vendor staff,
-- covering every order-status update from acceptance through delivery.
--
-- The content and the trigger-on-every-transition mechanism already exist:
-- `notifications` (0038_customer_notifications.sql, generalised to vendors
-- by 0049_vendor_notifications.sql) gets a row inserted, with the right
-- title/body copy already worked out, for every relevant transition_order()
-- call - accepted, preparing, ready_for_pickup, rider_assigned, picked_up,
-- in_transit, arrived, delivered, and the cancellation/rejection edges.
-- What has never existed for the web app is an actual push CHANNEL to
-- deliver that content through when the tab isn't open - riders have this
-- today via Expo (0053/0065); customers and vendor staff have only ever had
-- the in-app bell (NotificationsButton.tsx), which requires the page to
-- already be open.
--
-- Same three-piece shape as 0053/0065 established for riders, adapted for
-- the Web Push standard instead of Expo:
--
--   1. web_push_subscriptions - WHERE to push, not the notification itself.
--      Keyed by user_id (a login, not a role) because a `notifications` row
--      names an AUDIENCE (customer_id or vendor_id, 0049), not a specific
--      user - a vendor_id notification may need to reach every staff
--      member of that vendor, resolved at send time (see the web-push Edge
--      Function's own header). A single browser subscription is meaningful
--      to whichever account was logged in when it was created, so user_id
--      is the right key regardless of which audience a given notification
--      later turns out to belong to.
--
--   2. register_web_push_subscription()/unregister_web_push_subscription()
--      - the only writers, both deriving user_id from auth.uid() the same
--      way register_rider_push_token()/unregister_rider_push_token() (0053)
--      derive rider_id - never accepted as a parameter, so neither can ever
--      touch another user's subscription.
--
--   3. notify_web_push_subscribers() - AFTER INSERT trigger on
--      notifications, calls the web-push Edge Function via pg_net. Same
--      Vault-secrets-optional, exception-wrapped, never-blocks-the-insert
--      posture as notify_rider_of_new_offer() (0065) - dispatch itself (an
--      order's own state transition) can never be slowed or broken by a
--      push failure, and this silently no-ops until an operator completes
--      the one-time Vault setup documented below.
--
-- OPERATOR SETUP REQUIRED - same two-part shape as 0065, plus VAPID keys
-- the web-push function itself needs (its own header covers those):
--
--   1. Deploy the function: supabase functions deploy web-push
--
--   2. Run once, directly against the LIVE project (via `supabase db
--      execute`, the SQL editor, or `psql` - NOT added to a migration
--      file):
--
--        select vault.create_secret(
--          'https://<project-ref>.functions.supabase.co/web-push',
--          'web_push_function_url'
--        );
--        select vault.create_secret(
--          '<this project's service-role key>',
--          'web_push_service_role_key'
--        );
--
-- Until both secrets exist, the trigger below finds no row, logs a
-- `raise warning`, and returns - order transitions are NEVER blocked by
-- this being unconfigured, same defensive posture 0065 already takes.

-- ---------------------------------------------------------------------------
-- web_push_subscriptions
-- ---------------------------------------------------------------------------
--
-- PRIMARY KEY CHOICE - (user_id, endpoint), same reasoning as
-- rider_push_tokens' (rider_id, token): the natural key already is unique
-- (the same browser subscription re-registering for the same user is
-- definitionally the same row, not two), so no surrogate id earns its
-- keep - nothing ever references a subscription row from elsewhere.
--
-- p256dh/auth are the two keys the Web Push standard (RFC 8291) requires to
-- encrypt a payload for this specific subscription - not secrets this
-- project controls, they come from the browser's own PushManager.subscribe()
-- response and are meaningless without the matching VAPID private key the
-- web-push Edge Function holds. `auth` is deliberately named auth_key here.
-- unquoted, it would still work as a column name, but every other reference
-- to "auth" in this schema means the auth.* schema/auth.uid() - a plain
-- `auth` column reads as a name collision waiting to confuse the next
-- migration that greps for one.
create table web_push_subscriptions (
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth_key    text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (user_id, endpoint)
);

comment on table web_push_subscriptions is
  'Web Push subscription registry (RFC 8291) - WHERE to push a browser notification, not the notification itself. Written only by register_web_push_subscription()/unregister_web_push_subscription() (below) - no other authenticated-reachable write path exists, same posture as rider_push_tokens (0053). Read (across all subscribers of a notification''s audience) only by the web-push Edge Function via the service-role key.';

create trigger web_push_subscriptions_set_updated_at
  before update on web_push_subscriptions
  for each row execute function set_updated_at();

create index web_push_subscriptions_user_id_idx on web_push_subscriptions (user_id);

alter table web_push_subscriptions enable row level security;

create policy "user reads own web push subscriptions" on web_push_subscriptions for select
  using (user_id = auth.uid());

revoke insert, update, delete on web_push_subscriptions from authenticated;

-- ---------------------------------------------------------------------------
-- register_web_push_subscription() / unregister_web_push_subscription()
-- ---------------------------------------------------------------------------

create or replace function register_web_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'register_web_push_subscription: no authenticated user';
  end if;

  insert into web_push_subscriptions (user_id, endpoint, p256dh, auth_key)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (user_id, endpoint) do update
    set p256dh = excluded.p256dh,
        auth_key = excluded.auth_key,
        updated_at = now();
end;
$$;

comment on function register_web_push_subscription(text, text, text) is
  'Upserts the caller''s own Web Push subscription (endpoint + the two RFC 8291 keys from PushManager.subscribe()). user_id is always auth.uid() - never accepted as a parameter, so this can never register a subscription for another user.';

revoke execute on function register_web_push_subscription(text, text, text) from public;
grant execute on function register_web_push_subscription(text, text, text) to authenticated;

create or replace function unregister_web_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from web_push_subscriptions
  where user_id = auth.uid() and endpoint = p_endpoint;
end;
$$;

comment on function unregister_web_push_subscription(text) is
  'Removes the caller''s own subscription for one endpoint - e.g. when the browser itself reports the subscription as expired, or the user turns notifications off. Scoped to auth.uid(), same as register_web_push_subscription().';

revoke execute on function unregister_web_push_subscription(text) from public;
grant execute on function unregister_web_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------------
-- notify_web_push_subscribers() - AFTER INSERT trigger on notifications
-- ---------------------------------------------------------------------------

create extension if not exists pg_net;
create extension if not exists supabase_vault;

create or replace function notify_web_push_subscribers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_function_url      text;
  v_service_role_key  text;
begin
  begin
    select decrypted_secret into v_function_url
      from vault.decrypted_secrets where name = 'web_push_function_url';

    select decrypted_secret into v_service_role_key
      from vault.decrypted_secrets where name = 'web_push_service_role_key';

    if v_function_url is null or v_service_role_key is null then
      raise warning 'notify_web_push_subscribers: web-push Vault secrets are not configured, skipping push for notification %. See 0069_web_push_subscriptions.sql''s header for the one-time setup.', new.id;
      return new;
    end if;

    -- Fire-and-forget, same as notify_rider_of_new_offer() (0065): this
    -- must never make the INSERT that created this notification (and
    -- whichever transition_order() call triggered it, several layers up)
    -- wait on an outbound HTTPS round trip.
    perform net.http_post(
      url := v_function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      body := jsonb_build_object('notification_id', new.id)
    );
  exception when others then
    -- Same posture as notify_rider_of_new_offer() (0065): a failure here
    -- must never roll back the notifications row that was just inserted.
    -- The in-app bell (NotificationsButton.tsx) still shows it either way.
    raise warning 'notify_web_push_subscribers: failed for notification % - %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function notify_web_push_subscribers() is
  'AFTER INSERT trigger on notifications: calls the web-push Edge Function via pg_net so a customer or vendor staff member is woken by a real browser push, in addition to the in-app bell. Requires two Vault secrets set once against the live project - see this migration''s own header - and silently no-ops (raise warning only) until they exist. Exception-wrapped so a failure here can never roll back the insert that fired it.';

create trigger notifications_notify_web_push
  after insert on notifications
  for each row
  execute function notify_web_push_subscribers();
