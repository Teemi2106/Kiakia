-- KiaKia - a real delivery-fee estimate at checkout has never existed: both
-- checkout/_components/OrderSummary.tsx and cart/_components/OrderSummary.tsx
-- hardcode `deliveryFeeKobo = 0` (the former with an explicit
-- "This would be calculated based on location" comment) rather than ever
-- calling packages/domain/src/delivery.ts's computeDeliveryFee(). The
-- customer has always seen ₦0 at checkout regardless of distance, then a
-- real, non-zero fee only once place_order() actually runs - a bait and
-- switch this migration's own RPC and the accompanying frontend change
-- close.
--
-- The one piece the client cannot compute itself is which service area a
-- delivery address falls inside - that needs the same st_contains polygon
-- check place_order() already does server-side, and service_areas.polygon
-- is WKB, not something worth parsing client-side. This function is that
-- lookup, read-only and RLS-respecting (service_areas is already publicly
-- readable for active rows, 0007_rls.sql - SECURITY INVOKER, not DEFINER,
-- since no elevated privilege is needed here), returning exactly the two
-- rate columns computeDeliveryFee() needs. place_order() remains the only
-- authoritative price - this is an estimate, using the same straight-line
-- geography distance basis (st_distance) so it actually matches what
-- place_order() will go on to charge, rather than a road-following
-- driving-route distance (e.g. Mapbox Directions), which is systematically
-- longer and would overstate the estimate.

create or replace function find_service_area_for_point(p_lng double precision, p_lat double precision)
returns table (
  id                     uuid,
  base_delivery_fee_kobo bigint,
  per_km_fee_kobo        bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select sa.id, sa.base_delivery_fee_kobo, sa.per_km_fee_kobo
  from service_areas sa
  where sa.is_active
    and st_contains(sa.polygon::geometry, st_setsrid(st_makepoint(p_lng, p_lat), 4326))
  limit 1;
$$;

comment on function find_service_area_for_point(double precision, double precision) is
  'Read-only mirror of the service-area lookup inside place_order() (currently 0062_remove_free_delivery_threshold.sql), for computing a delivery-fee ESTIMATE client-side before checkout - see packages/domain/src/delivery.ts''s computeDeliveryFee(). Never authoritative: place_order() re-derives everything server-side regardless of what this returned. Zero rows means the point is outside every active service area, same condition place_order() itself raises on.';

revoke execute on function find_service_area_for_point(double precision, double precision) from public;
grant execute on function find_service_area_for_point(double precision, double precision) to authenticated;
