-- KiaKia - behavioural signals for the Phase 1 "recommended for you" engine.
--
-- Most of what the recommender needs ALREADY exists and is deliberately NOT
-- copied into this table: what a customer ordered (orders/order_items), how
-- they rated it (order_ratings, 0073), and their price range (order_items'
-- unit_price_kobo). The only signals with no existing home are the things a
-- customer does BEFORE ordering - looked at a vendor, looked at a dish,
-- searched, added to / removed from the cart, tapped a recommendation. This
-- table stores exactly those, and nothing else.
--
-- ---------------------------------------------------------------------------
-- DATA MINIMISATION (a requirement, not a nicety)
-- ---------------------------------------------------------------------------
-- No free-form meta jsonb, no IP, no user-agent, no coordinates, no session
-- id. Four typed columns of reference data plus a timestamp. A search query
-- is stored normalised (trimmed, lower-cased, whitespace-collapsed, <= 80
-- chars) because it is the one free-text field and the recommender only ever
-- substring-matches it against dish/vendor names. Rows cascade away with the
-- customer (auth.users) and with the vendor/menu item they reference.
--
-- ---------------------------------------------------------------------------
-- WRITE PATHS (append-only, no client write path at all)
-- ---------------------------------------------------------------------------
--  * log_customer_event() - SECURITY DEFINER RPC for view_vendor, view_item,
--    search, recommendation_click. customer_id is ALWAYS auth.uid(); it is
--    not a parameter, so no caller can write an event as someone else.
--  * AFTER INSERT/DELETE triggers on cart_items - the ONLY way cart_add /
--    cart_remove rows are produced. The RPC refuses those two types, so a
--    client cannot call the RPC to forge them.
--    CAVEAT - cart events are CLIENT-CONTROLLED. cart_items has an
--    owner-scoped "for all" RLS policy (0007), so a customer can insert/delete
--    their OWN cart lines directly and every such write fires the trigger. The
--    trigger proves "a cart write happened", NOT "this is genuine purchase
--    intent": a script can mint cart_add/cart_remove rows for itself (bounded
--    by the 300/hour cap, the 5-minute cart_add dedupe and the 50-lines-per-
--    cart cap below). That is fine for the customer's OWN recommendations (the
--    only consumer in Phase 1), but cart events MUST NOT feed any cross-
--    customer aggregate (popularity, "customers also added", trending) in
--    Phase 2 - one account could steer rankings for everyone. Cross-customer
--    signals must come from server-validated facts (paid orders, ratings).
--  * No UPDATE/DELETE for anyone but the service role (events are history).
--
-- RETENTION (NDPA data minimisation): purge_customer_events() deletes events
-- older than 180 days (30 for search, the one free-text field). It is
-- service_role-only and NOT scheduled here - see its comment. A user's events
-- are also erased when their profile is marked 'deleted' (trigger at the end)
-- and cascade away with auth.users.
--
-- The customer can read their own rows (RLS), which is what lets the home
-- page's recommender run on the user-scoped Supabase client with no admin
-- client in the loop: the privacy design is "only your own rows + the public
-- catalogue are ever read".

create table customer_events (
  id            uuid primary key default uuid_generate_v7(),
  customer_id   uuid not null references auth.users (id) on delete cascade,
  event_type    text not null check (event_type in (
                  'view_vendor', 'view_item', 'search',
                  'cart_add', 'cart_remove', 'recommendation_click'
                )),
  vendor_id     uuid references vendors (id) on delete cascade,
  menu_item_id  uuid references menu_items (id) on delete cascade,
  search_query  text check (search_query is null or char_length(search_query) <= 80),
  created_at    timestamptz not null default now(),

  -- Per-type shape: each event type must carry the reference it is about,
  -- so a row is never an unattributable blob. search_query is only ever
  -- meaningful on a 'search' event.
  constraint customer_events_shape check (
    case event_type
      when 'search'      then search_query is not null and char_length(search_query) > 0
      when 'view_vendor' then vendor_id is not null
      else                    menu_item_id is not null
    end
  ),
  constraint customer_events_query_only_on_search check (
    event_type = 'search' or search_query is null
  )
);

comment on table customer_events is
  'Append-only behavioural signals (view_vendor, view_item, search, cart_add, cart_remove, recommendation_click) feeding the home-page recommender. Written only by log_customer_event() (view/search/click) and the cart_items triggers (cart_add/cart_remove); customers can read only their own rows. Deliberately no meta/IP/user-agent/location columns - data minimisation.';

create index customer_events_customer_created_idx
  on customer_events (customer_id, created_at desc);

alter table customer_events enable row level security;

create policy "customer reads own events" on customer_events for select
  using (customer_id = auth.uid());

-- 0034 re-established default privileges that grant anon + authenticated
-- full CRUD on every new public table, so the walls must be explicit.
revoke all on customer_events from anon, authenticated;
grant select on customer_events to authenticated;

-- ---------------------------------------------------------------------------
-- log_customer_event()
-- ---------------------------------------------------------------------------

