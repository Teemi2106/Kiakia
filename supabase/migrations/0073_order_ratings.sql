-- KiaKia - a customer can watch a live map and see status updates for the
-- whole trip, but has never had any way to actually rate the vendor or the
-- rider afterward - vendors.rating_avg/rating_count (0003_catalog.sql) have
-- sat unwritten since the very first migration, and riders has no rating
-- columns at all. Product decision: once an order reaches `delivered`, the
-- customer gets a one-time prompt (apps/web's DeliveredPage, same commit)
-- to rate the vendor (required) and the rider (optional - an order can in
-- principle have no assigned rider, and a customer may simply not want to).
--
-- ---------------------------------------------------------------------------
-- order_ratings
-- ---------------------------------------------------------------------------
--
-- PRIMARY KEY CHOICE - order_id itself, not a surrogate id: exactly one
-- rating per order is the whole point (a customer rates a delivery once,
-- not repeatedly), so the natural key already is the identity - same
-- reasoning as rider_push_tokens' (rider_id, token) (0053).
--
-- vendor_id/rider_id are denormalized off orders at submit time rather than
-- joined through order_id on every read - this table is exactly the kind
-- of thing a future "vendor's rating breakdown" or "rider's rating history"
-- screen would query directly by vendor_id/rider_id, and copying two uuids
-- once is cheaper than requiring every such read to join orders at all.
-- rider_id is nullable (an order can reach delivered with no rider in
-- principle, however unlikely); vendor_id is not (every order has one).
create table order_ratings (
  order_id        uuid primary key references orders (id),
  customer_id     uuid not null references auth.users (id),
  vendor_id       uuid not null references vendors (id),
  rider_id        uuid references auth.users (id),
  vendor_rating   smallint not null check (vendor_rating between 1 and 5),
  vendor_comment  text,
  rider_rating    smallint check (rider_rating between 1 and 5),
  rider_comment   text,
  created_at      timestamptz not null default now()
);

comment on table order_ratings is
  'One row per delivered order, written only by submit_order_rating() (below) - no authenticated-reachable insert/update/delete path exists, same posture as dispatch_offers/order_delivery_codes. vendor_rating is required; rider_rating/rider_comment are null when the customer skips rating the rider (or the order genuinely had none).';

create index order_ratings_vendor_id_idx on order_ratings (vendor_id);
create index order_ratings_rider_id_idx on order_ratings (rider_id) where rider_id is not null;

alter table order_ratings enable row level security;

create policy "customer reads own order ratings" on order_ratings for select
  using (customer_id = auth.uid());

revoke insert, update, delete on order_ratings from authenticated;

-- ---------------------------------------------------------------------------
-- riders.rating_avg / rating_count - the rider-side counterpart of
-- vendors.rating_avg/rating_count (0003_catalog.sql), which have existed
-- since the very first migration but this is the first thing that will
-- ever write to either.
-- ---------------------------------------------------------------------------

alter table riders
  add column rating_avg numeric(3, 2) not null default 0,
  add column rating_count integer not null default 0;

comment on column riders.rating_avg is
  'Running average of rider_rating from order_ratings, maintained incrementally by submit_order_rating() - never recomputed from a full table scan. 0 until rating_count > 0, not NULL, matching vendors.rating_avg''s own convention (0003_catalog.sql).';

-- ---------------------------------------------------------------------------
-- submit_order_rating()
-- ---------------------------------------------------------------------------

create or replace function submit_order_rating(
  p_order_id       uuid,
  p_vendor_rating  smallint,
  p_vendor_comment text default null,
  p_rider_rating   smallint default null,
  p_rider_comment  text default null
)
returns order_ratings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  orders;
  v_rating order_ratings;
begin
  if auth.uid() is null then
    raise exception 'submit_order_rating: no authenticated caller';
  end if;

  if p_vendor_rating is null or p_vendor_rating not between 1 and 5 then
    raise exception 'submit_order_rating: vendor_rating must be between 1 and 5';
  end if;

  if p_rider_rating is not null and p_rider_rating not between 1 and 5 then
    raise exception 'submit_order_rating: rider_rating must be between 1 and 5';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'submit_order_rating: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is distinct from v_order.customer_id then
    raise exception 'submit_order_rating: actor % is not the customer on order %', auth.uid(), p_order_id;
  end if;

  -- Rating a delivery that never happened doesn't mean anything - same
  -- reasoning transition_order() enforces for the escrow-release guard on
  -- `delivered` itself (0030).
  if v_order.status <> 'delivered' then
    raise exception 'submit_order_rating: order % has not been delivered', p_order_id
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from order_ratings where order_id = p_order_id) then
    raise exception 'submit_order_rating: order % has already been rated', p_order_id
      using errcode = 'unique_violation';
  end if;

  -- rider_id/rider_rating/rider_comment only make sense together - a
  -- rating with no rider to attach it to is just noise on the rider side.
  insert into order_ratings (
    order_id, customer_id, vendor_id, rider_id,
    vendor_rating, vendor_comment, rider_rating, rider_comment
  )
  values (
    p_order_id, auth.uid(), v_order.vendor_id,
    case when v_order.rider_id is not null and p_rider_rating is not null then v_order.rider_id end,
    p_vendor_rating, p_vendor_comment,
    case when v_order.rider_id is not null then p_rider_rating end,
    case when v_order.rider_id is not null then p_rider_comment end
  )
  returning * into v_rating;

  -- Incremental average - exact for this purpose (not a running sum divided
  -- by a separately-tracked count that could drift), and never requires
  -- scanning every prior rating to update one row.
  update vendors
  set rating_avg = (rating_avg * rating_count + p_vendor_rating) / (rating_count + 1),
      rating_count = rating_count + 1
  where id = v_order.vendor_id;

  if v_rating.rider_id is not null then
    update riders
    set rating_avg = (rating_avg * rating_count + p_rider_rating) / (rating_count + 1),
        rating_count = rating_count + 1
    where user_id = v_rating.rider_id;
  end if;

  return v_rating;
end;
$$;

comment on function submit_order_rating(uuid, smallint, text, smallint, text) is
  'The only writer of order_ratings, and of vendors.rating_avg/rating_count + riders.rating_avg/rating_count. Requires the order to be `delivered` and the caller to be its customer; refuses a second rating for the same order (order_ratings.order_id is its primary key). vendor_rating is required (1-5); rider_rating/rider_comment are only ever persisted when the order actually had an assigned rider, even if the caller sends a rider_rating anyway.';

revoke execute on function submit_order_rating(uuid, smallint, text, smallint, text) from public;
grant execute on function submit_order_rating(uuid, smallint, text, smallint, text) to authenticated;
