-- KiaKia — dispatch offer push notifications: the delivery mechanism 0053
-- explicitly deferred ("actually SENDING an Expo push notification requires
-- an outbound HTTPS call from Postgres (pg_net) or, more realistically, a
-- Supabase Edge Function triggered off rows in the tables this migration
-- creates. ... No pg_net/Edge Function/webhook exists anywhere in this
-- migration."). This implements that second option.
--
-- WHAT THIS DOES: an AFTER INSERT trigger on dispatch_offers calls the
-- `dispatch-push` Edge Function (supabase/functions/dispatch-push/) via
-- pg_net, passing only {order_id, rider_id}. The function itself — not this
-- trigger — reads rider_push_tokens, looks up the vendor name, and calls
-- Expo's push API. Keeping that logic in TypeScript rather than PL/pgSQL is
-- deliberate: it is easier to test, iterate on (batching, stale-token
-- cleanup), and reason about than an equivalent amount of PL/pgSQL calling
-- an HTTP API through pg_net directly.
--
-- Fires once per newly-inserted dispatch_offers row, which means once per
-- rider per offer — correct whether that row came from the original
-- ready_for_pickup dispatch (dispatch_order_to_nearby_riders(), 0019/0023)
-- or the early-dispatch sweep introduced alongside this migration
-- (dispatch_orders_nearing_prep_completion(), 0064): both write to
-- dispatch_offers through the exact same `insert into dispatch_offers
-- (order_id, rider_id) select ...` shape, so this trigger does not need to
-- know or care which one fired. Nothing in 0064 needed to change for this
-- migration to cover it.
--
-- OPERATOR SETUP REQUIRED — cannot be done from this file, because both
-- values are secrets that must never be committed to git:
--
--   1. Deploy the function:
--        supabase functions deploy dispatch-push
--
--   2. Run once, directly against the LIVE project (via `supabase
--      db execute`, the SQL editor, or `psql` — NOT by adding it to a
--      migration file):
--
--        select vault.create_secret(
--          'https://<project-ref>.functions.supabase.co/dispatch-push',
--          'dispatch_push_function_url'
--        );
--        select vault.create_secret(
--          '<this project's service-role key>',
--          'dispatch_push_service_role_key'
--        );
--
--      The second is the function's OWN auth, not a database credential:
--      dispatch-push keeps the platform default `verify_jwt = true` (see
--      supabase/config.toml — it has no override, unlike monnify-webhook),
--      so this trigger must present a valid Supabase JWT to reach it at
--      all, and the service-role key is one. See that function's index.ts
--      header for the full trust-boundary reasoning.
--
-- Until both secrets exist, the trigger below finds no row, logs a
-- `raise warning`, and returns — dispatch itself is NEVER blocked by this
-- being unconfigured, same defensive posture 0023's own dispatch trigger
-- already takes toward its own failures. The in-app realtime subscription
-- and polling fallback (kiakia-rider's useOfferStream) remain the path that
-- actually guarantees delivery; this is additive, not a replacement.

create extension if not exists pg_net;
-- Present by default on every hosted Supabase project; explicit here for
-- the same reason 0001_extensions.sql is explicit about pgcrypto/postgis —
-- so a local/self-hosted `supabase start` does not silently lack it.
create extension if not exists supabase_vault;

create or replace function notify_rider_of_new_offer()
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
      from vault.decrypted_secrets where name = 'dispatch_push_function_url';

    select decrypted_secret into v_service_role_key
      from vault.decrypted_secrets where name = 'dispatch_push_service_role_key';

    if v_function_url is null or v_service_role_key is null then
      raise warning 'notify_rider_of_new_offer: dispatch_push Vault secrets are not configured, skipping push for offer %. See 0065_dispatch_push_notifications.sql''s header for the one-time setup.', new.id;
      return new;
    end if;

    -- Fire-and-forget: net.http_post() queues the request and returns a
    -- request id immediately, so this never makes the surrounding INSERT
    -- (and whichever of 0019/0023's or 0064's dispatch function performed
    -- it) wait on an outbound HTTPS round trip.
    perform net.http_post(
      url := v_function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      body := jsonb_build_object('order_id', new.order_id, 'rider_id', new.rider_id)
    );
  exception when others then
    -- Same posture as dispatch_order_to_nearby_riders() (0023) and
    -- dispatch_orders_nearing_prep_completion() (0064): a failure here must
    -- never roll back the dispatch_offers row that was just inserted. A
    -- rider who is not pushed can still see the offer via realtime/polling.
    raise warning 'notify_rider_of_new_offer: failed for offer % — %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function notify_rider_of_new_offer() is
  'AFTER INSERT trigger on dispatch_offers: calls the dispatch-push Edge Function via pg_net so the rider is woken by a real push notification, in addition to the in-app realtime/polling path. Fires for every dispatch_offers insert regardless of which function created it (0019/0023''s ready_for_pickup dispatch or 0064''s early-dispatch sweep). Requires two Vault secrets set once against the live project — see this migration''s own header — and silently no-ops (raise warning only) until they exist. Exception-wrapped so a failure here can never roll back the insert that fired it.';

create trigger dispatch_offers_notify_rider
  after insert on dispatch_offers
  for each row
  execute function notify_rider_of_new_offer();