create or replace function log_customer_event(
  p_event_type    text,
  p_vendor_id     uuid default null,
  p_menu_item_id  uuid default null,
  p_search_query  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer  uuid := auth.uid();
  v_vendor    uuid;
  v_item      uuid;
  v_query     text;
begin
  if v_customer is null then
    raise exception 'log_customer_event: no authenticated caller';
  end if;

  -- A suspended/deleted account's still-valid token must not keep writing (0082).
  perform _assert_active_caller();

  -- cart_add / cart_remove are trigger-only (see header): a client must not
  -- be able to forge them.
  if p_event_type is null
     or p_event_type not in ('view_vendor', 'view_item', 'search', 'recommendation_click') then
    raise exception 'log_customer_event: event type % is not loggable by a client', p_event_type
      using errcode = 'check_violation';
  end if;

  -- Cheap abuse ceiling: past 300 events in the last hour, silently drop.
  -- Silent (not an error) because this is analytics - it must never surface
  -- as a failure in the UI.
  if (select count(*) from customer_events
      where customer_id = v_customer
        and created_at > now() - interval '1 hour') >= 300 then
    return;
  end if;

  if p_event_type = 'search' then
    -- Only the normalised query is kept; any vendor/item ids are ignored.
    v_query := left(btrim(regexp_replace(lower(coalesce(p_search_query, '')), '\s+', ' ', 'g')), 80);
    -- left() can leave trailing whitespace from the cut; trim again.
    v_query := btrim(v_query);
    if v_query = '' then
      return;
    end if;

  elsif p_event_type = 'view_vendor' then
    if p_vendor_id is null then
      raise exception 'log_customer_event: view_vendor requires a vendor id'
        using errcode = 'check_violation';
    end if;
    select v.id into v_vendor from vendors v
    where v.id = p_vendor_id and v.status = 'active';
    if v_vendor is null then
      raise exception 'log_customer_event: vendor % is not active', p_vendor_id
        using errcode = 'check_violation';
    end if;

  else
    -- view_item / recommendation_click: the vendor is DERIVED from the menu
    -- item and any client-supplied vendor id is ignored, so a mismatching
    -- (item, vendor) pair can never be recorded.
    if p_menu_item_id is null then
      raise exception 'log_customer_event: % requires a menu item id', p_event_type
        using errcode = 'check_violation';
    end if;
    select mi.id, mi.vendor_id into v_item, v_vendor
    from menu_items mi
    join vendors v on v.id = mi.vendor_id
    where mi.id = p_menu_item_id and v.status = 'active';
    if v_item is null then
      raise exception 'log_customer_event: menu item % does not belong to an active vendor', p_menu_item_id
        using errcode = 'check_violation';
    end if;
  end if;

  -- Dedupe: an identical event inside the last 5 minutes is a refresh /
  -- double-tap, not new intent.
  if exists (
    select 1 from customer_events e
    where e.customer_id = v_customer
      and e.event_type = p_event_type
      and e.vendor_id is not distinct from v_vendor
      and e.menu_item_id is not distinct from v_item
      and e.search_query is not distinct from v_query
      and e.created_at > now() - interval '5 minutes'
  ) then
    return;
  end if;

  insert into customer_events (customer_id, event_type, vendor_id, menu_item_id, search_query)
  values (v_customer, p_event_type, v_vendor, v_item, v_query);
end;
$$;

comment on function log_customer_event(text, uuid, uuid, text) is
  'Client-callable event logger for view_vendor / view_item / search / recommendation_click. customer_id is always auth.uid() (not a parameter). Rejects cart_* types (trigger-only), inactive vendors and items of inactive vendors; derives vendor_id from the menu item; normalises search text; no-ops on a 5-minute duplicate or once the caller has 300+ events in the last hour.';

revoke execute on function log_customer_event(text, uuid, uuid, text) from public, anon;
grant execute on function log_customer_event(text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- cart_items -> customer_events triggers
-- ---------------------------------------------------------------------------
-- pg_trigger_depth() > 1 means this fired as a side effect of another
-- trigger/cascade - the cart row was deleted because its cart or its menu
-- item was (0048's ON DELETE CASCADE, or a cart being removed), not because
-- the customer removed the item. Those must not fabricate cart_remove
-- signals. A direct client DELETE/INSERT runs the trigger at depth 1.
--
-- The analytics write is wrapped in an exception handler narrowed to
-- data/constraint-class errors: analytics must not be able to make a cart
-- write fail, but a failure is surfaced as a WARNING in the Postgres log
-- (never silently swallowed), and non-data errors (cancellation, OOM,
-- deadlock) are not masked.
--
-- Abuse bounds (the cart is client-writable, see the header): the same
-- 300-events/hour ceiling as log_customer_event, a 5-minute dedupe on
-- identical cart_add events, and a 50-line cap per cart (cart_items_cap).

create or replace function log_cart_item_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       cart_items;
  v_customer  uuid;
  v_vendor    uuid;
  v_type      text;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  begin
    v_row := case tg_op when 'DELETE' then old else new end;
    v_type := case tg_op when 'DELETE' then 'cart_remove' else 'cart_add' end;

    select c.customer_id into v_customer from carts c where c.id = v_row.cart_id;
    select mi.vendor_id into v_vendor from menu_items mi where mi.id = v_row.menu_item_id;

    if v_customer is not null and v_vendor is not null
       -- same abuse ceiling as log_customer_event
       and (select count(*) from customer_events e
            where e.customer_id = v_customer
              and e.created_at > now() - interval '1 hour') < 300
       -- a repeated identical cart_add inside 5 minutes is noise
       and not (v_type = 'cart_add' and exists (
         select 1 from customer_events e
         where e.customer_id = v_customer
           and e.event_type = 'cart_add'
           and e.menu_item_id = v_row.menu_item_id
           and e.created_at > now() - interval '5 minutes'))
    then
      insert into customer_events (customer_id, event_type, vendor_id, menu_item_id)
      values (v_customer, v_type, v_vendor, v_row.menu_item_id);
    end if;
  exception
    when check_violation or foreign_key_violation or not_null_violation
      or unique_violation or data_exception or insufficient_privilege
      or undefined_table or undefined_column then
    -- Never let analytics break the cart, but never hide the failure either.
    raise warning 'log_cart_item_event failed: % (%)', sqlerrm, sqlstate;
  end;

  return null;
end;
$$;

comment on function log_cart_item_event() is
  'AFTER INSERT/DELETE trigger body on cart_items: records cart_add / cart_remove for the cart''s owner. Skipped when nested (pg_trigger_depth() > 1, i.e. FK cascades), past 300 events/hour, or for a cart_add duplicated within 5 minutes. Data/constraint-class failures are downgraded to a WARNING so analytics cannot break the cart. Cart events are client-controlled: never aggregate them across customers.';

revoke execute on function log_cart_item_event() from public, anon, authenticated;

create trigger cart_items_log_add
  after insert on cart_items
  for each row execute function log_cart_item_event();

create trigger cart_items_log_remove
  after delete on cart_items
  for each row execute function log_cart_item_event();

-- ---------------------------------------------------------------------------
-- Per-cart line cap
-- ---------------------------------------------------------------------------
-- A cart is client-writable, so without a bound one account could grow a cart
-- (and the trigger work above) without limit. 50 distinct lines is far past
-- any real order. BEFORE INSERT, SECURITY INVOKER: the owner sees their own
-- cart under RLS, which is all the count needs. Not race-proof under
-- concurrent inserts (can overshoot by a few) - a soft bound, not an invariant.

create or replace function enforce_cart_item_cap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from cart_items ci where ci.cart_id = new.cart_id) >= 50 then
    raise exception 'A cart can hold at most 50 items'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function enforce_cart_item_cap() is
  'BEFORE INSERT on cart_items: rejects the 51st line in a cart (check_violation). Soft bound against abuse.';

revoke execute on function enforce_cart_item_cap() from public, anon;
grant execute on function enforce_cart_item_cap() to authenticated, service_role;

create trigger cart_items_cap
  before insert on cart_items
  for each row execute function enforce_cart_item_cap();

-- ---------------------------------------------------------------------------
-- Retention (NDPA data minimisation)
-- ---------------------------------------------------------------------------
-- 180 days for everything (matches lookbackDays in recommendation-config.ts -
-- older events are never read), 30 days for search (the one free-text field).
-- pg_cron is not enabled in this repo (0055 documents the same situation for
-- its sweep), so this is a service_role-only function and the schedule is an
-- operator step. With pg_cron enabled, run once:
--
--   select cron.schedule('purge-customer-events', '17 3 * * *',
--     $job$ select public.purge_customer_events() $job$);
--
-- (see 0055's header for the SET ROLE caveat on cron jobs). Without pg_cron,
-- call it daily from any scheduler holding the service-role key
-- (supabase.rpc('purge_customer_events')). Returns the number of rows deleted.

create or replace function purge_customer_events()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from customer_events
  where created_at < now() - interval '180 days'
     or (event_type = 'search' and created_at < now() - interval '30 days');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function purge_customer_events() is
  'Retention purge: deletes customer_events older than 180 days (search events: 30 days). service_role only; NOT scheduled by 0084 - see the migration comment for the pg_cron statement or call it from an external scheduler.';

revoke execute on function purge_customer_events() from public, anon, authenticated;
grant execute on function purge_customer_events() to service_role;

-- Erase a user's events when their profile is marked deleted. A trigger on
-- profiles rather than a branch in admin_set_user_status(): that function has
-- no path that SETS 'deleted' (it only refuses to reinstate one), so a trigger
-- covers every present and future route to status = 'deleted' and leaves the
-- 0082 definition untouched. A hard auth.users delete cascades on its own.

create or replace function erase_customer_events_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from customer_events where customer_id = new.id;
  return null;
end;
$$;

comment on function erase_customer_events_on_delete() is
  'AFTER UPDATE OF status trigger on profiles: when status becomes ''deleted'', deletes that user''s customer_events (data minimisation / erasure).';

revoke execute on function erase_customer_events_on_delete() from public, anon, authenticated;

create trigger profiles_erase_customer_events
  after update of status on profiles
  for each row
  when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function erase_customer_events_on_delete();
